# Anurup · Elasticsearch data plane, attendee and trail APIs, developer trail

Make Elasticsearch the memory and the queue of the pivot. Surveys go in, recommendations come out, the agent's ledger becomes searchable, and every chart is one aggregation away.

- **Branch:** `anurup/pivot-data`
- **Paths:** `data/elasticsearch/`, `services/incident-api/`, `contracts/`, `deploy/incident/`, `deploy/dash0/`, `apps/web/src/api/`, `apps/web/src/diagnostics/`
- **Push log:** `docs/handoffs/anurup-log.md`
- **Read first:** the [kickoff](../README.md) and the [example payloads](../examples.v1.json)

## Build order

| Clock | Step | Done when |
| --- | --- | --- |
| T+0 to T+5 | 1 · Probe and bootstrap | Four aliases exist and about 40 sessions are seeded, or Luke has been asked to create them |
| T+5 to T+15 | 2 · Survey and attendee read | Gate 1: both public routes answer on the cluster |
| T+10 | 4a · Typed client | Kunj can import `apps/web/src/api/pivot.ts` |
| T+15 to T+28 | 3 · Interactions, trends, trail | The three organizer routes return real aggregations |
| T+25 to T+38 | 4b · Trail screen | Search, filter, open a run, follow it to a commit |
| T+28 to T+38 | 5 · Semantic upgrade | Only if the probe found an endpoint |
| T+35 to T+45 | 6 · Release and telemetry | Final SHA handed to Ahmed; tests green |

### 1 · Probe and bootstrap

- Ask the cluster two questions and record the answers in the log without printing credentials: `GET /` for version and flavor, and `GET /_inference/_all` for a usable embedding endpoint.
- Add `pivot-sessions-v1.json`, `pivot-surveys-v1.json`, `pivot-agent-ledger-v1.json` and `pivot-interactions-v1.json` under `data/elasticsearch/`, all `dynamic: false`. Store `site.html` unindexed.
- Add `bootstrap-pivot.py --prefix <P> [--seed]`, modeled on `bootstrap-evidence.py`: it refuses an existing alias and never reads a credential file.
- Add two ingest pipelines. `<P>-survey-normalize` trims and lowercases the enums, builds `profile_text` from interests, level and goal, and sets `ingested_at`. `<P>-ledger-mask` uses `gsub` to mask key-shaped strings (`sk-`, `ghp_`, `github_pat_`) in `title` and `detail`.
- Seed `pivot-sessions.seed.jsonl`: synthetic titles marked `synthetic: true`, rooms from `apps/web/src/venue/kubecon-na-2026.ts`, no real speaker names, start times spread from now to the end of the day.
- Try an isolated prefix first (`backstage-qa-pivot`), then `backstage-demo`. On a 403, stop and hand the four definitions to Luke.

### 2 · Survey and attendee read

- New module `services/incident-api/backstage_api/pivot.py`. `main.py` mounts it only when `PIVOT_ENABLED=true` and a live Elasticsearch client exists. If mounting fails, log it and keep starting: the incident routes come first.
- `POST /api/v1/attendee/surveys` validates strictly (closed enums, no extra fields, `goal` at most 140 characters), generates `attendee_id`, computes recommendations, and indexes with `op_type=create`, the normalize pipeline, `site.status=queued` and the current `traceparent`.
- Recommendations, lexical version: a `bool` query whose `should` clauses are a `multi_match` of interests and goal over `title^3`, `tags^2`, `abstract` and `track`, a boost for a matching level, and a boost for the ten most opened or saved sessions of the last 30 minutes (one small `terms` aggregation on `P-interactions`). Filter out sessions that have ended. Return six. Compute the reasons in Python from tag overlap, level match and trending membership, so they are always explainable.
- `GET /api/v1/attendee/{attendee_id}` returns the survey without `goal` or `traceparent`, recommendations joined to session details, `site`, and `progress[]` from that run's ledger titles.
- Over `PIVOT_MAX_BUILDS_PER_HOUR`, return 429 with a plain sentence.

### 3 · Interactions, trends, trail

- `POST …/interactions` copies `role`, `interests`, `level` and `source` from the survey onto the interaction, so trends can slice without joins.
- `GET /api/v1/pivot/trends`: a `date_histogram` by `terms` on interests; `terms` on role, level and vibe; per-session counts of recommended, opened, saved and dismissed; from the ledger, builds over time by outcome, `percentiles` of run duration, and `terms` on decision values grouped by decision name. Honor `interest` and `source`. Always return `totals.simulated`.
- `GET /api/v1/pivot/trail/search`: `multi_match` over `title^3`, `detail`, `decision.rationale` and `commit.message`; filters for every query parameter; `highlight` on `detail` and `decision.rationale`; facets on `kind`, `step`, `tool` and `outcome`; newest first when `q` is empty. Build `trace_url` only with the existing `trace_url()` helper.
- `GET /api/v1/pivot/trail/runs/{run_id}` returns that run's events ordered by `seq`.
- Trends and trail require tier 3, checked with the existing `caller` dependency.

### 4 · Typed client and trail screen

- `apps/web/src/api/pivot.ts`: types that mirror the examples and one function per route. Push it by T+10; Kunj builds on it.
- `apps/web/src/diagnostics/TrailConsole.tsx`, exported as `TrailConsole({ client, mockMode })`: a search box, filters drawn from the facets, results with the highlighted rationale, a run timeline, a commit link, and the trace id with a copy button. Reuse the patterns in `IncidentEvidence.tsx`. Kunj mounts it; leave the routing files to him.

### 5 · Semantic upgrade

Only if step 1 found an inference endpoint. Add a `semantic_text` field fed by `copy_to` from title, abstract and tags, re-seed, and switch to an RRF retriever over the lexical and semantic legs. Add the reason `semantic`. Keep `PIVOT_SEMANTIC=off` as the instant way back. If it is slow or errors, ship lexical and write that down.

### 6 · Release and telemetry

- `services/incident-api/tests/test_pivot.py` with a fake client; `make check` and `make check-api` stay green.
- Counters `backstage.pivot.surveys` and `backstage.pivot.interactions`; histogram `backstage.pivot.recs.duration`. A new `deploy/dash0/dashboard-attendee-pipeline.yaml` if time allows.
- Hand Ahmed a skeleton SHA at T+15 and a final SHA at T+35. Update both `CODE_SHA` values in `deploy/incident/incident-api.yaml` in a follow-up commit and add `PIVOT_ENABLED`. The last known good API release is `f536b757fe510b3af8a4db76a09fd88d81ae6213`.

## Handoffs

**You give:** aliases and mappings at T+5 (everyone); typed client at T+10 (Kunj); skeleton SHA at T+15 and final SHA at T+35 (Ahmed).

**You get:** route names and the `TrailConsole` mount at T+10 (Kunj); ledger documents at T+15 (Luke); simulated traffic at T+20 (Ahmed).

**Until they arrive:** index three ledger events by hand from the examples to build the trail; post ten surveys with `curl` to build trends.

## Stretch

- Collector fan-out to Elasticsearch with the contrib `elasticsearch` exporter in `deploy/dash0/`. It needs a key with data-stream rights, so ask Luke first.
- One chart answered with ES|QL.
- Incident-triggered rebuild with `_update_by_query` when an overflow is approved.
