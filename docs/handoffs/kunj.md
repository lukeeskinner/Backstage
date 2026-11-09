# Kunj · Web, accessibility, and Dash0

Read the [team updates](README.md) before work and append a note in your lane's log with every push.

Read the [full team handoff](../../BACKSTAGE-team-agent-handoff.md), then branch from `main` with `git switch -c kunj/overflow-board`. Own `apps/web/`, `observability/`, `deploy/web/`, `deploy/dash0/`, and `docs/demo/`.

1. Run `make smoke SCENARIO=overflow` and `make dev SCENARIO=overflow` from the repo root. Browse the [HTTP contract](../../contracts/openapi.yaml) and [examples](../../fixtures/shared/http.examples.json). Keep a stateful browser mock in your lane for approve, ack, and polling. See [Luke’s Room B API update](luke-log.md#2026-11-09--room-b-overflow-api-available-for-web-integration) for the branch and commands to try the real flow.
2. Ship the organizer board, staff actions, and sanitized projector/status views. Send a fresh `Idempotency-Key` for each new intent and retry the same intent with the same key and body. Refresh on a stale 409, surface 403, and keep the board in verification until the API reports resolution.
3. Verify keyboard-only approval and acknowledgement, visible focus through refresh, a polite live region, and text for priority and state. Add the stage mic/caption metadata producers after the overflow flow. Use a stage-scoped token and omit caption text from signals.
4. Publish the collector endpoint, propagate trace context, and show the incident trace and timing views in Dash0 once access is available. Keep ingest credentials server-side.

First PR acceptance is a keyboard-operable overflow flow using the shared fixtures. Include the contract revision, exact run commands, and any Dash0 or API dependencies. Coordinate shared schema changes with Luke.

## 2026-11-09 — Canvas restyle, guided demo mode, live incident scenes and venue map

- Branch or PR: `kunj/canvas-ui` (draft #27) and `kunj/demo-tour` stacked on it.
- Changes and why:
  - Restyle `apps/web` to the BACKSTAGE canvas: warm ground, pill role switcher and nav, Plex Mono instead of the pixel font, a zero-specificity pill reset for every `button` so no native grey buttons remain, one 44px button size.
  - In mock mode the evidence panel shows a quiet note instead of a red "Diagnostics unavailable" alert.
  - Demo mode (`src/tour/`): "Start demo" in the header or `?tour=1` swaps in a private in-browser `MockIncidentApi` (`startHidden`, `raise()`, `raiseBackground("stage_av" | "badge_stall")`) even on the live build, then walks 25 captioned steps through video detection, the queue, approval, dispatch, inbox accept, verification, evidence, search, history, attendee status, check-in and projector. The browser speaks each caption; the voice can be switched off.
  - Animated scenes per incident type in `src/visuals/IncidentVisual.tsx`: overflowing room, dead mic, stalled badge queue. Affected rooms pulse on the status page.
  - Venue map (`src/venue/floor.ts`, `src/visuals/FloorMap.tsx`): 11 named areas, 12 volunteers by domain, simulated occupancy, dispatched volunteers walk to the incident. Shown on the board in mock and demo mode only. Layout is schematic and occupancy is simulated; real capacities are not published.
  - `npm run record:tour` (Playwright 1.65.0 with system Chrome) records the full run and mixes a macOS `say` voiceover at each step start into `recordings/backstage-demo.mp4`.
- Impact by lane, including setup or contract changes: none outside `apps/web`; no contract change. Live deploy note: the cluster `web` Deployment `CODE_SHA` was patched to `36c5b99` (#27) through Radar. Ali's overlay will revert it on the next apply; roll back with `690fc6a`.
- Verified commands and results: `npm run typecheck` clean; `npx vitest run` 23 files, 154 tests passed; `node scripts/record-tour.mjs` produced a 4 min 17 s MP4 with every step reached.
- Open issues and next owner or action: Kunj to merge #27 then the tour PR and redeploy; better voice needs a Premium macOS voice or a server-side TTS call.
- References and latest handoffs reviewed: `origin/main` at `690fc6a`; this log had no earlier entries.

## 2026-11-09 — Demo mode now includes the video-to-incident rehearsal

- Branch or PR: `kunj/demo-tour` (#32), now merged with `origin/main` (`#31` pivot lanes) and `origin/kunj/video-incident-rehearsal` (#30, `22a226c`).
- Changes and why: `IncidentRehearsal` takes an optional `RehearsalDriver`. Without it the panel uses the server `/demo-api` exactly as in #30. In mock and demo mode `src/demo/mockRehearsal.ts` drives it from the in-browser mock, labelled "Demo mode · simulated rehearsal", and the panel shows the live incident scene. The tour gains an `inject` step that presses Inject crowd surge so the incident opens beside the playing video.
- Impact by lane, including setup or contract changes: none; the live rehearsal path, tokens and nginx routes from #30 are unchanged.
- Verified commands and results: `npx tsc --noEmit` clean; `npx vitest run` 24 files, 157 tests passed; `npm test` node suites 37 passed; `node scripts/record-tour.mjs` reached all 26 steps, 4 min 39 s with voiceover.
- Open issues and next owner or action: merge order #27 → #30 → #32. The recording is not committed (`recordings/` is ignored).
- References and latest handoffs reviewed: `docs/demo/video-incident-rehearsal.md` and `docs/demo/handoff-log.md` on #30.

## 2026-11-09 — Kokoro voiceover and high-quality demo recording; #32 deployed

- Branch or PR: `kunj/demo-tour` (#32). Cluster `web` Deployment `CODE_SHA` patched from `bee876c` (Codex rehearsal) to `71741b3` through Radar; it contains `bee876c`, and the `web-rehearsal` Secret references were left in place. Roll back by setting `bee876c900507066c73c2a1a7ae3c4ac677f5afb`.
- Changes and why: `scripts/record-tour.mjs` captures Chrome screencast frames at 2x pixel density and encodes 2560x1440, 30 fps, H.264 CRF 16. The voiceover defaults to Kokoro-82M through `scripts/kokoro_tts.py` (`af_heart`); `TTS=say` and `TTS=none` remain. Narration text uses speech spellings (`spoken()` in `src/tour/script.ts`).
- Impact by lane, including setup or contract changes: recording needs `pip install "kokoro>=0.9.4" soundfile` and, on macOS, `brew install espeak-ng`, because the bundled espeak-ng looks for data under its CI build path.
- Verified commands and results: typecheck clean; vitest 24 files, 157 tests passed; live `/healthz` 200 serving the `71741b3` bundle; full recording 5 min 17 s at 2560x1440 with 26 narrated steps.
- Open issues and next owner or action: Ali's overlay will reset `CODE_SHA` on the next apply; merge #27, #30, #32 so the overlay can pin a merged SHA.
- References and latest handoffs reviewed: #30 `docs/demo/video-incident-rehearsal.md`.
