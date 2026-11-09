# Backstage · 3-minute demo

**Pitch:** From five answers to a personal conference page—with every build explained.

| Time | Show | Say |
|---|---|---|
|0:00–0:25|QR/join survey; choose interests, experience and style.|“Conferences give everyone the same schedule. Backstage starts with what you want from the day.”|
|0:25–1:20|Submit; show real build progress and the generated page.|“Elasticsearch finds relevant sessions. The agent chooses a layout, builds the page and records its decisions.”|
|1:20–1:45|Save a session; show the mobile layout.|“The page works on a phone. Each interaction becomes useful feedback.”|
|1:45–2:15|Organizer trends, with simulated count visible.|“Organizers can see what people care about, what gets attention and what the agent built.”|
|2:15–2:45|Search schedule; open this attendee’s exact run.|“Every choice is searchable. Here is the reason, the build history and its recorded evidence.”|
|2:45–3:00|Show trace ID / real commit if present; close on the trail.|“Elasticsearch connects the experience. Dash0 observes it, Radar runs it, and Gitar reviews the code.”|

## Before recording

- Use the tested live API and a running worker, with a seeded catalog.
- Run `demo-three-minutes.mjs`; it makes a real survey and saves screenshots, a browser video and a JSON result. It never mocks responses.
- Install Playwright locally (`npm install --no-save playwright`, then `npx playwright install chromium`), or pass an existing module and browser using `PLAYWRIGHT_MODULE` / `PLAYWRIGHT_CHROMIUM`.
- Provide `BASE_URL` and `ORGANIZER_TOKEN` through the private environment. Never paste a token into the script or recording notes.
- `PACE=1` records the180-second tour. `PACE=0` checks the same path quickly.
- Read `report.json`: it records the actual builder, commit mode, run and trace. Say “template” when template was used; say “dry run” when no commit exists.

## Optional live tabs for a manual cut

- GitHub: open the commit recorded by the selected build. Do not show an unrelated commit as this person’s build.
- Dash0: open **Backstage attendee-site pipeline** in the Backstage organization/default dataset. Dashboard ID: `api-086bc190-c61b-438e-b6bb-234291bd4b27`. Trace IDs are correlation references; confirm ingestion before claiming it.
- Radar: show `team-backstage` and the currently deployed agent-worker/API versions. A source merge alone is not a deployment.

## Truthful demo boundaries

- Session catalog is synthetic. Simulated attendees remain labelled.
- The recorded local QA uses real Elasticsearch with template generation and dry-run GitHub; the hosted worker has separately demonstrated real GitHub publication.
- OpenAI requests are integrated, but do not claim successful model-generated pages until an accepted page is observed.
- Current generated pages live in a public repository. Do not describe their links as private.
