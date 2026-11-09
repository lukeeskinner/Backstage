# Backstage review guidance

- Flag agent or worker tool calls that lack a server-side tier and scope allowlist check before execution. External side effects also require the plan and human acceptance gates described in the team handoff.
- Flag incident transitions that bypass the validated state machine, or committed transitions without a correlated OpenTelemetry span and protocol event.
- Flag reservation writes that lack a deterministic equipment-and-UTC-slot document ID and create-only semantics. Retries may resume a reservation only for the same incident and dispatch intent.


## Attendee site-builder agent

Apply these additional checks to the site-builder in `services/agent-workers/` and to generated site changes. Preserve the existing incident approval, transition and reservation rules above.

- Flag any site-builder GitHub write outside `generated/sites/<attendee_id>/index.html`, any target ref other than the literal `agent/sites`, or any path built before validating the full attendee ID against `^att_[a-z2-7]{12}$`. The builder must not write to `main`, choose its ref or path from model output, or merge its own pull request. Rebuilds must include the current file SHA. A person reviews the agent PR before merge.
- Flag any use of attendee free text, including `answers.goal`, in a code-writing prompt, generated HTML, commit message or public response. The model receives validated survey enums and trusted catalog fields only; the free-text goal is for Elasticsearch retrieval only. Require an explicit allowlist when building model inputs rather than passing whole survey documents.
- Flag generated pages with scripts, executable event-handler attributes (`on*=`), `javascript:` URLs, external URLs (including CSS resources), `@import`, or any `iframe`, `object`, `embed`, `form`, `link`, `base` or `meta http-equiv`. Reject bypasses through encoding, case changes or SVG. Require server-side validation of the final bytes before committing, not only prompt instructions; a rejected model page must use the validated template fallback.
- Require one complete HTML document with exactly one literal `<head>`, inline styles and system fonts, at most 60 KB. Recommended session elements must carry a valid `data-session-id` and the session title as text. Honor reduced motion and the attendee's accessibility selections. The served `site.html` and committed bytes must match `site.html_sha256`.
- Flag GitHub/OpenAI credentials or attendee free text in generated files, commit metadata, ledger entries, logs or frontend configuration. Tokens belong in server-side Secrets. Keep dry-run versus GitHub commits and template versus OpenAI builds explicit in the ledger; never fabricate a commit URL after a failed write.
- Treat the `agent` contributor grant as a pull-request path check, not a token permission boundary. It accepts the `agent/` branch prefix and `generated/sites/` directory; the builder must still enforce the narrower `agent/sites` ref and attendee file path at runtime. The owner-map grant does not create a token or prevent an overprivileged token from attempting another branch.
