# Shared cluster release — 2026-11-09

The demo is at https://backstage.cnh.radarhq.io/#/demo on cluster backstage, namespace team-backstage. Web source is 36c5b995340fb5fb18e247b1bdf52edfc813108d; API source is f536b757fe510b3af8a4db76a09fd88d81ae6213. This supersedes the earlier static-only vision and missing HTTPS limitations.

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
