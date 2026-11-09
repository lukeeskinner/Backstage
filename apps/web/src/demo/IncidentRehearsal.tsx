import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import { useBoard } from "../hooks/useBoard";
import { useIncidentActions } from "../hooks/useIncidentActions";
import { IncidentEvidence } from "../diagnostics/IncidentEvidence";
import { eventLabel, stateLabel } from "../ui/format";
import { IncidentVisual } from "../visuals/IncidentVisual";

export interface Run {
  id: string;
  phase: "injecting" | "awaiting_humans" | "recovering" | "completed" | "paused";
  started_at: string;
  recovery_started_at: string | null;
  incident_id: string | null;
  samples: number;
  error: string | null;
}
const PHASE = { injecting: "Crowd surge injected · waiting for 30 seconds of evidence", awaiting_humans: "Incident logged · waiting for human actions",
  recovering: "Aisle clearing · collecting 60 seconds of recovery evidence", completed: "Recovery verified by the incident API", paused: "Producer paused · review the saved incident" };

/** Source of rehearsal runs. Absent: the deployment's /demo-api. Present: the in-browser simulation. */
export interface RehearsalDriver {
  poll(): Promise<Run | null>;
  command(phase: "run" | "recover"): Promise<Run>;
}

export function IncidentRehearsal({ client, token, organizer, announce, driver }: { client: ApiClient; token: string; organizer: boolean; announce: (message: string) => void; driver?: RehearsalDriver }) {
  const simulated = Boolean(driver);
  const board = useBoard({ client, pollMs: 2000, announce });
  const actions = useIncidentActions({ client, applyIncident: board.applyIncident, refresh: board.refresh });
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState("");
  const [access, setAccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const intent = useRef(crypto.randomUUID());
  const incidentCard = useRef<HTMLElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const poll = useCallback(async (signal?: AbortSignal) => {
    try {
      if (driver) {
        const value = await driver.poll();
        if (active.current && !signal?.aborted) { setRun(value); setAccess(true); }
        return;
      }
      const response = await fetch("/demo-api/run", { signal, headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) { if (active.current && !signal?.aborted) setAccess(false); return; }
      const value = await response.json();
      if (active.current && !signal?.aborted) { setRun(value.run); setAccess(true); }
    } catch { if (active.current && !signal?.aborted) setAccess(false); }
  }, [token, driver]);
  useEffect(() => {
    if (!organizer || !token) return;
    const abort = new AbortController();
    void poll(abort.signal);
    const timer = setInterval(() => void poll(abort.signal), 2000);
    return () => { abort.abort(); clearInterval(timer); };
  }, [organizer, token, poll]);
  const command = async (phase: "run" | "recover") => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (driver) {
        const next = await driver.command(phase);
        if (!active.current) return;
        setRun(next);
        announce(phase === "run" ? "Simulated crowd surge started." : "Simulated recovery started. Verification still has to pass before closure.");
        board.refresh();
        return;
      }
      const response = await fetch(`/demo-api/${phase}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": intent.current } });
      const value = await response.json();
      if (!active.current) return;
      if (!response.ok) throw Error(value.error?.message || "Rehearsal action failed.");
      setRun(value.run);
      if (phase === "run") intent.current = crypto.randomUUID();
      announce(phase === "run" ? "Rehearsal crowd surge started. Real incident ingress is receiving injected counts." : "Recovery evidence started. The incident API must verify sixty seconds before closure.");
      board.refresh();
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : "Rehearsal action failed. Retry the same intent."); }
    finally { if (active.current) setBusy(false); }
  };
  const incidents = board.incidents.filter((incident) => run ? incident.id === run.incident_id : incident.room_id === "room-b" && incident.type === "overflow");
  const current = incidents.find((incident) => incident.id === run?.incident_id) ?? incidents[0];
  const currentId = current?.id;
  const currentVersion = current?.version;
  useEffect(() => { if (currentId) board.onTimelineOpen(currentId); }, [currentId, currentVersion, board.onTimelineOpen]);
  useEffect(() => { if (currentId && actions.focusIncidentId === currentId) incidentCard.current?.focus(); }, [currentId, actions.focusIncidentId]);
  const events = current ? board.eventsById[current.id] : undefined;
  const action = current ? actions.actionState[current.id] : undefined;
  return <section className="incident-rehearsal" aria-labelledby="rehearsal-title">
    <header><p className="incident-rehearsal__eyebrow">{simulated ? "Demo mode · simulated rehearsal" : "Live system · injected rehearsal"}</p><h2 id="rehearsal-title">From video to incident response</h2>
      <p>{simulated
        ? "The video and YOLO keep running. Inject a simulated crowd surge for Room B, watch the Venue agent propose a plan, then approve and accept it with the normal role controls."
        : "The video and YOLO keep running. Inject a crowd surge into the real Room B signal feed, watch the Venue agent propose a plan, then approve and accept it with the normal role controls."}</p></header>
    <div className="incident-rehearsal__controls">
      {organizer ? <><button type="button" className="btn btn--primary" disabled={!access || busy || Boolean(run && run.phase !== "completed")} onClick={() => void command("run")}>Inject crowd surge</button>
        <button type="button" className="btn btn--quiet" disabled={!access || busy || run?.phase !== "awaiting_humans" || !current || !["accepted", "verifying"].includes(current.state)} onClick={() => void command("recover")}>Clear surge &amp; verify recovery</button></> : null}
      <a href="#/me" className="btn btn--quiet">Open your role inbox</a>
      <a href="#/projector" className="btn btn--quiet">Open attendee status</a>
    </div>
    <p className="incident-rehearsal__status" role="status">{run ? PHASE[run.phase] : organizer ? access ? "Ready. No rehearsal has been started." : "Enter the configured rehearsal organizer token to enable injection." : "Staff: accept your assignment here or in your role inbox. Organizer controls the injected surge."}</p>
    <p className="incident-rehearsal__disclosure">{simulated ? "Simulated in this browser: nothing is sent to the venue's incident API. " : ""}Injected counts: seating 30/30 and door 8 (threshold 5), then door 2 during recovery. These are rehearsal signals, separate from measured YOLO counts. No automatic approval, acceptance or early closure. In-app inbox updates appear for authorized roles; no external messages are sent.</p>
    {run ? <p className="incident-rehearsal__receipt">{simulated
      ? `Simulated run ${run.id}${run.incident_id ? ` · Incident ${run.incident_id}` : " · Incident opens after a short evidence window"}.`
      : `${run.samples} signal pairs committed · Run ${run.id}${run.incident_id ? ` · Incident ${run.incident_id}` : " · Incident opens after 30 seconds"}. The producer continues if you switch pages; a server restart stops it without erasing saved evidence.`}</p> : null}
    {error || run?.error ? <p role="alert" className="notice notice--error">{error || run?.error}</p> : null}
    {board.loadError ? <p role="alert">{board.loadError.message}</p> : null}
    {current ? <article ref={incidentCard} tabIndex={-1} className="incident-rehearsal__incident" aria-label="Live rehearsal incident">
      <h3>{current.summary}</h3>
      <IncidentVisual incident={current} size="sm" /><p role="status"><strong>{stateLabel(current.state)}</strong> · {current.verification.status === "passed" ? "Recovery verified" : "Recovery not yet verified"}</p>
      <p>{current.plan?.summary ?? "The agent is preparing a plan."}</p>
      <p>{current.assignment ? `Venue staff assignment: ${current.assignment.assignee_id}.${current.state === "dispatched" ? " Open that person’s role inbox to accept." : ""}` : "Organizer inbox: review the proposed plan before dispatch."}</p>
      {current.allowed_actions.includes("approve") ? <button type="button" className="btn btn--primary" disabled={Boolean(action?.busy)} onClick={() => void actions.run(current, "approve")}>Approve plan</button> : null}
      {current.allowed_actions.includes("ack") ? <button type="button" className="btn btn--primary" disabled={Boolean(action?.busy)} onClick={() => void actions.run(current, "ack")}>Accept assignment</button> : null}
      {action?.error ? <p role="alert">{action.error.message}</p> : null}
      <h3>Agent &amp; human activity</h3>
      <ol className="incident-rehearsal__feed">{(events ?? []).map((event) => <li key={event.event_id}><strong>{eventLabel(event.type)}</strong><span>{event.actor.id} · {event.actor.kind}</span><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleTimeString()}</time></li>)}</ol>
      <details><summary>Inspect saved evidence</summary><IncidentEvidence key={current.id} incident={current} client={client} mockMode={simulated} /></details>
    </article> : <p>{board.loading ? "Loading the scoped incident feed…" : "No Room B overflow in your current scope. The incident will appear here after the trigger window."}</p>}
  </section>;
}
