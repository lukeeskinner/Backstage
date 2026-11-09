# Pivot orchestration evidence

- First real isolated API/worker run:15/15 checks passed, six recommendations, template/dry-run page4209bytes, ten ledger events.
- Real browser pass:56.136seconds, survey→site→save→trends→trail; no page exceptions; no horizontal overflow at390/768/1440px. Synthetic QA data only.
- Dash0 returned29 correlated API/worker spans for trace `c08286c4d9a497fd370ce3a797eec931`:5API plus24worker spans. This does not yet prove browser-span ingestion for the pivot.
- Created dashboard **Backstage attendee-site pipeline**, ID `api-086bc190-c61b-438e-b6bb-234291bd4b27`, Backstage/default. All six queries valid; Elasticsearch and API series observed. New survey/tap metrics had no observations at23:44UTC.
- Independent review: five boundary fixes passed scoped review and merged inPR40. Worker accepted-write timeout independently reproduced; Luke’s PR38 removed per-write refresh waits.
- Verified source refs: main58450db; Anurup8ef7abb; worker e3df36f plus cadence0795c57; Kunjtrailmount452a6d5. Local recording source includes these changes only when stated in its report.

## Remaining handoffs

- **Kunj/Luke — privacy wording:** generated attendee IDs appear in public GitHub paths and are also the capability for public attendee reads. Remove the claim that links are private before real participant onboarding; disclose public generated pages/preferences, or separate a secret capability from the public build ID. The goal remains omitted. No claim that this is fixed.
- **Kunj — resize quality:** manual inspection found a large empty area below generated cards after resizing the iframe from desktop to phone and back. `SiteFrame.measure()` reads documentElement.scrollHeight while retaining its previous height, so it cannot shrink. Re-measure intrinsic content with a reset height and test the resize sequence.
- **Luke/Ahmed:** persist deployed worker cadence fix and verify browser→API→worker trace for the final release.
- **Anurup/Ahmed:** API must deploy the PR40 fixes; a Git merge alone does not prove the pod uses them.

[Judge-facing submission](submission.md) · [Three-minute demo](demo-script.md) · [Playwright script](demo-three-minutes.mjs)

## 23:56 UTC hosted queue blocker

Fresh real browser survey201 at23:54:24UTC (`att_4f42wtj3wswe`, sourcedqr) remainedqueued beyond90seconds, behind earlier simulator records. The frontend itself has no exception. **Luke:** prioritize qr builds ahead of simulator in the queued-survey query while retaining oldest-first ordering inside each class. **Ahmed:** keep further simulated waves stopped until the current backlog drains; do not clear real surveys. This is separate from the fixed ledger-refresh error. A three-minute live demo cannot depend on a fresh scan waiting behind the simulator.

The timed isolated recording passed180.004seconds,17checks andzero browserexceptions: attendeeatt_nwqyburnujpn, runrun_w5xojutinczx, tracee88388113c61baaa49a4fe0b26806d22. Localtemplate/dryrun only.
