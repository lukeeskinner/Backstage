# Attendee site builder

Luke's pivot worker turns queued surveys into validated personal conference pages. Contract: [pivot v1](../../contracts/pivot/README.md).

## Run locally

Use Python 3.12 or newer. From the repo root:

```sh
python3 -m venv services/agent-workers/.venv
services/agent-workers/.venv/bin/pip install -r services/agent-workers/requirements.txt
PYTHONPATH=services/agent-workers services/agent-workers/.venv/bin/python -m agent_workers --once
```

Supply environment variables privately (see `.env.example`); the command does not automatically load dotenv files. Start with `AGENT_BUILDER=template` and `AGENT_COMMIT_MODE=dry-run`. Anurup must provision the sessions, surveys and agent-ledger aliases before polling. Dry-run still writes real survey/ledger documents; it does not write GitHub. Keep one worker.

For model builds set `AGENT_BUILDER=openai`, `AGENT_OPENAI_MODEL=gpt-4.1-mini`, and the private server-side `OPENAI_API_KEY`. The model was availability-probed on November 9 with a minimal HTTP 200 request; that check alone does not verify a generated page. Only approved answer enums and catalog session fields reach the model. Free-text goals do not.

For real commits set `AGENT_COMMIT_MODE=github` with a repository-scoped `GITHUB_TOKEN`. The only destination is `lukeeskinner/Backstage`, branch `agent/sites`, path `generated/sites/<validated attendee ID>/index.html`. The repository owner must create the token; do not reuse or extract interactive GitHub credentials. On the cluster Ahmed mounts Secret `agent-github`, key `GITHUB_TOKEN`. Do not put tokens on command lines, in browser bundles, or in handoffs.

OpenTelemetry uses the survey's traceparent and exports to the standard OTLP HTTP collector when configured. Never use attendee IDs as metric dimensions.

## Deployment handoff

Ahmed should install this directory's requirements, set `PYTHONPATH` to `services/agent-workers`, and run `python -m agent_workers` with one replica and a published source pin. Reuse the existing server-only Elastic and OpenAI Secrets. Required aliases are `<prefix>-sessions`, `<prefix>-surveys`, `<prefix>-agent-ledger`; the API owns interaction writes.

The generated-sites PR stays open for human/Gitar review during the demo. Repository ownership grants must reach main before the agent PR's path checks can accept them. The grant supplements review checks; it is not a substitute for a narrowly scoped GitHub token.

## Tests

```sh
PYTHONPATH=services/agent-workers python3 -m unittest discover -s services/agent-workers/tests
```

Use the same interpreter into which requirements were installed. Test transports must not contact GitHub, OpenAI or shared Elasticsearch. Real pipeline evidence is recorded separately in Luke's handoff log.

### Owner-only GitHub setup

Luke creates a fine-grained personal access token: resource owner `lukeeskinner`, repository access **Only select repositories → Backstage**, repository permission **Contents → Read and write**, short expiration. No administration or workflow permission is needed for generated HTML. GitHub documents these controls in [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).

Place the value directly in the cluster Secret editor as `agent-github.GITHUB_TOKEN`; do not send it in chat. Ahmed can mount that Secret without owning the repository. The worker never reads the operator's Git credential helper. If the token is absent, keep commit mode `dry-run`.
