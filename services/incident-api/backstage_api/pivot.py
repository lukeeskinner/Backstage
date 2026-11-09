"""Attendee surveys, recommendations, trends and the agent trail, backed by Elasticsearch.

Mounted only when the pivot is enabled. Incident routes never depend on this module.
Contract: contracts/pivot/README.md. The survey's free-text goal is used for retrieval only
and never leaves through a public route.
"""

import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from elasticsearch import NotFoundError
from fastapi import Depends, Query, Request
from opentelemetry import trace
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .engine import ApiError, Identity
from .evidence import trace_url

DEFINITIONS = Path(__file__).resolve().parents[3] / "contracts" / "pivot" / "elasticsearch"
INDICES = ("sessions", "surveys", "agent-ledger", "interactions")
PIPELINES = ("survey-normalize", "ledger-mask")
ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
ATTENDEE_ID = re.compile(r"att_[a-z2-7]{12}")
RUN_ID = re.compile(r"run_[a-z2-7]{12}")
SESSION_ID = re.compile(r"sess-[a-z0-9-]{1,32}")
ROLES = ("attendee", "speaker", "staff", "organizer")
INTERESTS = ("observability", "platform-engineering", "ai-agents", "security", "networking", "storage-data",
             "gitops-delivery", "finops-sustainability", "wasm-edge", "community-careers")
LEVELS = ("new", "practitioner", "expert")
VIBES = ("calm", "bold", "playful")
ACCESSIBILITY = ("large_text", "reduced_motion", "high_contrast")
SOURCES = ("qr", "simulator")
ACTIONS = ("open", "save", "dismiss")
KINDS = ("decision", "action", "commit", "log", "error")
STEPS = ("claim", "retrieve", "plan", "write", "validate", "commit", "publish")
TOOLS = ("elasticsearch", "openai", "template", "validator", "github")
OUTCOMES = ("ok", "fallback", "retry", "rejected", "error")
WINDOWS = {"15m": 15, "30m": 30, "60m": 60, "3h": 180, "12h": 720, "24h": 1440}
INTERVALS = ("30s", "1m", "5m", "10m")
LEVEL_LABELS = {"new": "Good if you are new to the topic", "practitioner": "Pitched at practitioners",
                "expert": "Goes deep for experts"}
SITE_FIELDS = ("status", "run_id", "attempt", "builder", "commit_mode", "commit_sha", "commit_url",
               "html_sha256", "html", "spec", "updated_at")
TRAIL_FIELDS = ("event_id", "run_id", "attendee_id", "seq", "kind", "step", "title", "detail", "decision", "tool",
                "model", "tokens", "duration_ms", "run_duration_ms", "outcome", "builder", "source", "commit",
                "trace_id", "span_id")


def stamp(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix):
    return prefix + "".join(secrets.choice(ALPHABET) for _ in range(12))


def invalid(message):
    return ApiError(422, "invalid_payload", message)


def unavailable():
    return ApiError(503, "unavailable", "Attendee data is temporarily unavailable.")


def not_found():
    return ApiError(404, "not_found", "We could not find that site.")


def load_definition(name):
    return json.loads((DEFINITIONS / f"{name}-v1.json").read_text(encoding="utf-8"))


def validate_survey(body):
    """Return (answers, source) for a body inside the closed contract, or raise a 422."""
    if not isinstance(body, dict) or set(body) - {"answers", "source"} or not isinstance(body.get("answers"), dict):
        raise invalid("Send your answers and nothing else.")
    source = body.get("source", "qr")
    answers = body["answers"]
    if source not in SOURCES:
        raise invalid("Unknown survey source.")
    if set(answers) - {"role", "interests", "level", "goal", "vibe", "accessibility"}:
        raise invalid("The survey has only five questions.")
    interests = answers.get("interests")
    if (not isinstance(interests, list) or not 1 <= len(interests) <= 3 or len(set(map(str, interests))) != len(interests)
            or any(item not in INTERESTS for item in interests)):
        raise invalid("Choose one to three interests from the list.")
    for field, allowed in (("role", ROLES), ("level", LEVELS), ("vibe", VIBES)):
        if answers.get(field) not in allowed:
            raise invalid(f"Choose a {field} from the list.")
    comfort = answers.get("accessibility", [])
    if not isinstance(comfort, list) or len(set(map(str, comfort))) != len(comfort) or any(item not in ACCESSIBILITY for item in comfort):
        raise invalid("Choose comfort options from the list.")
    goal = answers.get("goal")
    if goal is not None:
        if not isinstance(goal, str) or len(goal) > 140:
            raise invalid("Keep your goal to 140 characters.")
        goal = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", goal)).strip() or None
    clean = {"role": answers["role"], "interests": list(interests), "level": answers["level"],
             "vibe": answers["vibe"], "accessibility": list(comfort)}
    if goal:
        clean["goal"] = goal
    return clean, source


def reason_labels(codes, answers, session):
    labels = []
    for code in codes:
        if code == "interest":
            topics = {session.get("track"), *(session.get("tags") or [])}
            match = next((item for item in answers.get("interests", []) if item in topics), None)
            label = f"Matches your interest in {match.replace('-', ' ')}" if match else "Related to the topics you picked"
        elif code == "goal":
            label = "Close to what you said you want from today"
        elif code == "level":
            label = LEVEL_LABELS.get(session.get("level"), "Fits your experience level")
        elif code == "trending":
            label = "Popular with other attendees right now"
        else:
            label = "Similar in meaning to your answers"
        labels.append({"code": code, "label": label})
    return labels


def buckets(aggregations, name):
    return [{"key": item["key"], "count": item["doc_count"]} for item in (aggregations.get(name) or {}).get("buckets", [])]


def series(histogram, inner):
    """Align every series to the shared bucket list: counts[i] belongs to buckets[i]."""
    rows = (histogram or {}).get("buckets", [])
    labels = [str(row.get("key_as_string", "")).replace(".000Z", "Z") for row in rows]
    keys = sorted({item["key"] for row in rows for item in (row.get(inner) or {}).get("buckets", [])})
    counts = {key: [0] * len(rows) for key in keys}
    for position, row in enumerate(rows):
        for item in (row.get(inner) or {}).get("buckets", []):
            counts[item["key"]][position] = item["doc_count"]
    return {"buckets": labels, "series": [{"key": key, "counts": counts[key]} for key in keys]}


class Pivot:
    def __init__(self, client, prefix, telemetry, clock):
        self.client, self.prefix, self.telemetry, self.clock = client, prefix, telemetry, clock
        self.max_builds = int(os.getenv("PIVOT_MAX_BUILDS_PER_HOUR", "300"))

    def alias(self, name):
        return f"{self.prefix}-{name}"

    def call(self, operation, action):
        try:
            with self.telemetry.es_operation("pivot." + operation):
                return action()
        except NotFoundError:
            raise
        except ApiError:
            raise
        except Exception:
            raise unavailable()

    def search(self, operation, name, **body):
        try:
            return self.call(operation, lambda: self.client.search(index=self.alias(name), **body))
        except NotFoundError:
            raise unavailable()

    def provision(self, seed=True, pipelines=False):
        """Create missing indices and aliases, never altering an existing one. Returns what happened."""
        report = {"created": [], "existing": [], "pipelines": [], "seeded": 0}
        for name in INDICES:
            alias = self.alias(name)
            if self.client.indices.exists_alias(name=alias):
                report["existing"].append(alias)
                continue
            definition = load_definition(name)
            definition["aliases"] = {alias: {"is_write_index": True}}
            self.client.indices.create(index=alias + "-v1", **definition)
            report["created"].append(alias)
        if pipelines:
            for name in PIPELINES:
                body = json.loads((DEFINITIONS / f"{name}.pipeline.json").read_text(encoding="utf-8"))
                try:
                    self.client.ingest.put_pipeline(id=self.alias(name), **body)
                    report["pipelines"].append(self.alias(name))
                except Exception:
                    report["pipelines"].append(self.alias(name) + ":denied")
        if seed:
            report["seeded"] = self.seed_sessions()
        return report

    def seed_sessions(self):
        """Index the synthetic catalog with start times relative to now. Safe to repeat."""
        now, operations = self.clock(), []
        for line in (DEFINITIONS / "sessions.seed.jsonl").read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            session = json.loads(line)
            start = now + timedelta(minutes=session.pop("offset_minutes"))
            session["starts_at"] = stamp(start)
            session["ends_at"] = stamp(start + timedelta(minutes=session.pop("duration_minutes")))
            operations += [{"index": {"_index": self.alias("sessions"), "_id": session["session_id"]}}, session]
        if operations:
            result = self.client.bulk(operations=operations, refresh=True)
            if result.get("errors"):
                raise RuntimeError("Session seed was only partly indexed.")
        return len(operations) // 2

    def trending(self, now):
        try:
            result = self.search("trending", "interactions", size=0, query={"bool": {"filter": [
                {"range": {"@timestamp": {"gte": stamp(now - timedelta(minutes=30))}}},
                {"terms": {"action": ["open", "save"]}}]}},
                aggs={"sessions": {"terms": {"field": "session_id", "size": 10}}})
        except ApiError:
            return []
        return [item["key"] for item in (result.get("aggregations") or {}).get("sessions", {}).get("buckets", [])]

    def recommend(self, answers, now):
        should = [{"multi_match": {"query": " ".join(answers["interests"]), "_name": "interest",
                                   "fields": ["title^3", "tags^2", "track^2", "abstract"]}}]
        if answers.get("goal"):
            should.append({"multi_match": {"query": answers["goal"], "_name": "goal",
                                           "fields": ["title^3", "tags^2", "abstract"]}})
        should.append({"term": {"level": {"value": answers["level"], "boost": 1.5, "_name": "level"}}})
        trending = self.trending(now)
        if trending:
            should.append({"terms": {"session_id": trending, "boost": 2.0, "_name": "trending"}})
        result = self.search("recommend", "sessions", size=6, sort=[{"_score": "desc"}, {"starts_at": "asc"}],
                             query={"bool": {"should": should, "minimum_should_match": 0,
                                             "filter": [{"range": {"ends_at": {"gte": stamp(now)}}}]}})
        order = {"interest": 0, "goal": 1, "level": 2, "trending": 3}
        picks = []
        for hit in result.get("hits", {}).get("hits", []):
            codes = sorted((code for code in hit.get("matched_queries") or [] if code in order), key=order.get)
            picks.append((hit.get("_source", {}), round(float(hit.get("_score") or 0.0), 2), codes))
        return picks

    def create_survey(self, body):
        answers, source = validate_survey(body)
        now = self.clock()
        recent = self.call("survey.budget", lambda: self.client.count(
            index=self.alias("surveys"), query={"range": {"created_at": {"gte": stamp(now - timedelta(hours=1))}}}))
        if recent.get("count", 0) >= self.max_builds:
            raise ApiError(429, "rate_limited", "We are building a lot of sites right now. Try again in a minute.")
        picks = self.recommend(answers, now)
        attendee_id, carrier = new_id("att_"), {}
        TraceContextTextMapPropagator().inject(carrier)
        span = trace.get_current_span().get_span_context()
        document = {
            "attendee_id": attendee_id, "created_at": stamp(now), "source": source, "answers": answers,
            "profile_text": " ".join([*answers["interests"], answers["level"], answers.get("goal", "").lower()]).strip(),
            "recommendations": [{"session_id": session.get("session_id"), "score": score, "reasons": codes}
                                for session, score, codes in picks],
            "site": {"status": "queued", "run_id": None, "attempt": 0, "builder": None, "commit_mode": None,
                     "commit_sha": None, "commit_url": None, "html_sha256": None, "html": None, "spec": None,
                     "updated_at": stamp(now)},
            "trace_id": f"{span.trace_id:032x}" if span.is_valid else None,
            "traceparent": carrier.get("traceparent"),
        }
        self.call("survey.index", lambda: self.client.index(
            index=self.alias("surveys"), id=attendee_id, document=document, op_type="create"))
        self.telemetry.event("pivot.survey", outcome="queued", count=len(picks))
        return {"attendee_id": attendee_id, "site": {"status": "queued"},
                "recommendations": [{**session, "score": score, "reasons": reason_labels(codes, answers, session)}
                                    for session, score, codes in picks]}

    def survey(self, attendee_id):
        if not ATTENDEE_ID.fullmatch(attendee_id):
            raise not_found()
        try:
            return self.call("survey.get", lambda: self.client.get(index=self.alias("surveys"), id=attendee_id))["_source"]
        except NotFoundError:
            raise not_found()

    def sessions(self, ids):
        if not ids:
            return {}
        result = self.search("sessions.get", "sessions", size=len(ids), query={"ids": {"values": list(ids)}})
        return {hit["_source"]["session_id"]: hit["_source"] for hit in result.get("hits", {}).get("hits", [])
                if hit.get("_source", {}).get("session_id")}

    def attendee(self, attendee_id):
        survey = self.survey(attendee_id)
        answers = {key: value for key, value in survey.get("answers", {}).items() if key != "goal"}
        stored = survey.get("recommendations") or []
        details = self.sessions([item["session_id"] for item in stored])
        site = survey.get("site") or {}
        progress = []
        if site.get("run_id"):
            result = self.search("progress", "agent-ledger", size=50, sort=[{"seq": "asc"}],
                                 query={"term": {"run_id": site["run_id"]}}, source=["seq", "step", "title", "@timestamp"])
            progress = [{"seq": hit["_source"].get("seq"), "step": hit["_source"].get("step"),
                         "title": hit["_source"].get("title"), "at": hit["_source"].get("@timestamp")}
                        for hit in result.get("hits", {}).get("hits", [])]
        return {
            "attendee_id": attendee_id, "answers": answers,
            "recommendations": [{**details[item["session_id"]], "score": item.get("score"),
                                 "reasons": reason_labels(item.get("reasons") or [], survey.get("answers", {}),
                                                          details[item["session_id"]])}
                                for item in stored if item["session_id"] in details],
            "site": {field: site.get(field) for field in SITE_FIELDS},
            "progress": progress,
        }

    def interaction(self, attendee_id, body):
        if (not isinstance(body, dict) or set(body) - {"session_id", "action", "position"}
                or not isinstance(body.get("session_id"), str) or not SESSION_ID.fullmatch(body["session_id"])
                or body.get("action") not in ACTIONS):
            raise invalid("Send a session and one of open, save or dismiss.")
        position = body.get("position", 0)
        if isinstance(position, bool) or not isinstance(position, int) or not 0 <= position <= 50:
            raise invalid("Position must be a small whole number.")
        survey = self.survey(attendee_id)
        answers = survey.get("answers", {})
        document = {"attendee_id": attendee_id, "session_id": body["session_id"], "action": body["action"],
                    "position": position, "run_id": (survey.get("site") or {}).get("run_id"),
                    "@timestamp": stamp(self.clock()), "role": answers.get("role"),
                    "interests": answers.get("interests", []), "level": answers.get("level"),
                    "source": survey.get("source")}
        self.call("interaction.index", lambda: self.client.index(index=self.alias("interactions"), document=document))
        return {"accepted": True}

    def trends(self, window, interval, interest, source):
        if window not in WINDOWS or interval not in INTERVALS:
            raise invalid("Use a window of 15m, 30m, 60m, 3h, 12h or 24h and an interval of 30s, 1m, 5m or 10m.")
        if interest is not None and interest not in INTERESTS:
            raise invalid("Unknown interest.")
        if source is not None and source not in SOURCES:
            raise invalid("Unknown source.")
        now = self.clock()
        since = stamp(now - timedelta(minutes=WINDOWS[window]))
        histogram = {"fixed_interval": interval, "min_doc_count": 0, "extended_bounds": {"min": since, "max": stamp(now)}}
        slices = ([{"term": {"source": source}}] if source else [])
        survey_filter = [{"range": {"created_at": {"gte": since}}}, *slices,
                         *([{"term": {"answers.interests": interest}}] if interest else [])]
        tap_filter = [{"range": {"@timestamp": {"gte": since}}}, *slices,
                      *([{"term": {"interests": interest}}] if interest else [])]
        surveys = self.search("trends.surveys", "surveys", size=0, track_total_hits=True,
                              query={"bool": {"filter": survey_filter}}, aggs={
            "over_time": {"date_histogram": {"field": "created_at", **histogram},
                          "aggs": {"interests": {"terms": {"field": "answers.interests", "size": 10}}}},
            "roles": {"terms": {"field": "answers.role"}}, "levels": {"terms": {"field": "answers.level"}},
            "vibes": {"terms": {"field": "answers.vibe"}}, "sources": {"terms": {"field": "source"}},
            "site_status": {"terms": {"field": "site.status"}},
            "recommended": {"terms": {"field": "recommendations.session_id", "size": 40}}})
        taps = self.search("trends.interactions", "interactions", size=0, track_total_hits=True,
                           query={"bool": {"filter": tap_filter}}, aggs={
            "engaged": {"filter": {"terms": {"action": ["open", "save"]}},
                        "aggs": {"attendees": {"cardinality": {"field": "attendee_id"}}}},
            "sessions": {"terms": {"field": "session_id", "size": 40},
                         "aggs": {"actions": {"terms": {"field": "action"}}}}})
        published = {"term": {"step": "publish"}}
        ledger = self.search("trends.ledger", "agent-ledger", size=0,
                             query={"bool": {"filter": [{"range": {"@timestamp": {"gte": since}}}, *slices]}}, aggs={
            "builds": {"filter": published, "aggs": {
                "over_time": {"date_histogram": {"field": "@timestamp", **histogram},
                              "aggs": {"outcomes": {"terms": {"field": "outcome"}}}},
                "latency": {"percentiles": {"field": "run_duration_ms", "percents": [50, 95]}},
                "builders": {"terms": {"field": "builder"}}}},
            "decisions": {"filter": {"term": {"kind": "decision"}}, "aggs": {
                "names": {"terms": {"field": "decision.name", "size": 10},
                          "aggs": {"values": {"terms": {"field": "decision.value", "size": 10}}}}}},
            "commits": {"filter": {"term": {"kind": "commit"}}, "aggs": {"modes": {"terms": {"field": "commit.mode"}}}}})
        survey_aggs, tap_aggs, ledger_aggs = (item.get("aggregations") or {} for item in (surveys, taps, ledger))
        total = ((surveys.get("hits") or {}).get("total") or {}).get("value", 0)
        status = {item["key"]: item["count"] for item in buckets(survey_aggs, "site_status")}
        simulated = next((item["count"] for item in buckets(survey_aggs, "sources") if item["key"] == "simulator"), 0)
        engaged = ((tap_aggs.get("engaged") or {}).get("attendees") or {}).get("value", 0)
        per_session = {item["key"]: {"session_id": item["key"], "title": None, "recommended": item["count"],
                                     "opened": 0, "saved": 0, "dismissed": 0} for item in buckets(survey_aggs, "recommended")}
        for row in (tap_aggs.get("sessions") or {}).get("buckets", []):
            entry = per_session.setdefault(row["key"], {"session_id": row["key"], "title": None, "recommended": 0,
                                                        "opened": 0, "saved": 0, "dismissed": 0})
            for action in (row.get("actions") or {}).get("buckets", []):
                field = {"open": "opened", "save": "saved", "dismiss": "dismissed"}.get(action["key"])
                if field:
                    entry[field] = action["doc_count"]
        ranked = sorted(per_session.values(), key=lambda item: (-item["recommended"], -item["opened"], item["session_id"]))[:20]
        titles = self.sessions([item["session_id"] for item in ranked])
        for item in ranked:
            item["title"] = titles.get(item["session_id"], {}).get("title")
        builds = ledger_aggs.get("builds") or {}
        latency = (builds.get("latency") or {}).get("values") or {}
        names = ((ledger_aggs.get("decisions") or {}).get("names") or {}).get("buckets", [])
        return {
            "window": window, "interval": interval, "generated_at": stamp(now),
            "filters": {"interest": interest, "source": source},
            "totals": {"surveys": total, "simulated": simulated, "sites_ready": status.get("ready", 0),
                       "sites_failed": status.get("failed", 0),
                       "interactions": ((taps.get("hits") or {}).get("total") or {}).get("value", 0),
                       "open_rate": round(engaged / total, 2) if total else 0.0},
            "interests_over_time": series(survey_aggs.get("over_time"), "interests"),
            "roles": buckets(survey_aggs, "roles"), "levels": buckets(survey_aggs, "levels"),
            "vibes": buckets(survey_aggs, "vibes"), "sessions": ranked,
            "agent": {
                "builds_over_time": series(builds.get("over_time"), "outcomes"),
                "latency_ms": {"p50": latency.get("50.0"), "p95": latency.get("95.0")},
                "decisions": {row["key"]: buckets(row, "values") for row in names},
                "builders": buckets(builds, "builders"),
                "commit_modes": buckets(ledger_aggs.get("commits") or {}, "modes"),
            },
        }

    def trail_item(self, hit, link_template):
        source = hit.get("_source", {})
        item = {field: source.get(field) for field in TRAIL_FIELDS}
        item["at"] = source.get("@timestamp")
        if "highlight" in hit:
            item["highlight"] = hit["highlight"]
        item["trace_url"] = trace_url(link_template, source.get("trace_id"))
        return item

    def trail_search(self, q, terms, from_at, to_at, limit):
        allowed = {"kind": KINDS, "step": STEPS, "tool": TOOLS, "outcome": OUTCOMES}
        filters = []
        for field, value in terms.items():
            if value is None:
                continue
            if field in allowed and value not in allowed[field]:
                raise invalid(f"Unknown {field}.")
            if (field == "attendee_id" and not ATTENDEE_ID.fullmatch(value)) or (field == "run_id" and not RUN_ID.fullmatch(value)):
                raise invalid(f"Malformed {field}.")
            filters.append({"term": {field: value}})
        moments = {}
        for bound, value in (("gte", from_at), ("lte", to_at)):
            if value is not None:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z", value):
                    raise invalid("Search times must be UTC RFC 3339 timestamps.")
                moments[bound] = value
        if moments:
            filters.append({"range": {"@timestamp": moments}})
        query = {"bool": {"filter": filters}}
        q = q.strip()
        if q:
            query["bool"]["must"] = [{"multi_match": {"query": q, "fields": [
                "title^3", "detail", "decision.rationale", "commit.message"]}}]
            query["bool"]["should"] = [{"terms": {"decision.value": q.lower().split()[:10], "boost": 2.0}}]
        result = self.search("trail.search", "agent-ledger", size=limit, track_total_hits=True, query=query,
                             sort=([{"_score": "desc"}] if q else []) + [{"@timestamp": "desc"}, {"seq": "desc"}],
                             highlight={"pre_tags": ["<em>"], "post_tags": ["</em>"],
                                        "fields": {"title": {}, "detail": {}, "decision.rationale": {}}},
                             aggs={field: {"terms": {"field": field, "size": 10}} for field in allowed})
        template = os.getenv("DASH0_TRACE_URL_TEMPLATE")
        hits = result.get("hits") or {}
        aggregations = result.get("aggregations") or {}
        return {"total": (hits.get("total") or {}).get("value", 0), "limit": limit,
                "items": [self.trail_item(hit, template) for hit in hits.get("hits", [])],
                "facets": {field: buckets(aggregations, field) for field in allowed}}

    def trail_run(self, run_id):
        if not RUN_ID.fullmatch(run_id):
            raise ApiError(404, "not_found", "We could not find that run.")
        result = self.search("trail.run", "agent-ledger", size=200, sort=[{"seq": "asc"}],
                             query={"term": {"run_id": run_id}})
        hits = (result.get("hits") or {}).get("hits", [])
        if not hits:
            raise ApiError(404, "not_found", "We could not find that run.")
        template = os.getenv("DASH0_TRACE_URL_TEMPLATE")
        first = hits[0].get("_source", {})
        survey, site = None, None
        try:
            stored = self.survey(first.get("attendee_id") or "")
            answers = stored.get("answers", {})
            survey = {**{key: answers.get(key) for key in ("role", "interests", "level", "vibe", "accessibility")},
                      "source": stored.get("source"), "created_at": stored.get("created_at")}
            site = {field: (stored.get("site") or {}).get(field) for field in SITE_FIELDS if field not in ("html", "spec")}
        except ApiError:
            pass
        return {"run_id": run_id, "attendee_id": first.get("attendee_id"), "survey": survey, "site": site,
                "trace_id": first.get("trace_id"), "trace_url": trace_url(template, first.get("trace_id")),
                "events": [self.trail_item(hit, template) for hit in hits]}


def mount_pivot(app, *, client, prefix, telemetry, caller, clock):
    pivot = Pivot(client, prefix, telemetry, clock)
    app.state.pivot = pivot

    def organizer(actor: Identity = Depends(caller)):
        if actor.tier != 3:
            raise ApiError(403, "forbidden", "Organizer access is required.")
        return actor

    @app.post("/api/v1/attendee/surveys", status_code=201)
    def submit_survey(body: dict, request: Request):
        if int(request.headers.get("content-length") or 0) > 4096:
            raise invalid("That survey is too large.")
        return pivot.create_survey(body)

    @app.get("/api/v1/attendee/{attendee_id}")
    def attendee_view(attendee_id: str):
        return pivot.attendee(attendee_id)

    @app.post("/api/v1/attendee/{attendee_id}/interactions", status_code=202)
    def record_interaction(attendee_id: str, body: dict):
        return pivot.interaction(attendee_id, body)

    @app.get("/api/v1/pivot/trends")
    def trends(_actor: Identity = Depends(organizer), window: str = Query(default="60m", max_length=8),
               interval: str = Query(default="1m", max_length=8), interest: str | None = Query(default=None, max_length=40),
               source: str | None = Query(default=None, max_length=16)):
        return pivot.trends(window, interval, interest, source)

    @app.get("/api/v1/pivot/trail/search")
    def trail_search(_actor: Identity = Depends(organizer), q: str = Query(default="", max_length=200),
                     kind: str | None = Query(default=None, max_length=16), step: str | None = Query(default=None, max_length=16),
                     tool: str | None = Query(default=None, max_length=24), outcome: str | None = Query(default=None, max_length=16),
                     attendee_id: str | None = Query(default=None, max_length=32), run_id: str | None = Query(default=None, max_length=32),
                     from_at: str | None = Query(default=None, alias="from", max_length=40),
                     to_at: str | None = Query(default=None, alias="to", max_length=40),
                     limit: int = Query(default=20, ge=1, le=50)):
        terms = {"kind": kind, "step": step, "tool": tool, "outcome": outcome, "attendee_id": attendee_id, "run_id": run_id}
        return pivot.trail_search(q, terms, from_at, to_at, limit)

    @app.get("/api/v1/pivot/trail/runs/{run_id}")
    def trail_run(run_id: str, _actor: Identity = Depends(organizer)):
        return pivot.trail_run(run_id)

    return pivot
