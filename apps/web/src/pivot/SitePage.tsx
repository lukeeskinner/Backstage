import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PivotApi } from "./client";
import { ATTENDEE_ID } from "./types";
import type { AttendeeView, InteractionAction, Recommendation, Site } from "./types";
import "./pivot.css";

const POLL_MS = 2000;
const HEAD = "<head>";
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`;

/** Second validation: the policy goes right after the one literal head tag. Anything else is not rendered. */
export function withContentPolicy(html: string): string | null {
  const first = html.indexOf(HEAD);
  if (first < 0 || html.indexOf(HEAD, first + HEAD.length) >= 0) return null;
  return html.slice(0, first + HEAD.length) + POLICY + html.slice(first + HEAD.length);
}

function timeRange(session: Recommendation): string {
  if (!session.starts_at) return "";
  const format = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return session.ends_at ? `${format(session.starts_at)} to ${format(session.ends_at)}` : format(session.starts_at);
}

type Tap = (sessionId: string, action: InteractionAction, position: number, title?: string) => void;

function SiteFrame({ html, onTap }: { html: string; onTap: Tap }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);

  const measure = useCallback(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (root) setHeight(Math.max(root.scrollHeight, 240));
  }, []);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // The frame runs no scripts, so taps are read from the parent: hit-test the frame document under the pointer.
  const tap = (event: MouseEvent<HTMLDivElement>) => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const box = event.currentTarget.getBoundingClientRect();
    const target = doc.elementFromPoint(event.clientX - box.left, event.clientY - box.top);
    const card = target?.closest<HTMLElement>("[data-session-id]");
    const sessionId = card?.getAttribute("data-session-id");
    if (!card || !sessionId) return;
    const requested = target?.closest("[data-action]")?.getAttribute("data-action");
    const action: InteractionAction = requested === "save" || requested === "dismiss" ? requested : "open";
    const position = Array.from(doc.querySelectorAll("[data-session-id]")).indexOf(card);
    if (action === "save") card.style.outline = "3px solid currentColor";
    if (action === "dismiss") card.style.opacity = "0.45";
    onTap(sessionId, action, position);
  };

  return (
    <div className="site__frame-wrap">
      <iframe ref={frame} className="site__frame" title="Your conference site" sandbox="allow-same-origin" srcDoc={html} style={{ height }} onLoad={measure} />
      <div className="site__tap" data-testid="site-tap" onClick={tap} />
    </div>
  );
}

function Picks({ picks, state, onTap }: { picks: Recommendation[]; state: Record<string, InteractionAction>; onTap: Tap }) {
  if (picks.length === 0) return null;
  return (
    <section className="picks" aria-labelledby="picks-title">
      <h2 id="picks-title" className="picks__title">Your picks</h2>
      <ol className="picks__list">
        {picks.map((pick, position) => (
          <li key={pick.session_id} className="picks__item" data-state={state[pick.session_id]}>
            <h3 className="picks__name">{pick.title}</h3>
            <p className="picks__meta">{[pick.room, timeRange(pick)].filter(Boolean).join(" · ")}</p>
            {pick.reasons?.length ? <p className="picks__meta">{pick.reasons.map((reason) => reason.label).join(". ")}.</p> : null}
            {pick.abstract ? (
              <details onToggle={(event) => { if (event.currentTarget.open) onTap(pick.session_id, "open", position, pick.title); }}>
                <summary>About this session</summary>
                <p>{pick.abstract}</p>
              </details>
            ) : null}
            <div className="picks__actions">
              <button type="button" className="btn btn--quiet" aria-pressed={state[pick.session_id] === "save"} onClick={() => onTap(pick.session_id, "save", position, pick.title)}>
                Save
              </button>
              <button type="button" className="btn btn--quiet" aria-pressed={state[pick.session_id] === "dismiss"} onClick={() => onTap(pick.session_id, "dismiss", position, pick.title)}>
                Not for me
              </button>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BuiltBy({ site }: { site: Site }) {
  const linked = site.commit_sha && site.commit_url?.startsWith("https://github.com/");
  return (
    <footer className="site__footer">
      <p>
        Built for you by the Backstage agent
        {linked ? <> · <a href={site.commit_url ?? undefined} target="_blank" rel="noreferrer">commit {site.commit_sha?.slice(0, 7)}</a></>
          : site.html_sha256 ? <> · page <code>{site.html_sha256.slice(0, 7)}</code></> : null}
      </p>
    </footer>
  );
}

export interface SitePageProps {
  api: PivotApi;
  attendeeId: string | null;
}

export function SitePage({ api, attendeeId }: SitePageProps) {
  const valid = attendeeId !== null && ATTENDEE_ID.test(attendeeId);
  const [view, setView] = useState<AttendeeView | null>(null);
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<Record<string, InteractionAction>>({});

  useEffect(() => {
    if (!valid || !attendeeId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const result = await api.getAttendee(attendeeId, controller.signal);
        if (controller.signal.aborted) return;
        if (result.ok) {
          setProblem("");
          setView(result.data);
          if (result.data.site.status === "ready" || result.data.site.status === "failed") return;
        } else if (result.status === 404) {
          setMissing(true);
          return;
        } else {
          setProblem(result.message);
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, attendeeId, valid]);

  const titles = useMemo(() => new Map((view?.recommendations ?? []).map((pick) => [pick.session_id, pick.title])), [view]);

  const onTap = useCallback<Tap>((sessionId, action, position, title) => {
    if (!attendeeId) return;
    const name = title ?? titles.get(sessionId) ?? "this session";
    if (action !== "open") setState((current) => ({ ...current, [sessionId]: action }));
    setNote(action === "save" ? `Saved ${name}.` : action === "dismiss" ? `Hid ${name}.` : `Opened ${name}.`);
    void api.recordInteraction(attendeeId, sessionId, action, position);
  }, [api, attendeeId, titles]);

  const status = view?.site.status;
  const html = status === "ready" && view?.site.html ? withContentPolicy(view.site.html) : null;
  const comfort = view?.answers?.accessibility ?? [];

  return (
    <section className="site" aria-labelledby="site-title" data-large-text={comfort.includes("large_text") || undefined}>
      <p className="join__brand">BACKSTAGE</p>

      {!valid || missing ? (
        <>
          <h1 id="site-title" className="join__title">No site here yet</h1>
          <p className="join__text">This link does not match a site. <a href="#/join">Answer five questions to get yours.</a></p>
        </>
      ) : view === null ? (
        <>
          <h1 id="site-title" className="join__title">Finding your site</h1>
          <p className="join__text">One moment.</p>
        </>
      ) : status === "queued" || status === "building" ? (
        <>
          <h1 id="site-title" className="join__title">Building your site</h1>
          <p className="join__text">A coding agent is writing a page for you. Each step shows up here as it happens.</p>
          <ol className="steps" aria-label="What the agent has done">
            {view.progress.map((step) => (
              <li key={step.seq} className="steps__item" data-step={step.step}>{step.title}</li>
            ))}
            <li className="steps__item steps__item--pending">{view.progress.length === 0 ? "Waiting for the agent to pick this up" : "Working on the next step"}</li>
          </ol>
        </>
      ) : html ? (
        <>
          <h1 id="site-title" className="sr-only">Your conference site</h1>
          <SiteFrame html={html} onTap={onTap} />
          <Picks picks={view.recommendations} state={state} onTap={onTap} />
          <BuiltBy site={view.site} />
        </>
      ) : (
        <>
          <h1 id="site-title" className="join__title">Your sessions</h1>
          <p className="join__text">The custom page did not finish, so here are your picks as a plain list.</p>
          <Picks picks={view.recommendations} state={state} onTap={onTap} />
        </>
      )}

      <p role="status" aria-live="polite" className="join__message">{problem || note || (status === "building" ? view?.progress[view.progress.length - 1]?.title ?? "" : "")}</p>
    </section>
  );
}
