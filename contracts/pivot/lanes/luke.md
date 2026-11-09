# Luke · Site-builder agent, GitHub commits, repo gates, merges

Build the agent that turns one queued survey into one committed page, and leave a trail a developer can read. You are also the only person who can merge, so the other three lanes land through you.

- **Branch:** `luke/site-builder`
- **Paths:** `services/agent-workers/`, `generated/`, `.github/owners.json`, `.gitar/review/backstage.md`, root files
- **Push log:** `docs/handoffs/luke-log.md`
- **Read first:** the [kickoff](../README.md), especially "API to agent", "The generated page" and "Guardrails", then the [example payloads](../examples.v1.json)

## Build order

| Clock | Step | Done when |
| --- | --- | --- |
| T+0 to T+5 | 0 · Unblock the others | Kickoff merged, `agent/sites` exists, token is in the cluster, indices exist |
| T+5 to T+15 | 1 · Walking skeleton | Gate 1: one template build in dry-run leaves ledger documents in the real index |
| T+15 to T+25 | 2 · Real commits | A page appears on `agent/sites` with its decisions in the commit message |
| T+20 to T+35 | 3 · OpenAI builder | A build's plan and page come from the model, with template fallback |
| T+30 to T+40 | 4 · Telemetry | The build is a child of the survey's trace, with GenAI spans |
| T+35 to T+45 | 5 · Repo gates | Owner map and Gitar know about the agent; the agent PR is open |

### 0 · Unblock the others

- Merge the kickoff pull request.
- Create branch `agent/sites` from `main`.
- Create a fine-grained GitHub token limited to this repository with Contents read and write. Only the repository owner can issue one for a personal repository. Put it in Secret `agent-github` under key `GITHUB_TOKEN` with Radar's Secret editor, or sit with Ahmed while he does. It never goes in chat, Git or the board.
- If Anurup reports a 403 creating indices, create the four from his definitions with the admin CLI.

### 1 · Walking skeleton

Package `services/agent-workers/agent_workers/`, run with `python -m agent_workers`. Pin the same `elasticsearch` and OpenTelemetry versions as `services/incident-api/requirements.txt`.

1. **Claim.** Follow "API to agent" in the kickoff exactly: poll, then claim with `if_seq_no` and `if_primary_term`.
2. **Retrieve.** Read the survey's `recommendations` and fetch those sessions from `P-sessions`.
3. **Plan.** In `template` mode, choose theme from `vibe`, layout from how soon the first pick starts, and text scale and motion from `accessibility`. Each choice is one `decision` ledger document with a one-sentence rationale.
4. **Write.** Render the page from the plan and the sessions.
5. **Validate.** Enforce every rule in "The generated page". A failure is a ledger `error` with outcome `rejected`, then the template builder runs.
6. **Commit.** In `dry-run`, compute the SHA-256 and record a `commit` ledger document with `commit.mode: dry-run`.
7. **Publish.** Write `site.*` back to the survey. Record the whole run's duration on this last ledger document.

Write ledger titles in plain language. Attendees see them on the building screen: "Found six sessions that fit you", "Chose a bold, schedule-first layout", "Wrote your page", "Saved it as commit 3f2a9c1".

### 2 · Real commits

- `AGENT_COMMIT_MODE=github`: one `PUT /repos/lukeeskinner/Backstage/contents/generated/sites/<attendee_id>/index.html` with `branch: agent/sites`. Check `attendee_id` against `^att_[a-z2-7]{12}$` before building the path. Send the existing file's `sha` when rebuilding.
- Set the author to `backstage-site-agent <site-agent@backstage.invalid>`, so agent commits are obvious in history.
- Commit message: a subject such as `site(att_k7m2qx4n): bold schedule-first build for observability`, then lines for `run:`, `decisions:`, `featured:` and `trace:`.
- Simulated attendees stay on dry-run except one in `AGENT_SIM_COMMIT_EVERY`. On 403 or 429, switch that run to dry-run, log it, and keep going.

### 3 · OpenAI builder

- `AGENT_BUILDER=openai`. Follow the server-side habits already in `apps/web/server/openai.mjs`: the model comes from settings, never from a request, and keys are redacted from errors and logs.
- First call returns the plan as schema-constrained JSON: theme, layout, tone, section order and featured sessions, each with a one-sentence rationale. Second call writes the page from the plan and the session details.
- The model sees enums and catalog text only. **Never pass `answers.goal`.** See guardrail 2.
- Cap output tokens and give each call 20 s. On timeout, error or a rejected page, use the template builder and log outcome `fallback`.
- Check the model name with one direct request before wiring it in. `AGENT_OPENAI_MODEL` is yours to choose.

### 4 · Telemetry

- Start `agent.run` as a child of the survey's `traceparent`, with one child span per step.
- Model spans carry `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`.
- Every ledger document carries `trace_id` and `span_id`. Export OTLP over HTTP to `http://otel-collector:4318`, service name `agent-workers`.

### 5 · Repo gates

- Add an `agent` contributor to `.github/owners.json`: the login that owns the token, paths `["generated/sites/"]`. The check then limits the agent's reach the same way it limits ours.
- Add rules to `.gitar/review/backstage.md`: flag any site-builder write outside `generated/sites/`, any target ref other than `agent/sites`, any prompt that includes attendee free text, and any generated page with scripts, handlers or external URLs.
- Open the pull request from `agent/sites` to `main` so Gitar reviews the agent's code where a judge can see it. Do not merge it during the demo.
- Merge teammates' pull requests as they arrive. Small and often beats one large merge at T+50.

## Handoffs

**You give:** the token in the cluster at T+5 (Ahmed); ledger documents flowing at T+15 (Anurup); agent SHA and settings list at T+25 (Ahmed); first real page and commit URL at T+30 (Kunj).

**You get:** index names and mappings at T+5 (Anurup); the agent Deployment at T+30 (Ahmed).

**Until they arrive:** run against `backstage-qa-pivot` or a local Elasticsearch with the example survey from `examples.v1.json`.

## Stretch

- Rebuild from taps: a re-queued survey produces a second commit that favors what the attendee saved and drops what they dismissed.
- Incident-triggered notice: when an overflow is approved for a room, rebuild the affected sites with a notice. This makes the "Act" step real code.
