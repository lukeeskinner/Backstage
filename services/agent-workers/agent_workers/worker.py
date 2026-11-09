"""One bounded site-builder worker. Elasticsearch is the queue and audit ledger.

No survey free text is passed to the builder, logs, telemetry or GitHub. All survey
mutations use optimistic concurrency and retain run ownership through publication.
"""
from __future__ import annotations

import base64
from collections import deque
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import os
import re
import secrets
import ssl
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import certifi

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from .builder import build_page
from .validation import validate_page

LOGGER = logging.getLogger("backstage.agent_workers")
REPOSITORY = "lukeeskinner/Backstage"
BRANCH = "agent/sites"
ATTENDEE_ID = re.compile(r"^att_[a-z2-7]{12}$")
SESSION_ID = re.compile(r"^sess-[0-9]{3}$")
RUN_ID = re.compile(r"^run_[a-z2-7]{12}$")
SHA = re.compile(r"^[0-9a-f]{40,64}$")
TRACEPARENT = re.compile(r"^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")
ANSWER_FIELDS = frozenset({"role", "interests", "level", "vibe", "accessibility"})
DECISIONS = frozenset({"theme", "layout", "tone", "featured"})


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def new_run_id() -> str:
    return "run_" + "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz234567") for _ in range(12))


def status_code(error: Exception) -> int | None:
    return getattr(error, "status_code", None) or getattr(getattr(error, "meta", None), "status", None)


class WorkerError(Exception):
    """Fixed safe code, never transport or model exception text."""


class ClaimLost(WorkerError):
    pass


class GitHubError(WorkerError):
    def __init__(self, status: int | None = None):
        self.status = status
        super().__init__("github_unavailable")


@dataclass(frozen=True)
class Settings:
    index_prefix: str = "backstage-demo"
    builder: str = "template"
    commit_mode: str = "dry-run"
    sim_commit_every: int = 10
    max_builds_per_hour: int = 300
    poll_seconds: float = 2.0
    service_version: str = "development"

    def __post_init__(self):
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", self.index_prefix):
            raise ValueError("Invalid Elasticsearch index prefix")
        if self.builder not in {"template", "openai"} or self.commit_mode not in {"dry-run", "github"}:
            raise ValueError("Invalid builder or commit mode")
        if not isinstance(self.sim_commit_every, int) or self.sim_commit_every < 1:
            raise ValueError("AGENT_SIM_COMMIT_EVERY must be positive")
        if not 1 <= self.max_builds_per_hour <= 300 or self.poll_seconds < 2:
            raise ValueError("Worker limits must be at most 300/hour and poll no faster than 2 seconds")

    @classmethod
    def from_env(cls, env=None):
        env = os.environ if env is None else env
        if env.get("GITHUB_REPO", REPOSITORY) != REPOSITORY or env.get("AGENT_BRANCH", BRANCH) != BRANCH:
            raise ValueError("Agent commits are limited to lukeeskinner/Backstage on agent/sites")
        return cls(index_prefix=env.get("ELASTICSEARCH_INDEX_PREFIX", "backstage-demo"),
                   builder=env.get("AGENT_BUILDER", "template"), commit_mode=env.get("AGENT_COMMIT_MODE", "dry-run"),
                   sim_commit_every=int(env.get("AGENT_SIM_COMMIT_EVERY", "10")),
                   max_builds_per_hour=int(env.get("AGENT_MAX_BUILDS_PER_HOUR", "300")),
                   service_version=env.get("CODE_SHA", env.get("OTEL_SERVICE_VERSION", "development")))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubPublisher:
    """Only the GitHub Contents endpoint for one constrained generated path."""

    def __init__(self, token: str, opener=None):
        if not token:
            raise ValueError("GITHUB_TOKEN is required for GitHub commits")
        self._token = token
        self._open = opener or build_opener(_NoRedirect(), HTTPSHandler(context=ssl.create_default_context(cafile=certifi.where()))).open

    def _request(self, method, path, body=None):
        req = Request("https://api.github.com" + path,
                      data=None if body is None else json.dumps(body).encode(), method=method,
                      headers={"Authorization": "Bearer " + self._token,
                               "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
                               "User-Agent": "backstage-site-agent", "Content-Type": "application/json"})
        try:
            with self._open(req, timeout=10) as response:
                return json.loads(response.read(2_000_000))
        except HTTPError as error:
            raise GitHubError(error.code) from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise GitHubError() from None

    def publish(self, attendee_id: str, html: str, run_id: str, spec: dict, trace_id: str):
        if not ATTENDEE_ID.fullmatch(attendee_id) or not RUN_ID.fullmatch(run_id):
            raise WorkerError("invalid_identifier")
        path = f"generated/sites/{attendee_id}/index.html"
        endpoint = f"/repos/{REPOSITORY}/contents/{path}"
        previous_sha = None
        try:
            previous = self._request("GET", endpoint + "?" + urlencode({"ref": BRANCH}))
            previous_sha = previous.get("sha")
            if previous.get("type") != "file" or not isinstance(previous_sha, str) or not SHA.fullmatch(previous_sha):
                raise WorkerError("invalid_github_file")
        except GitHubError as error:
            if error.status != 404:
                raise
        # Only enum-like values from the validated spec enter commit metadata.
        choices = {"theme": {"calm-paper", "bold-contrast", "playful-pop", "high-contrast"},
                   "layout": {"schedule-first", "topic-clusters", "single-focus"},
                   "tone": {"direct", "warm", "energetic"}}
        def enum(name, fallback):
            value = spec.get(name, fallback)
            if name == "theme" and isinstance(value, dict):
                value = value.get("name")
            return value if isinstance(value, str) and value in choices[name] else fallback
        featured = []
        for item in spec.get("featured", []):
            value = item.get("session_id") if isinstance(item, dict) else item
            if isinstance(value, str) and SESSION_ID.fullmatch(value):
                featured.append(value)
        message = (f"site({attendee_id}): {enum('theme', 'calm-paper')} {enum('layout', 'schedule-first')} build\n\n"
                   f"run: {run_id}\ndecisions: theme={enum('theme', 'calm-paper')}; layout={enum('layout', 'schedule-first')}; tone={enum('tone', 'direct')}\n"
                   f"featured: {', '.join(featured)}\ntrace: {trace_id if re.fullmatch('[0-9a-f]{32}', trace_id) else 'unavailable'}")
        body = {"message": message, "content": base64.b64encode(html.encode("utf-8")).decode("ascii"),
                "branch": BRANCH, "author": {"name": "backstage-site-agent", "email": "site-agent@backstage.invalid"}}
        if previous_sha:
            body["sha"] = previous_sha
        result = self._request("PUT", endpoint, body)
        commit_sha = result.get("commit", {}).get("sha")
        if not isinstance(commit_sha, str) or not SHA.fullmatch(commit_sha):
            raise WorkerError("invalid_github_response")
        return {"mode": "github", "sha": commit_sha, "url": f"https://github.com/{REPOSITORY}/commit/{commit_sha}",
                "branch": BRANCH, "path": path, "message": message, "additions": len(html.splitlines())}


class Worker:
    def __init__(self, client, settings: Settings | None = None, *, publisher=None, builder: Callable = build_page,
                 validator: Callable = validate_page, tracer=None, now=utc_now, monotonic=time.monotonic,
                 run_id_factory=new_run_id):
        self.client = client
        self.settings = settings or Settings()
        self.publisher = publisher
        self.builder = builder
        self.validator = validator
        self.tracer = tracer or trace.get_tracer("backstage.agent_workers")
        self.now, self.monotonic, self.run_id_factory = now, monotonic, run_id_factory
        self.surveys = self.settings.index_prefix + "-surveys"
        self.sessions = self.settings.index_prefix + "-sessions"
        self.ledger = self.settings.index_prefix + "-agent-ledger"
        self._recent = deque()
        self.last_outcome = "idle"

    @contextmanager
    def _span(self, step, **attributes):
        with self.tracer.start_as_current_span("agent." + step, attributes=attributes,
                                              record_exception=False, set_status_on_exception=False) as span:
            try:
                yield span
            except Exception:
                span.set_status(Status(StatusCode.ERROR))
                raise

    def _log(self, outcome, *, attendee_id=None, run_id=None):
        self.last_outcome = outcome
        value = {"event": "agent.run", "outcome": outcome}
        if attendee_id and ATTENDEE_ID.fullmatch(attendee_id): value["attendee_id"] = attendee_id
        if run_id and RUN_ID.fullmatch(run_id): value["run_id"] = run_id
        LOGGER.info(json.dumps(value, sort_keys=True))

    def run_once(self) -> bool:
        """Process at most one survey. False means idle, capped or another worker won."""
        self.last_outcome = "idle"
        now = self.now()
        while self._recent and self._recent[0] <= now - timedelta(hours=1):
            self._recent.popleft()
        if len(self._recent) >= self.settings.max_builds_per_hour:
            return False
        # Ledger-based cap survives process restarts. One deployed worker is required.
        counted = self.client.count(index=self.ledger, query={"bool": {"filter": [
            {"term": {"step": "claim"}}, {"term": {"outcome": "ok"}},
            {"range": {"@timestamp": {"gte": stamp(now - timedelta(hours=1))}}}]}})
        if counted["count"] >= self.settings.max_builds_per_hour:
            return False
        result = self.client.search(index=self.surveys, query={"term": {"site.status": "queued"}},
                                    sort=[{"created_at": "asc"}], size=1, seq_no_primary_term=True)
        hits = result.get("hits", {}).get("hits", [])
        if not hits:
            return False
        hit = hits[0]
        attendee_id = hit.get("_id", "")
        survey = deepcopy(hit.get("_source", {}))
        if not ATTENDEE_ID.fullmatch(attendee_id) or survey.get("attendee_id") != attendee_id:
            self._log("invalid_survey")
            return False
        run_id = self.run_id_factory()
        if not RUN_ID.fullmatch(run_id):
            raise WorkerError("invalid_run_id")
        parent = survey.get("traceparent")
        context = TraceContextTextMapPropagator().extract({"traceparent": parent}) if isinstance(parent, str) and TRACEPARENT.fullmatch(parent) else None
        with self.tracer.start_as_current_span("agent.run", context=context,
                                              attributes={"attendee.id": attendee_id, "agent.run_id": run_id},
                                              record_exception=False, set_status_on_exception=False) as span:
            return self._build(hit, survey, attendee_id, run_id, span)

    def _build(self, hit, survey, attendee_id, run_id, root_span):
        started = self.monotonic()
        source = survey.get("source")
        if source not in {"qr", "simulator"}:
            self._log("invalid_source", attendee_id=attendee_id)
            return False
        requested_builder = "template" if source == "simulator" else self.settings.builder
        actual_builder = requested_builder
        seq = 0
        claimed = False
        published = False

        def emit(kind, step, title, detail, tool, outcome="ok", **fields):
            nonlocal seq
            seq += 1
            current = trace.get_current_span().get_span_context()
            event = {"event_id": f"{run_id}:{seq:04d}", "run_id": run_id, "attendee_id": attendee_id, "seq": seq,
                     "@timestamp": stamp(self.now()), "kind": kind, "step": step, "title": title, "detail": detail,
                     "tool": tool, "outcome": outcome, "builder": actual_builder, "source": source,
                     "trace_id": f"{current.trace_id:032x}", "span_id": f"{current.span_id:016x}",
                     "service": "agent-workers", "service_version": self.settings.service_version, **fields}
            try:
                self.client.index(index=self.ledger, id=event["event_id"], document=event, op_type="create",
                                  require_alias=True, refresh="wait_for", include_source_on_error=False)
            except Exception as error:
                if status_code(error) == 409:
                    existing = self.client.get(index=self.ledger, id=event["event_id"])
                    if existing.get("_source") == event:
                        return
                raise WorkerError("ledger_write_failed") from None

        def owned_update(changes):
            current = self.client.get(index=self.surveys, id=attendee_id)
            site = current.get("_source", {}).get("site", {})
            if site.get("status") != "building" or site.get("run_id") != run_id:
                raise ClaimLost("claim_lost")
            updated = {**site, **changes, "updated_at": stamp(self.now())}
            try:
                self.client.update(index=self.surveys, id=attendee_id, doc={"site": updated},
                                   if_seq_no=current["_seq_no"], if_primary_term=current["_primary_term"],
                                   require_alias=True, refresh="wait_for")
            except Exception as error:
                if status_code(error) == 409:
                    raise ClaimLost("claim_lost") from None
                raise WorkerError("survey_write_failed") from None

        try:
            with self._span("claim"):
                old_site = survey.get("site", {})
                attempt = old_site.get("attempt", 0)
                if old_site.get("status") != "queued" or not isinstance(attempt, int) or not 0 <= attempt < 2:
                    return False
                new_site = {**old_site, "status": "building", "run_id": run_id, "attempt": attempt + 1,
                            "updated_at": stamp(self.now())}
                try:
                    self.client.update(index=self.surveys, id=attendee_id, doc={"site": new_site},
                                       if_seq_no=hit["_seq_no"], if_primary_term=hit["_primary_term"],
                                       require_alias=True, refresh="wait_for")
                except Exception as error:
                    if status_code(error) == 409:
                        return False
                    raise WorkerError("claim_failed") from None
                claimed = True
                self._recent.append(self.now())
                emit("action", "claim", "Started building your site", f"Claimed the queued survey using optimistic concurrency. Attempt {attempt + 1}.", "elasticsearch")
            with self._span("retrieve"):
                recommendations = survey.get("recommendations", [])
                if not isinstance(recommendations, list) or not 1 <= len(recommendations) <= 12:
                    raise WorkerError("invalid_recommendations")
                ids = [item.get("session_id", "") for item in recommendations]
                if any(not isinstance(value, str) or not SESSION_ID.fullmatch(value) for value in ids) or len(set(ids)) != len(ids):
                    raise WorkerError("invalid_recommendations")
                docs = self.client.mget(index=self.sessions, ids=ids)["docs"]
                by_id = {doc["_id"]: doc["_source"] for doc in docs if doc.get("found")}
                if any(value not in by_id or by_id[value].get("session_id") != value for value in ids):
                    raise WorkerError("missing_sessions")
                sessions = [by_id[value] for value in ids]
                emit("action", "retrieve", f"Found {len(sessions)} sessions that fit you", "Read recommended catalog sessions: " + ", ".join(ids) + ".", "elasticsearch")
            # Free text and profile_text never enter the builder, ledger or commit message.
            answers = {key: deepcopy(value) for key, value in survey.get("answers", {}).items() if key in ANSWER_FIELDS}
            with self._span("plan"):
                html, spec, decisions, actual_builder = self.builder(answers, sessions, mode=requested_builder)
                if actual_builder not in {"template", "openai"}:
                    raise WorkerError("invalid_builder_result")
                if requested_builder == "openai" and actual_builder == "template":
                    emit("log", "plan", "Used the reliable template builder", "The model could not produce an eligible page; built a template instead.", "template", "fallback")
                for decision in decisions:
                    if decision.get("name") not in DECISIONS:
                        continue
                    emit("decision", "plan", f"Chose {decision['name']}: {str(decision.get('value', ''))[:100]}",
                         str(decision.get("rationale", ""))[:500], actual_builder, decision=decision)
            with self._span("write"):
                emit("action", "write", "Wrote your page", "Created a complete HTML document from the selected sessions and preferences.", actual_builder)
            with self._span("validate"):
                try:
                    self.validator(html, sessions, accessibility=answers.get("accessibility", []))
                except ValueError:
                    emit("error", "validate", "Rejected a page that did not pass validation", "The generated page did not meet the HTML safety and accessibility rules.", "validator", "rejected")
                    html, spec, decisions, actual_builder = self.builder(answers, sessions, mode="template")
                    self.validator(html, sessions, accessibility=answers.get("accessibility", []))
                    emit("log", "validate", "Rebuilt a safe template page", "Template fallback passed the same validation rules.", "template", "fallback")
                    for decision in decisions:
                        if decision.get("name") in DECISIONS:
                            emit("decision", "plan", f"Fallback {decision['name']}: {str(decision.get('value', ''))[:100]}", str(decision.get("rationale", ""))[:500], "template", decision=decision)
                html_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
                emit("action", "validate", "Checked the page is safe to show", f"Validated {len(html.encode('utf-8'))} bytes with {len(sessions)} session cards.", "validator")
            with self._span("commit"):
                if self.monotonic() - started > 75:
                    raise WorkerError("run_deadline_exceeded")
                # Renew ownership immediately before the external side effect. Requeued runs cannot commit.
                owned_update({})
                mode = self.settings.commit_mode
                if source == "simulator" and mode == "github":
                    ordinal = self.client.count(index=self.ledger, query={"bool": {"filter": [
                        {"term": {"step": "claim"}}, {"term": {"outcome": "ok"}}, {"term": {"source": "simulator"}}]}})["count"]
                    if ordinal % self.settings.sim_commit_every:
                        mode = "dry-run"
                commit = {"mode": "dry-run", "sha": None, "url": None, "branch": BRANCH,
                          "path": f"generated/sites/{attendee_id}/index.html", "message": None, "additions": len(html.splitlines())}
                if mode == "github":
                    if self.publisher is None:
                        raise WorkerError("github_not_configured")
                    try:
                        commit = self.publisher.publish(attendee_id, html, run_id, spec, f"{root_span.get_span_context().trace_id:032x}")
                    except GitHubError as error:
                        if error.status not in {403, 429}:
                            raise
                        emit("log", "commit", "GitHub is unavailable; keeping the site available", f"GitHub returned {error.status}; this run uses dry-run publication.", "github", "fallback")
                emit("commit", "commit", f"Saved it as commit {commit['sha'][:7]}" if commit["sha"] else "Prepared the page without a GitHub commit",
                     f"{'Committed' if commit['sha'] else 'Dry-run page for'} generated/sites/{attendee_id}/index.html on {BRANCH}.", "github" if commit["sha"] else "template", commit=commit)
            with self._span("publish"):
                owned_update({"status": "ready", "builder": actual_builder, "commit_mode": commit["mode"],
                              "html": html, "html_sha256": html_hash, "spec": spec,
                              "commit_sha": commit["sha"], "commit_url": commit["url"]})
                published = True
                emit("log", "publish", "Your site is ready", "Published the page and its hash to the survey document.", "elasticsearch",
                     run_duration_ms=round((self.monotonic() - started) * 1000), duration_ms=round((self.monotonic() - started) * 1000))
            self._log("ready", attendee_id=attendee_id, run_id=run_id)
            return True
        except Exception as error:
            root_span.set_status(Status(StatusCode.ERROR))
            safe_code = str(error) if isinstance(error, WorkerError) else "build_failed"
            if claimed:
                try:
                    emit("error", "publish", "The build stopped safely", safe_code, "elasticsearch", "error")
                except Exception:
                    pass
                if not published:
                    try:
                        owned_update({"status": "failed", "builder": actual_builder})
                    except Exception:
                        pass
            self._log("claim_lost" if isinstance(error, ClaimLost) else "failed", attendee_id=attendee_id, run_id=run_id)
            return claimed

    def run_forever(self, stop):
        while not stop.is_set():
            try:
                self.run_once()
            except Exception:
                # Never print SDK exception bodies: they can contain credentials or survey text.
                self._log("poll_unavailable")
            stop.wait(self.settings.poll_seconds)
