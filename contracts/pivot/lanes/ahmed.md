# Ahmed · Cluster runtime through Radar, simulated attendees, evidence

Get the agent running in `team-backstage`, keep the API and web on the right pins, send enough simulated attendees that the charts and traces are alive, and record what Radar showed.

- **Branch:** `ali/pivot-runtime`. The prefix stays `ali/` because that is the lane key the ownership check reads.
- **Paths:** `deploy/platform/`, `deploy/badge/`, `services/badge-simulator/`, `docs/radar/`
- **Push log:** `docs/radar/handoff-log.md`
- **Read first:** the [kickoff](../README.md), especially "The clock", "Settings" and "Guardrails", then the [example payloads](../examples.v1.json)

## Build order

| Clock | Step | Done when |
| --- | --- | --- |
| T+0 to T+10 | 1 · Headroom and secrets | You know the free CPU, and `agent-github` exists |
| T+5 to T+20 | 2 · Attendee simulator | Fifty simulated attendees are in the index and the command is in your log |
| T+15 | 3a · Roll the skeleton API | Gate 1: the public host answers the attendee routes |
| T+20 to T+35 | 3b · Agent Deployment | The agent is running in the cluster at Luke's SHA |
| T+35 to T+45 | 4 · Final pins and traffic | Gate 3: three pins live, simulator Job running |
| T+45 to T+55 | 5 · Evidence | Radar views recorded in your log |

### 1 · Headroom and secrets

- Read the namespace's CPU use against the 10-core team quota in Radar. The agent needs about half a core including its init step. If less than 0.75 is free, scale `badge-station-a` and `badge-station-b` to zero, record it, and restore them after the demo.
- Create Secret `agent-github` with key `GITHUB_TOKEN` through Radar's Secret editor, using `stringData` as Luke did for the Elastic fields. Luke supplies the value in person. It never goes in a logged apply request, chat, Git or the board.
- Confirm `incident-secrets` and `web-openai` exist. Do not open their values.

### 2 · Attendee simulator

Add `services/badge-simulator/badge_sim/attendees.py`, run as `python -m badge_sim.attendees --base-url <api> --count 150 --rate 0.5 --seed 7`.

- Each simulated attendee posts one survey with `source: "simulator"`, then zero to three interactions on its recommendations.
- Give the crowd a shape so trends have something to show: a few personas with different topic weights, and one or two topics that grow over the run.
- Use only the enums in the kickoff. Leave `goal` empty or pick from a short fixed list. No names.
- Stop on repeated 429s instead of retrying hard; the API has an hourly build cap.
- Also ship it as Job `attendee-wave` in `deploy/badge/attendee-wave-job.yaml`, following `drill-job.yaml`: non-root, read-only root filesystem, at most 100m CPU, not part of the kustomization.

### 3 · Rollouts

- **Skeleton API at T+15.** Set both `CODE_SHA` values on Deployment `incident-api` to Anurup's skeleton SHA and add `PIVOT_ENABLED=true`. Wait for `/readyz`. The last known good release is `f536b757fe510b3af8a4db76a09fd88d81ae6213`; go back to it if readiness fails.
- **Agent at T+20 to T+35.** Add `deploy/platform/agent-workers.yaml`, modeled on `deploy/incident/incident-api.yaml`:
  - the same stock Python image and bootstrap pattern, with your own bootstrap script that extracts `services/agent-workers/` and `contracts/pivot/` from the pinned archive and installs `services/agent-workers/requirements.txt`;
  - one replica, `Recreate`, no ServiceAccount token, non-root, read-only root filesystem;
  - limits of 250m CPU and 256Mi for the container, and at most 500m for the init step, because init limits count against the quota;
  - explicit `secretKeyRef` entries only: the three `ELASTICSEARCH_*` keys from `incident-secrets`, `OPENAI_API_KEY` from `web-openai`, `GITHUB_TOKEN` from `agent-github`. Do not use `envFrom` on `incident-secrets`; the agent has no use for the role tokens;
  - OTLP to `http://otel-collector:4318`, service name `agent-workers`, `service.version` from the pin;
  - start with `AGENT_BUILDER=template` and `AGENT_COMMIT_MODE=dry-run`, then switch to `openai` and `github` once Luke says so.
- Add it to `deploy/platform/kustomization.yaml`, apply through Radar, wait for ready, and follow the logs for one full build.

### 4 · Final pins and traffic

- Roll `incident-api` to Anurup's final SHA at T+35.
- Roll web to Kunj's SHA, or confirm that he did. It takes several minutes; do not start it after T+42.
- Run the `attendee-wave` Job against `http://incident-api:8000/api/v1` and watch it in Radar.
- Check from a phone on cellular that the public host serves the survey and a finished site.

### 5 · Evidence

Record in `docs/radar/handoff-log.md`, with what you observed yourself kept separate from what others reported:

- the agent's Pod with its log streaming build steps, and its events timeline;
- the namespace's resource use against the quota with everything running;
- the rollouts you applied and the Job you ran, with SHAs;
- one sentence per item on what Radar let you do without `kubectl`.

Badge diagnosis stays `RADAR_MODE=mock`. Do not claim otherwise.

## Handoffs

**You give:** "headroom is fine and the secret exists" at T+10 (Luke); simulator command and first fifty attendees at T+20 (Anurup, Kunj); agent running at T+35 (Luke); three pins live at T+45 (everyone).

**You get:** the token at T+5 (Luke); skeleton SHA at T+15 and final SHA at T+35 (Anurup); agent SHA and settings at T+25 (Luke); web SHA at T+35 (Kunj).

**Until they arrive:** build the simulator against the request and response shapes in `examples.v1.json`, and render the agent manifest with `kubectl kustomize deploy/platform` using a placeholder SHA.

## Stretch

- One Kubernetes Job per real attendee build, so each scan appears in Radar. It needs a Role that lets the API create Jobs, so only start after gate 3.
- If the agent's Deployment is steady early, pair with Luke on his telemetry step.
