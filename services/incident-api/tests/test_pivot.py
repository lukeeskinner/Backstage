"""Attendee survey, recommendation, trends and trail routes against a fake Elasticsearch boundary."""
import json
import os
import re
from copy import deepcopy
from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch

from elastic_transport import ApiResponseMeta, HttpHeaders, NodeConfig
from elasticsearch import NotFoundError
from fastapi.testclient import TestClient
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from backstage_api.engine import Identity
from backstage_api.main import create_app

NOW = datetime(2026, 11, 9, 23, 30, tzinfo=timezone.utc)
IDENTITIES = {"org-token": Identity(id="organizer", tier=3), "att-token": Identity(id="attendee", tier=0)}
ORGANIZER = {"Authorization": "Bearer org-token"}
ATTENDEE = {"Authorization": "Bearer att-token"}
ANSWERS = {"role": "attendee", "interests": ["observability", "ai-agents"], "level": "practitioner",
           "goal": "Find talks on cutting alert noise", "vibe": "bold", "accessibility": ["large_text"]}
SESSION = {"session_id": "sess-014", "title": "Alert Fatigue Is a Design Bug", "abstract": "Fewer pages.",
           "track": "observability", "tags": ["observability", "alerting"], "level": "practitioner",
           "format": "talk", "room": "Room 255 BC", "starts_at": "2026-11-10T00:00:00Z",
           "ends_at": "2026-11-10T00:35:00Z", "synthetic": True}


def missing():
    meta = ApiResponseMeta(status=404, http_version="1.1", headers=HttpHeaders(), duration=0.0,
                           node=NodeConfig("http", "localhost", 9200))
    return NotFoundError("missing", meta, {})


class FakeElasticsearch:
    def __init__(self):
        self.docs, self.indexed, self.searches, self.results, self.count_value = {}, [], [], {}, 0
        self.updates, self.mappings = [], []

    def index(self, *, index, document, id=None, op_type=None, **_kwargs):
        key = id or f"auto-{len(self.indexed)}"
        self.docs[(index, key)] = deepcopy(document)
        self.indexed.append({"index": index, "id": key, "op_type": op_type, "document": deepcopy(document)})
        return {"_id": key, "result": "created"}

    def get(self, *, index, id, **_kwargs):
        if (index, id) not in self.docs:
            raise missing()
        return {"_source": deepcopy(self.docs[(index, id)]), "_seq_no": 1, "_primary_term": 1}

    def count(self, **_kwargs):
        return {"count": self.count_value}

    @property
    def indices(self):
        return self

    def exists_alias(self, *, name):
        return name in self.aliases

    def create(self, *, index, **definition):
        self.created.append({"index": index, **definition})
        return {"acknowledged": True}

    def bulk(self, *, operations, **_kwargs):
        self.bulked = list(operations)
        return {"errors": False}

    aliases, created, bulked, semantic_broken = frozenset(), [], [], False

    def update(self, *, index, id, doc, if_seq_no, if_primary_term, **_kwargs):
        self.updates.append({"index": index, "id": id, "doc": deepcopy(doc), "if_seq_no": if_seq_no,
                             "if_primary_term": if_primary_term})
        self.docs[(index, id)]["site"].update(doc.get("site", {}))
        return {"result": "updated"}

    def put_mapping(self, *, index, properties, **_kwargs):
        self.mappings.append({"index": index, "properties": properties})
        return {"acknowledged": True}

    def search(self, *, index, **body):
        if self.semantic_broken and '"semantic"' in json.dumps(body):
            raise RuntimeError("field is not semantic_text")
        self.searches.append({"index": index, **body})
        return deepcopy(self.results.get(index, {"hits": {"total": {"value": 0}, "hits": []}}))


class PivotTests(TestCase):
    def setUp(self):
        self.es = FakeElasticsearch()
        self.es.results["t-sessions"] = {"hits": {"hits": [
            {"_id": "sess-014", "_score": 12.4, "_source": SESSION, "matched_queries": ["interest", "goal", "level"]}]}}
        app = create_app(identities=IDENTITIES, clock=lambda: NOW, pivot_client=self.es, pivot_prefix="t")
        self.api = TestClient(app)

    def submit(self, answers=ANSWERS, source="qr"):
        return self.api.post("/api/v1/attendee/surveys", json={"answers": answers, "source": source})

    def test_survey_is_queued_for_the_agent_and_goal_never_leaves(self):
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertRegex(body["attendee_id"], r"^att_[a-z2-7]{12}$")
        self.assertEqual(body["site"], {"status": "queued"})
        self.assertNotIn("alert noise", response.text)
        stored = next(item for item in self.es.indexed if item["index"] == "t-surveys")
        self.assertEqual((stored["id"], stored["op_type"]), (body["attendee_id"], "create"))
        document = stored["document"]
        self.assertEqual(document["site"]["status"], "queued")
        self.assertEqual(document["answers"]["goal"], "Find talks on cutting alert noise")
        self.assertEqual(document["created_at"], "2026-11-09T23:30:00Z")
        self.assertRegex(document["traceparent"], r"^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$")
        self.assertEqual(document["recommendations"],
                         [{"session_id": "sess-014", "score": 12.4, "reasons": ["interest", "goal", "level"]}])

    def test_recommendations_explain_themselves_from_elasticsearch_matches(self):
        item = self.submit().json()["recommendations"][0]
        self.assertEqual(item["title"], SESSION["title"])
        self.assertEqual([reason["code"] for reason in item["reasons"]], ["interest", "goal", "level"])
        self.assertEqual(item["reasons"][0]["label"], "Matches your interest in observability")

    def test_recommendation_query_skips_ended_sessions_and_uses_goal_only_when_given(self):
        self.submit()
        query = next(call for call in self.es.searches if call["index"] == "t-sessions")["query"]["bool"]
        self.assertIn({"range": {"ends_at": {"gte": "2026-11-09T23:30:00Z"}}}, query["filter"])
        self.assertIn("goal", [list(clause.values())[0].get("_name") for clause in query["should"]])
        self.es.searches.clear()
        self.submit({key: value for key, value in ANSWERS.items() if key != "goal"})
        query = next(call for call in self.es.searches if call["index"] == "t-sessions")["query"]["bool"]
        self.assertNotIn("goal", [list(clause.values())[0].get("_name") for clause in query["should"]])

    def test_trending_sessions_from_recent_taps_boost_recommendations(self):
        self.es.results["t-interactions"] = {"aggregations": {"sessions": {"buckets": [{"key": "sess-031", "doc_count": 9}]}}}
        self.submit()
        query = next(call for call in self.es.searches if call["index"] == "t-sessions")["query"]["bool"]
        self.assertIn({"terms": {"session_id": ["sess-031"], "boost": 2.0, "_name": "trending"}}, query["should"])

    def test_answers_outside_the_contract_are_rejected_and_not_stored(self):
        bad = [
            {**ANSWERS, "interests": []},
            {**ANSWERS, "interests": ["observability", "security", "networking", "ai-agents"]},
            {**ANSWERS, "interests": ["cooking"]},
            {**ANSWERS, "role": "admin"},
            {**ANSWERS, "goal": "x" * 141},
            {**ANSWERS, "email": "someone@example.com"},
            {key: value for key, value in ANSWERS.items() if key != "vibe"},
        ]
        for answers in bad:
            response = self.submit(answers)
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (422, "invalid_payload"), answers)
        self.assertEqual(self.submit(source="import").status_code, 422)
        self.assertEqual(self.es.indexed, [])

    def test_hourly_build_budget_returns_429(self):
        self.es.count_value = 300
        response = self.submit()
        self.assertEqual((response.status_code, response.json()["error"]["code"]), (429, "rate_limited"))
        self.assertEqual(self.es.indexed, [])

    def test_attendee_view_hides_goal_and_trace_and_lists_agent_progress(self):
        attendee_id = self.submit().json()["attendee_id"]
        self.es.docs[("t-surveys", attendee_id)]["site"].update(status="building", run_id="run_b3x6t2m7q4ha")
        self.es.results["t-agent-ledger"] = {"hits": {"hits": [{"_source": {
            "seq": 1, "step": "claim", "title": "Started building your site", "detail": "internal",
            "@timestamp": "2026-11-09T23:30:06Z"}}]}}
        response = self.api.get(f"/api/v1/attendee/{attendee_id}")
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertNotIn("goal", body["answers"])
        self.assertNotIn("traceparent", response.text)
        self.assertNotIn("alert noise", response.text)
        self.assertEqual(body["site"]["status"], "building")
        self.assertEqual(body["progress"], [{"seq": 1, "step": "claim", "title": "Started building your site",
                                             "at": "2026-11-09T23:30:06Z"}])
        self.assertEqual(body["recommendations"][0]["session_id"], "sess-014")

    def test_unknown_or_malformed_attendee_is_404(self):
        for attendee_id in ("att_aaaaaaaaaaaa", "not-an-id"):
            response = self.api.get(f"/api/v1/attendee/{attendee_id}")
            self.assertEqual((response.status_code, response.json()["error"]["code"]), (404, "not_found"))

    def test_interaction_carries_survey_slices_for_trends(self):
        attendee_id = self.submit().json()["attendee_id"]
        response = self.api.post(f"/api/v1/attendee/{attendee_id}/interactions",
                                 json={"session_id": "sess-014", "action": "save", "position": 0})
        self.assertEqual((response.status_code, response.json()), (202, {"accepted": True}))
        document = next(item for item in self.es.indexed if item["index"] == "t-interactions")["document"]
        self.assertEqual({key: document[key] for key in ("attendee_id", "session_id", "action", "role", "interests", "level", "source")},
                         {"attendee_id": attendee_id, "session_id": "sess-014", "action": "save", "role": "attendee",
                          "interests": ["observability", "ai-agents"], "level": "practitioner", "source": "qr"})
        bad = self.api.post(f"/api/v1/attendee/{attendee_id}/interactions", json={"session_id": "sess-014", "action": "buy"})
        self.assertEqual(bad.status_code, 422)

    def test_trends_are_organizer_only_and_align_series_to_buckets(self):
        self.assertEqual(self.api.get("/api/v1/pivot/trends").status_code, 401)
        self.assertEqual(self.api.get("/api/v1/pivot/trends", headers=ATTENDEE).status_code, 403)
        self.es.results["t-surveys"] = {"hits": {"total": {"value": 3}}, "aggregations": {
            "over_time": {"buckets": [
                {"key_as_string": "2026-11-09T23:28:00.000Z", "doc_count": 1,
                 "interests": {"buckets": [{"key": "security", "doc_count": 1}]}},
                {"key_as_string": "2026-11-09T23:29:00.000Z", "doc_count": 2,
                 "interests": {"buckets": [{"key": "observability", "doc_count": 2}, {"key": "security", "doc_count": 1}]}}]},
            "roles": {"buckets": [{"key": "attendee", "doc_count": 3}]},
            "levels": {"buckets": []}, "vibes": {"buckets": []},
            "sources": {"buckets": [{"key": "simulator", "doc_count": 2}, {"key": "qr", "doc_count": 1}]},
            "site_status": {"buckets": [{"key": "ready", "doc_count": 2}, {"key": "failed", "doc_count": 1}]},
            "recommended": {"buckets": [{"key": "sess-014", "doc_count": 3}]}}}
        self.es.results["t-interactions"] = {"hits": {"total": {"value": 4}}, "aggregations": {
            "engaged": {"attendees": {"value": 2}},
            "sessions": {"buckets": [{"key": "sess-014", "doc_count": 4, "actions": {"buckets": [
                {"key": "open", "doc_count": 3}, {"key": "save", "doc_count": 1}]}}]}}}
        response = self.api.get("/api/v1/pivot/trends?window=60m&interval=1m&interest=security&source=qr", headers=ORGANIZER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body["totals"], {"surveys": 3, "simulated": 2, "sites_ready": 2, "sites_failed": 1,
                                          "interactions": 4, "open_rate": 0.67})
        self.assertEqual(body["interests_over_time"], {
            "buckets": ["2026-11-09T23:28:00Z", "2026-11-09T23:29:00Z"],
            "series": [{"key": "observability", "counts": [0, 2]}, {"key": "security", "counts": [1, 1]}]})
        self.assertEqual(body["sessions"], [{"session_id": "sess-014", "title": SESSION["title"], "recommended": 3,
                                             "opened": 3, "saved": 1, "dismissed": 0}])
        filters = next(call for call in self.es.searches if call["index"] == "t-surveys")["query"]["bool"]["filter"]
        self.assertIn({"term": {"answers.interests": "security"}}, filters)
        self.assertIn({"term": {"source": "qr"}}, filters)
        self.assertEqual(self.api.get("/api/v1/pivot/trends?window=9y", headers=ORGANIZER).status_code, 422)

    def test_trail_search_is_organizer_only_with_highlights_and_facets(self):
        self.assertEqual(self.api.get("/api/v1/pivot/trail/search", headers=ATTENDEE).status_code, 403)
        event = {"event_id": "run_b3x6t2m7q4ha:0003", "run_id": "run_b3x6t2m7q4ha", "attendee_id": "att_k7m2qx4n3w5p",
                 "seq": 3, "@timestamp": "2026-11-09T23:30:09Z", "kind": "decision", "step": "plan",
                 "title": "Chose a bold, schedule-first layout", "detail": "The schedule leads.",
                 "decision": {"name": "layout", "value": "schedule-first", "rationale": "Three picks start soon."},
                 "tool": "openai", "outcome": "ok", "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"}
        self.es.results["t-agent-ledger"] = {
            "hits": {"total": {"value": 1}, "hits": [{"_source": event, "highlight": {"detail": ["The <em>schedule</em> leads."]}}]},
            "aggregations": {"kind": {"buckets": [{"key": "decision", "doc_count": 1}]}, "step": {"buckets": []},
                             "tool": {"buckets": []}, "outcome": {"buckets": []}}}
        response = self.api.get("/api/v1/pivot/trail/search?q=why%20schedule-first&kind=decision", headers=ORGANIZER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["total"], body["limit"]), (1, 20))
        item = body["items"][0]
        self.assertEqual((item["at"], item["highlight"], item["trace_url"]),
                         ("2026-11-09T23:30:09Z", {"detail": ["The <em>schedule</em> leads."]}, None))
        self.assertNotIn("@timestamp", item)
        self.assertEqual(body["facets"]["kind"], [{"key": "decision", "count": 1}])
        call = next(call for call in self.es.searches if call["index"] == "t-agent-ledger")
        self.assertIn({"term": {"kind": "decision"}}, call["query"]["bool"]["filter"])
        self.assertEqual(call["query"]["bool"]["must"][0]["multi_match"]["query"], "why schedule-first")
        self.assertEqual(self.api.get("/api/v1/pivot/trail/search?kind=gossip", headers=ORGANIZER).status_code, 422)

    def test_trail_run_returns_events_in_order_or_404(self):
        self.assertEqual(self.api.get("/api/v1/pivot/trail/runs/run_b3x6t2m7q4ha", headers=ORGANIZER).status_code, 404)
        self.es.results["t-agent-ledger"] = {"hits": {"hits": [{"_source": {
            "run_id": "run_b3x6t2m7q4ha", "attendee_id": "att_k7m2qx4n3w5p", "seq": 1, "@timestamp": "2026-11-09T23:30:06Z",
            "kind": "action", "step": "claim", "title": "Started", "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736"}}]}}
        response = self.api.get("/api/v1/pivot/trail/runs/run_b3x6t2m7q4ha", headers=ORGANIZER)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body["run_id"], body["attendee_id"], len(body["events"])), ("run_b3x6t2m7q4ha", "att_k7m2qx4n3w5p", 1))
        self.assertEqual(next(call for call in self.es.searches if call["index"] == "t-agent-ledger")["sort"], [{"seq": "asc"}])

    def test_pivot_routes_do_not_exist_unless_enabled(self):
        plain = TestClient(create_app(identities=IDENTITIES, clock=lambda: NOW))
        self.assertEqual(plain.post("/api/v1/attendee/surveys", json={"answers": ANSWERS}).status_code, 404)
        self.assertEqual(plain.get("/healthz").status_code, 200)

    def test_provision_creates_only_missing_indices_and_seeds_upcoming_sessions(self):
        self.es.created, self.es.aliases = [], frozenset({"t-surveys"})
        report = self.api.app.state.pivot.provision(seed=True, pipelines=False)
        self.assertEqual(report["existing"], ["t-surveys"])
        self.assertEqual([item["index"] for item in self.es.created],
                         ["t-sessions-v1", "t-agent-ledger-v1", "t-interactions-v1"])
        self.assertEqual(self.es.created[0]["aliases"], {"t-sessions": {"is_write_index": True}})
        self.assertEqual(report["seeded"], 40)
        action, session = self.es.bulked[26], self.es.bulked[27]
        self.assertEqual(action, {"index": {"_index": "t-sessions", "_id": "sess-014"}})
        self.assertEqual((session["starts_at"], session["ends_at"]), ("2026-11-09T23:45:00Z", "2026-11-10T00:20:00Z"))
        self.assertNotIn("offset_minutes", session)

    def stuck(self, attendee_id, attempt, updated_at):
        self.es.docs[("t-surveys", attendee_id)]["site"].update(
            status="building", run_id="run_b3x6t2m7q4ha", attempt=attempt, updated_at=updated_at)
        return self.api.get(f"/api/v1/attendee/{attendee_id}").json()["site"]["status"]

    def test_build_stuck_for_ninety_seconds_is_requeued_once_then_failed(self):
        attendee_id = self.submit().json()["attendee_id"]
        self.assertEqual(self.stuck(attendee_id, 1, "2026-11-09T23:29:00Z"), "building")
        self.assertEqual(self.es.updates, [])
        self.assertEqual(self.stuck(attendee_id, 1, "2026-11-09T23:28:00Z"), "queued")
        update = self.es.updates[-1]
        self.assertEqual((update["id"], update["if_seq_no"], update["if_primary_term"]), (attendee_id, 1, 1))
        self.assertEqual(update["doc"], {"site": {"status": "queued", "updated_at": "2026-11-09T23:30:00Z"}})
        self.assertEqual(self.stuck(attendee_id, 2, "2026-11-09T23:28:00Z"), "failed")

    def semantic_app(self):
        with patch.dict(os.environ, {"PIVOT_SEMANTIC": "on"}):
            return TestClient(create_app(identities=IDENTITIES, clock=lambda: NOW, pivot_client=self.es, pivot_prefix="t"))

    def test_semantic_option_adds_a_named_semantic_clause_over_the_whole_profile(self):
        api = self.semantic_app()
        self.es.results["t-sessions"]["hits"]["hits"][0]["matched_queries"] = ["semantic", "interest"]
        response = api.post("/api/v1/attendee/surveys", json={"answers": ANSWERS})
        query = next(call for call in self.es.searches if call["index"] == "t-sessions")["query"]["bool"]
        self.assertIn({"semantic": {"field": "semantic", "_name": "semantic",
                                    "query": "observability ai-agents practitioner Find talks on cutting alert noise"}},
                      query["should"])
        self.assertEqual([reason["code"] for reason in response.json()["recommendations"][0]["reasons"]],
                         ["interest", "semantic"])
        plain = next(call for call in self.submit() and self.es.searches[::-1] if call["index"] == "t-sessions")
        self.assertNotIn('"semantic"', json.dumps(plain))

    def test_semantic_failure_falls_back_to_lexical_and_stays_off(self):
        api = self.semantic_app()
        self.es.semantic_broken = True
        response = api.post("/api/v1/attendee/surveys", json={"answers": ANSWERS})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(len(response.json()["recommendations"]), 1)
        self.assertIs(api.app.state.pivot.semantic, False)

    def test_semantic_provision_maps_the_field_and_seeds_its_text(self):
        api = self.semantic_app()
        report = api.app.state.pivot.provision(seed=True, pipelines=False)
        self.assertEqual(self.es.mappings, [{"index": "t-sessions", "properties": {"semantic": {"type": "semantic_text"}}}])
        self.assertEqual(report["semantic"], "mapped")
        self.assertIn("Alert Fatigue Is a Design Bug", self.es.bulked[27]["semantic"])
        self.api.app.state.pivot.provision(seed=True, pipelines=False)
        self.assertNotIn("semantic", self.es.bulked[27])

    def test_surveys_taps_and_recommendation_time_are_measured_without_attendee_ids(self):
        reader = InMemoryMetricReader()
        api = TestClient(create_app(identities=IDENTITIES, clock=lambda: NOW, pivot_client=self.es, pivot_prefix="t",
                                    meter_provider=MeterProvider(metric_readers=[reader])))
        attendee_id = api.post("/api/v1/attendee/surveys", json={"answers": ANSWERS, "source": "simulator"}).json()["attendee_id"]
        api.post(f"/api/v1/attendee/{attendee_id}/interactions", json={"session_id": "sess-014", "action": "save"})
        points = {metric.name: [dict(point.attributes) for point in metric.data.data_points]
                  for resource in reader.get_metrics_data().resource_metrics
                  for scope in resource.scope_metrics for metric in scope.metrics}
        self.assertEqual(points["backstage.pivot.surveys"], [{"source": "simulator"}])
        self.assertEqual(points["backstage.pivot.interactions"], [{"action": "save", "source": "simulator"}])
        self.assertEqual(points["backstage.pivot.recs.duration"], [{"outcome": "success"}])
        self.assertNotIn(attendee_id, json.dumps(points))

    def test_index_definitions_ignore_unknown_fields_instead_of_rejecting_writes(self):
        from backstage_api.pivot import DEFINITIONS, INDICES, load_definition
        self.assertEqual(sorted(INDICES), ["agent-ledger", "interactions", "sessions", "surveys"])
        for name in INDICES:
            self.assertIs(load_definition(name)["mappings"]["dynamic"], False, name)
        self.assertTrue(re.fullmatch(r".*contracts/pivot/elasticsearch", str(DEFINITIONS)))
