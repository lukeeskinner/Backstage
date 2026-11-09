# Kunj · Survey, attendee site, trends charts

Build what people touch: the survey on a phone, the moment a site appears, and the charts an organizer watches move.

- **Branch:** `kunj/attendee-site`
- **Paths:** `apps/web/`, `deploy/web/`, `docs/demo/`
- **Push log:** `docs/demo/handoff-log.md`
- **Read first:** the [kickoff](../README.md), especially "HTTP", "The generated page" and "Guardrails", then the [example payloads](../examples.v1.json)

## Build order

| Clock | Step | Done when |
| --- | --- | --- |
| T+0 to T+10 | 1 · Routes on mock data | `#/join`, `#/site/<id>`, `#/trends` and `#/trail` render from the examples |
| T+5 to T+20 | 2 · Survey | A phone submits five answers and lands on its site route |
| T+15 to T+30 | 3 · Building and site | Gate 2: a real page renders and a tap is recorded |
| T+25 to T+40 | 4 · Trends | Five charts move with live data and filter on click |
| T+35 to T+45 | 5 · Trail mount, proxy, rollout | Gate 3: the public host serves all of it |
| T+45 to T+55 | 6 · Demo | Script rehearsed once end to end |

### 1 · Routes on mock data

- Add `site`, `trends` and `trail` to `Route`, `useHashRoute` and the nav. Parse the id from `#/site/<attendee_id>`. Keep `#/join` as the survey entry: the projector QR already points there.
- Serve the examples through the existing `VITE_MOCK_API` switch until Anurup's typed client lands at T+10 (`apps/web/src/api/pivot.ts`). After that, import his types and stop maintaining your own.
- You own `App.tsx` and the routing files for this hour. Anurup adds files only under `src/api/` and `src/diagnostics/`.

### 2 · Survey

Extend `JoinPage`. One screen, large touch targets, about twenty seconds to finish.

1. Role: keep the four existing choices and keep calling presence join, so the floor count still works.
2. Interests: pick up to three of the ten topics in the kickoff.
3. Level: new, practitioner or expert.
4. Goal: one optional line, at most 140 characters.
5. Look and comfort: calm, bold or playful, plus larger text, reduced motion and high contrast.

- Replace the privacy note with what is now true: no names or emails; answers shape your site and add to anonymous trend counts; your site lives at a private link.
- On submit, `POST /api/v1/attendee/surveys`, go to `#/site/<attendee_id>`, and keep the id in `localStorage` so a refresh comes back to the site.
- A 429 gets a plain sentence and a retry button. Keep the accessible names and focus handling the page already has.

### 3 · Building and site

- Poll `GET /api/v1/attendee/{id}` every 2 s. While `queued` or `building`, show `progress[]` as steps that arrive one at a time.
- When `ready`, render `site.html` in `<iframe sandbox="allow-same-origin" srcdoc>`. Never add `allow-scripts`: scripts stay off inside the frame, and same-origin lets the parent page reach in.
- Before setting `srcdoc`, insert `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` right after the literal `<head>`.
- From the parent, attach listeners to every `[data-session-id]` element in the frame's document and size the frame to its content. A tap on `[data-action]` sends `save` or `dismiss`; any other tap on the card sends `open`. Post to `/interactions` with the card's position.
- If the listeners prove unreliable on a phone, render a native "Your picks" strip under the frame from `recommendations` and record taps there.
- Footer outside the frame: "Built for you by the Backstage agent" with the short commit SHA linking to `site.commit_url`. Dry-run builds have no link; show the short page hash from `site.html_sha256` instead.
- On `failed`, show the recommendations as a plain native list. Nobody should end on an error.

### 4 · Trends

`#/trends`, organizer token, polling `GET /api/v1/pivot/trends` every 5 s. Draw with SVG; adding a chart library risks the in-cluster build.

1. Interests over time: one line per topic, a tooltip on hover or focus, and a legend that isolates a topic on click.
2. Who is here: bars for role, level and vibe.
3. Recommended against opened, per session: paired bars, most recommended first.
4. What the agent decided: bars for theme and layout.
5. Builds per minute, with p50 and p95 build time as two numbers beside it.

- Clicking a topic anywhere sets `?interest=` and refetches, so every chart filters together.
- When `totals.simulated` is above zero, show "Includes N simulated attendees" and a toggle that sends `source=qr`.
- Give each chart a table alternative for screen readers.

### 5 · Trail mount, proxy, rollout

- Mount Anurup's component at `#/trail` with one line: `<TrailConsole client={client} mockMode={MOCK_MODE} />`. Tell him the route names at T+10.
- In `deploy/web/nginx.conf`, add a location for `/api/v1/attendee/` ahead of the general API block, with its own `limit_req` zone and a 4 KB body cap. Every phone at the venue arrives from one gateway address, so key the zone on something other than the client IP or set the rate for the whole room.
- Web rollouts take several minutes because vision dependencies reinstall. Plan for two: about T+20 and T+40. Tell Ahmed before each one because of the CPU quota. Dropping the vision sidecar for this hour would make rollouts fast; that is your decision.

### 6 · Demo

- Put the three-minute script from the kickoff into `docs/demo/` with the exact screens and who drives each one.
- The projector view shows the QR code, a live count of sites built, and the latest commit subject.

## Handoffs

**You give:** route names and the `TrailConsole` mount at T+10 (Anurup); web SHA at T+35 (Ahmed), or roll it yourself after telling him.

**You get:** typed client at T+10 and a live API on the public host at T+15 (Anurup); first real page at T+30 (Luke); simulated traffic at T+20 (Ahmed).

**Until they arrive:** the examples file has a `building` and a `ready` response, a trends payload and a trail payload. Point local Vite at the public API once gate 1 passes; `http://localhost:5173` is already an allowed origin.

## Stretch

- A "Rebuild with what I liked" button once Luke's rebuild exists.
- The projector shows new sites arriving as they are committed.
