# Shared cluster release — 2026-11-09

The demo is at https://backstage.cnh.radarhq.io/#/demo on cluster backstage, namespace team-backstage. Web source is bee876c900507066c73c2a1a7ae3c4ac677f5afb; API source is f536b757fe510b3af8a4db76a09fd88d81ae6213. This supersedes the earlier static-only vision and missing HTTPS limitations.

## Running services

Web has three ready containers: nginx, the loopback Node presence/voice runtime and CPU YOLO. Its effective CPU limit is 1.5 cores, within the event’s 10-core team quota. Collector 0.164.0 is 1/1 at 250m CPU. The API is one writer with durable Elastic state. Badge control, both stations and the unused starter app were preserved without queue resets.

The host gateway reaches Service/app, whose selector Ali changed to web. The proposed vcluster HTTPRoute edit was cancelled, never applied. Whole-selector JSON cutover and rollback patches are in deploy/web/cluster; rollback targets the verified unchanged starter Deployment selector app: app. The organizer-managed GitOps source is outside this checkout.

OpenAI and Dash0 values are in Kubernetes Secrets referenced only by their server containers. Generated Backstage identities and existing Elastic credentials were preserved. The browser uses an existing Backstage operator token; no OpenAI key is entered in the product. Saved output suppresses credentials and ephemeral secrets.

## Deployment verification

- Private Job web-vision-smoke passed root/stage 200, authorized incident read 200 versus missing bearer 401, video Range 206, and 120 recorded YOLO samples. Detector returned 401 without a role, 403 for a producer and 200 for a human. A real first clip frame returned one person at 2586ms cold. Private reset/OpenAI routes returned 404.
- Actual OpenAI briefing mint returned 200 with only list_incidents, get_incident_events and get_status. The ephemeral value was discarded. Microphone audio and a full WebRTC conversation were not tested.
- The HTTPS browser ran fresh cluster inference on the 30-second conference clip, displaying eight detections at 251ms on the final captured frame. Sampled-frame transfer is disclosed. No physical camera permission was requested; preview counts never post lifecycle evidence.
- The separate strict evidence alias was provisioned from checksum-verified upstream files. API search returned eight committed events, projection current, no last_error, and matching checkpoint/index revisions seq_no10/primary_term1. The saved badge incident remains resolved and durable, with eight timeline events. Deployment synthesized no lifecycle transitions.
- Dash0 SQL read back public-proxy trace 19d1c7278bdf4d37b9b5d32f308dcd1a, span hosted-deployment-smoke, service backstage-cluster-smoke. API source f536b757 also produced 334 observed spans in the queried window. Browser events are stored in web_events: SQL returned 987 events for service web at source 36c5b995340fb5fb18e247b1bdf52edfc813108d in a ten-minute window. Their absence from spans was a table-selection mistake, not an export failure.

Local release checks: 147 frontend, 30 Node and four Python tests pass; TypeScript and final Docker production build pass. Strict kubeconform validates two web and three collector resources. Gitar’s shared rate-budget finding was fixed.

A concurrent UI rollout replaced the prior web pod during the longer check, producing temporary 503s. The newer warm canvas UI includes all hosted vision and auth fixes; it was retained and fresh inference was rechecked after all three containers became ready.

## Remaining limits

Physical webcam/microphone and full voice audio remain untested. The stage caption producer is the existing monitor/fixture, not live transcription. Badge Radar diagnosis remains mock without a service token. Presence and badge queues are in memory. Luke must retain live API projection/OTLP flags in his overlay; Ali must use the new web overlay and collector1 before reapplying his platform overlay.


## Video-to-incident rehearsal

The video page now has organizer-only injected crowd-surge controls and a live scoped incident/action feed beside YOLO. User explicitly approved server-only producer access. Fixed rehearsal counts use real signal ingress; they are labeled separately from measured video counts. Existing agents, role inboxes, audit history and the attendee projector follow the same incident. See video-incident-rehearsal.md.

First hosted run f159236d-10c6-4e84-b8ac-7357df8a719f created inc-overflow-2572a6a8ca394003add41b223b3e180b: raised23:06:03UTC, human keyboard approval23:06:13, venue-staff-01 keyboard acceptance23:06:29, verify23:06:32, resolved after63.925s of qualifying evidence. The UI was observed pending at52.228s; projector Recovering. Version8, durable Elasticsearch checkpoint and current search projection60/1. Dash0 read back the actual incident trace dfb691d4741a5b0d8229699c756d4011.

Final source adds strict Bearer handling, valid traceparent propagation on scheduled signals,48rem two-column presentation, separate repeat-run evidence and keyboard focus retention. JPEG proxy buffering is disabled with a1MiB memory/body bound after live logs exposed nginx temporary-file buffering.150 frontend/37 Node tests and explicit live-mode build pass; production Docker/nginx configuration and strict web manifest checks pass. Final web Pod web-99bd97cc5-lhfms has both init containers Completed and all three runtime containers Ready. Both deployed lifecycle rehearsals passed; the second result is below.


Second run0de83610-8b16-41ef-a6bc-33370bb21976 created inc-overflow-406d947b14f841e88154b81995ac4765 at23:17:48UTC. Keyboard approval23:18:14, venue-staff-01 inbox acceptance23:18:33, verify23:18:35, close23:20:03 after64.586s of qualifying below-threshold evidence. Still pending at58.806s, then resolved/version8 with durable checkpoint/search revision122/1 and projection current. Projector returned to Normal. The scheduler stopped and Inject crowd surge is ready for another run.

Dash0 SQL joined one browser.request event at releasebee876c to API trace d0420000bed3cc44e2e1203b897e4279: eight incident.transition spans, eight attempts, sixty HTTP and sixty Elasticsearch save spans in the observed window. Final browser metadata also had123 web_events in an earlier readback. The normal959px browser has no horizontal overflow and video/incident rectangles are adjacent. Final gateway logs showed no JPEG temporary-file warnings after the bounded streaming fix; OTLP buffering warnings are unrelated to frames.
