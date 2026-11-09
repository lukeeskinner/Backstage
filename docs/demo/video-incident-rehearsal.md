# Video incident rehearsal

The video keeps playing while a real incident opens, agents propose a plan and scoped role inboxes update. The crowd surge is injected rehearsal evidence, not a claim that the prerecorded people exceeded a real venue capacity. YOLO measurements remain independently visible.

## Run on the hosted site

1. Open https://backstage.cnh.radarhq.io/#/demo as the configured organizer. Start the clip and choose Run YOLO live. Keep the prerecorded/source label visible.
2. Press Inject crowd surge once. The server submits current-time seating30/30 and door8/threshold5 every five seconds. After at least30 seconds the normal incident API raises Room B overflow, the Venue agent claims/proposes, and the panel shows the committed protocol events. Signal IDs begin demo-video-<run UUID>.
3. Read the proposal; press Approve plan. The normal API dispatches to a named venue staff identity. Keep that identity's authorized inbox open on a second browser/device; it polls the same API and shows Needs you. Selecting a role alone grants no access: enter its existing role token.
4. The assigned person presses Accept assignment (or Acknowledge assignment in their inbox). The organizer then presses Clear surge & verify recovery. The server sends door2/threshold5. The incident stays verifying until sixty seconds of fresh evidence pass; the API alone marks it resolved.
5. Open saved history/evidence and the attendee projector. History retains the run's incident and audit events; the attendee projection moves affected → recovering → normal. Keep agent actors, human approvals and verification separate in the narration.

The video page shows compact live actions and the protocol feed beside the video on a wide display. Open Inspect saved evidence for checkpoint/projection facts. In-app notifications are scoped inbox updates and polite announcements; there is no Slack, SMS, email or Grok integration in this rehearsal.

## Server configuration and failure behavior

Node reads optional web-rehearsal Secret keys DEMO_OPERATOR_TOKEN (one existing organizer bearer) and DEMO_SIGNAL_TOKEN (existing cam-b/room-b zone_count producer). Only Node receives them. nginx exposes /demo-api/ with no access logging/cookies. Server compares the configured organizer credential in constant time and verifies incident API access; the selected UI tier is not authority. Cross-origin browser commands are rejected. No models, room, threshold, arbitrary signal body or target URL can be supplied by the client. Producer access was explicitly approved by the user.

One run is allowed at a time, bounded to eight minutes. Repeat start intent returns the same run; repeat recover never restarts the recovery clock. The producer continues across navigation, but its in-memory scheduler stops on web restart; persisted API incidents/events remain. API failure pauses visibly without assuming success, replaying old timestamps or resetting incidents. A paused run requires operator review; finish any already-created incident through normal evidence before replacing the runtime. Do not restart it mid-rehearsal. The deployment remains one replica.

## Earlier risk report, reconciled

- Hosted YOLO, web, incident API and Dash0 are now connected; browser events and API traces have provider readback. The old missing-services, empty badge API URL and unmerged evidence statements predate the cluster release. See cluster-rollout.md and the Ali/Anurup handoffs for exact evidence.
- Live OpenAI session mint was verified. Physical microphone, full voice audio, physical camera permission and hall-network behavior still require the demo operator's hardware test.
- Radar badge diagnosis is still mock without its service token; badge queue persistence is still an Ali-owned dependency. Neither is used to fake this overflow flow.
- Venue map labels, final submission time and on-site rehearsal timing require confirmation from the event organizer. A software change cannot establish these facts.

Validation and deployed incident IDs are appended to handoff-log.md after the hosted rehearsal.
