import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  KeyCount,
  PivotClient,
  TrailItem,
  TrailRunResponse,
  TrailSearchParams,
  TrailSearchResponse,
} from "../api/pivot";
import "./trail.css";

interface Props {
  pivot: PivotClient;
  mockMode?: boolean;
}

type FacetName = "kind" | "step" | "tool" | "outcome";
const FACETS: { name: FacetName; label: string }[] = [
  { name: "kind", label: "Kind" },
  { name: "step", label: "Step" },
  { name: "tool", label: "Tool" },
  { name: "outcome", label: "Outcome" },
];
const NO_FILTERS: Record<FacetName, string> = {
  kind: "",
  step: "",
  tool: "",
  outcome: "",
};

const MOCK_ITEMS: TrailItem[] = [
  {
    event_id: "run_b3x6t2m7q4ha:0003",
    run_id: "run_b3x6t2m7q4ha",
    attendee_id: "att_k7m2qx4n3w5p",
    seq: 3,
    at: "2026-11-09T23:30:09Z",
    kind: "decision",
    step: "plan",
    title: "Chose a bold, schedule-first layout",
    detail:
      "Three of the six picks start within the next two hours, so the schedule leads and topics follow.",
    highlight: { detail: ["so the <em>schedule</em> leads and topics follow"] },
    decision: {
      name: "layout",
      value: "schedule-first",
      alternatives: ["topic-clusters", "single-focus"],
      rationale: "Three of the six picks start within the next two hours.",
    },
    tool: "openai",
    model: "set-by-AGENT_OPENAI_MODEL",
    tokens: { input: 1234, output: 187 },
    duration_ms: 1840,
    outcome: "ok",
    builder: "openai",
    source: "qr",
    commit: null,
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    span_id: "00f067aa0ba902b7",
    trace_url: null,
  },
  {
    event_id: "run_b3x6t2m7q4ha:0006",
    run_id: "run_b3x6t2m7q4ha",
    attendee_id: "att_k7m2qx4n3w5p",
    seq: 6,
    at: "2026-11-09T23:30:13Z",
    kind: "commit",
    step: "commit",
    title: "Saved it as commit 3f2a9c1",
    detail:
      "Committed generated/sites/att_k7m2qx4n3w5p/index.html to agent/sites.",
    commit: {
      mode: "github",
      sha: "3f2a9c1e5b7d4a6f8c0e1d2b3a4c5d6e7f809a1b",
      url: "https://github.com/lukeeskinner/Backstage/commit/3f2a9c1e5b7d4a6f8c0e1d2b3a4c5d6e7f809a1b",
      branch: "agent/sites",
      path: "generated/sites/att_k7m2qx4n3w5p/index.html",
      message: "site(att_k7m2qx4n): bold schedule-first build for observability",
      additions: 143,
    },
    tool: "github",
    duration_ms: 612,
    outcome: "ok",
    builder: "openai",
    source: "qr",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
    span_id: "4d5e6f708192a3b4",
    trace_url: null,
  },
];
const MOCK_SEARCH: TrailSearchResponse = {
  total: MOCK_ITEMS.length,
  limit: 20,
  items: MOCK_ITEMS,
  facets: {
    kind: [
      { key: "decision", count: 1 },
      { key: "commit", count: 1 },
    ],
    step: [
      { key: "plan", count: 1 },
      { key: "commit", count: 1 },
    ],
    tool: [
      { key: "openai", count: 1 },
      { key: "github", count: 1 },
    ],
    outcome: [{ key: "ok", count: 2 }],
  },
};
const MOCK_RUN: TrailRunResponse = {
  run_id: "run_b3x6t2m7q4ha",
  attendee_id: "att_k7m2qx4n3w5p",
  survey: {
    role: "attendee",
    interests: ["observability", "platform-engineering", "ai-agents"],
    level: "practitioner",
    vibe: "bold",
    accessibility: ["large_text"],
    source: "qr",
    created_at: "2026-11-09T23:30:04Z",
  },
  site: { status: "ready", builder: "openai", commit_mode: "github" },
  trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_url: null,
  events: MOCK_ITEMS.map(({ highlight: _highlight, ...event }) => event),
};

/**
 * Highlight fragments wrap matches in <em>. They are split and rendered as
 * text nodes so nothing from the ledger is ever parsed as markup.
 */
export function renderHighlight(fragment: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let marked = false;
  fragment.split(/(<em>|<\/em>)/).forEach((piece, index) => {
    if (piece === "<em>") marked = true;
    else if (piece === "</em>") marked = false;
    else if (piece)
      nodes.push(marked ? <mark key={index}>{piece}</mark> : piece);
  });
  return nodes;
}

function safeUrl(value: string | null | undefined): string | null {
  return value && /^https?:\/\//i.test(value) ? value : null;
}

function safeCommitUrl(value: string | null | undefined, sha: string | undefined): string | null {
  const match = value?.match(/^https:\/\/github\.com\/lukeeskinner\/Backstage\/commit\/([a-f0-9]{40}(?:[a-f0-9]{24})?)$/);
  return match && match[1] === sha ? value! : null;
}

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? at
    : date.toISOString().slice(11, 19) + "Z";
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "The agent trail could not be loaded.";
}

function Highlighted({ fragments }: { fragments: string[] }) {
  return (
    <>
      {fragments.map((fragment, index) => (
        <span key={index} className="trail__fragment">
          {index > 0 ? " … " : null}
          {renderHighlight(fragment)}
        </span>
      ))}
    </>
  );
}

function TrailEvent({
  item,
  onOpenRun,
}: {
  item: TrailItem;
  onOpenRun?: (runId: string) => void;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const detailFragments = item.highlight?.detail;
  const rationaleFragments = item.highlight?.["decision.rationale"];
  const commitUrl = safeCommitUrl(item.commit?.url, item.commit?.sha);
  const traceUrl = safeUrl(item.trace_url);
  const copy = async () => {
    if (!item.trace_id) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(item.trace_id);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <article className="trail__event" aria-label={item.title}>
      <p className="trail__meta">
        <time dateTime={item.at}>{formatTime(item.at)}</time>
        <span className="trail__chip" data-kind={item.kind}>
          {item.kind}
        </span>
        <span className="trail__chip">{item.step}</span>
        {item.outcome ? (
          <span className="trail__chip" data-outcome={item.outcome}>
            {item.outcome}
          </span>
        ) : null}
      </p>
      <h4 className="trail__title">{item.title}</h4>
      {detailFragments?.length ? (
        <p className="trail__detail">
          <Highlighted fragments={detailFragments} />
        </p>
      ) : item.detail ? (
        <p className="trail__detail">{item.detail}</p>
      ) : null}
      {item.decision ? (
        <p className="trail__decision">
          <strong>
            {item.decision.name} = {item.decision.value}
          </strong>
          {rationaleFragments?.length ? (
            <>
              {" "}
              <Highlighted fragments={rationaleFragments} />
            </>
          ) : item.decision.rationale ? (
            <> {item.decision.rationale}</>
          ) : null}
        </p>
      ) : null}
      <dl className="trail__facts">
        {item.tool ? (
          <div>
            <dt>Tool</dt>
            <dd>{item.tool}</dd>
          </div>
        ) : null}
        {item.model ? (
          <div>
            <dt>Model</dt>
            <dd>{item.model}</dd>
          </div>
        ) : null}
        {typeof item.duration_ms === "number" ? (
          <div>
            <dt>Duration</dt>
            <dd>{item.duration_ms} ms</dd>
          </div>
        ) : null}
        {item.commit?.sha ? (
          <div>
            <dt>Commit</dt>
            <dd>
              {commitUrl ? (
                <a href={commitUrl} rel="noreferrer" target="_blank">
                  {item.commit.sha.slice(0, 7)}
                </a>
              ) : (
                <code>{item.commit.sha.slice(0, 7)}</code>
              )}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="trail__actions">
        {item.trace_id ? (
          <>
            <code className="trail__trace">{item.trace_id}</code>
            <button
              type="button"
              onClick={copy}
              aria-label={`Copy trace id for ${item.title}`}
            >
              Copy trace id
            </button>
            <span role="status" className="trail__muted">
              {copied === "copied"
                ? "Copied"
                : copied === "failed"
                  ? "Copy unavailable"
                  : ""}
            </span>
          </>
        ) : null}
        {traceUrl ? (
          <a href={traceUrl} rel="noreferrer" target="_blank">
            Open trace
          </a>
        ) : null}
        {onOpenRun ? (
          <button
            type="button"
            onClick={() => onOpenRun(item.run_id)}
            aria-label={`Open run ${item.run_id} for ${item.title}`}
          >
            Open run
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function TrailConsole({ pivot, mockMode = false }: Props) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [result, setResult] = useState<TrailSearchResponse | null>(
    mockMode ? MOCK_SEARCH : null,
  );
  const [loading, setLoading] = useState(!mockMode);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<TrailRunResponse | null>(null);
  const [runLoading, setRunLoading] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const searchRequest = useRef(0);
  const runRequest = useRef(0);
  const runHeading = useRef<HTMLHeadingElement>(null);

  const search = useCallback(
    async (q: string, selected: Record<FacetName, string>) => {
      const mine = ++searchRequest.current;
      if (mockMode) {
        setResult(MOCK_SEARCH);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      const params: TrailSearchParams = { q, ...selected };
      try {
        const next = await pivot.searchTrail(params);
        if (mine !== searchRequest.current) return;
        setResult(next);
      } catch (cause) {
        if (mine !== searchRequest.current) return;
        setError(errorMessage(cause));
      } finally {
        if (mine === searchRequest.current) setLoading(false);
      }
    },
    [pivot, mockMode],
  );

  useEffect(() => {
    void search(query, filters);
    return () => {
      searchRequest.current++;
    };
  }, [search, query, filters]);

  useEffect(
    () => () => {
      runRequest.current++;
    },
    [],
  );

  useEffect(() => {
    if (run) runHeading.current?.focus();
  }, [run]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (next === query) void search(next, filters);
    else setQuery(next);
  };

  const openRun = async (runId: string) => {
    const mine = ++runRequest.current;
    setRunError(null);
    if (mockMode) {
      setRun(MOCK_RUN);
      return;
    }
    setRunLoading(runId);
    try {
      const next = await pivot.getTrailRun(runId);
      if (mine !== runRequest.current) return;
      setRun(next);
    } catch (cause) {
      if (mine !== runRequest.current) return;
      setRun(null);
      setRunError(errorMessage(cause));
    } finally {
      if (mine === runRequest.current) setRunLoading(null);
    }
  };

  const closeRun = () => {
    runRequest.current++;
    setRun(null);
    setRunError(null);
    setRunLoading(null);
  };

  const options = (name: FacetName): KeyCount[] => {
    const facet = result?.facets?.[name] ?? [];
    const selected = filters[name];
    return selected && !facet.some((entry) => entry.key === selected)
      ? [...facet, { key: selected, count: 0 }]
      : facet;
  };
  const items = result?.items ?? [];
  const runTraceUrl = safeUrl(run?.trace_url);

  return (
    <section className="trail" aria-labelledby={`${id}-title`}>
      <header className="trail__header">
        <div>
          <p className="trail__eyebrow">Agent ledger</p>
          <h3 id={`${id}-title`}>Search the agent trail</h3>
        </div>
        {mockMode ? <span className="trail__mode">Mock data</span> : null}
      </header>
      <form className="trail__form" role="search" onSubmit={submit}>
        <div className="trail__field trail__field--wide">
          <label htmlFor={`${id}-q`}>Search agent events</label>
          <input
            id={`${id}-q`}
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="why schedule-first"
            autoComplete="off"
          />
        </div>
        {FACETS.map(({ name, label }) => (
          <div className="trail__field" key={name}>
            <label htmlFor={`${id}-${name}`}>{label}</label>
            <select
              id={`${id}-${name}`}
              value={filters[name]}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  [name]: event.target.value,
                }))
              }
            >
              <option value="">Any</option>
              {options(name).map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.key} ({entry.count})
                </option>
              ))}
            </select>
          </div>
        ))}
        <button type="submit" className="trail__submit">
          Search
        </button>
      </form>

      <div aria-live="polite" aria-busy={loading}>
        {loading ? <p className="trail__muted">Loading agent events…</p> : null}
        {error ? (
          <p role="alert" className="trail__error">
            {error}
          </p>
        ) : null}
        {!loading && !error && result ? (
          items.length ? (
            <p className="trail__muted">
              Showing {items.length} of {result.total} events
            </p>
          ) : (
            <p className="trail__muted">No matching agent events yet.</p>
          )
        ) : null}
      </div>

      {items.length ? (
        <ol className="trail__list" aria-label="Agent events">
          {items.map((item) => (
            <li key={item.event_id}>
              <TrailEvent item={item} onOpenRun={openRun} />
            </li>
          ))}
        </ol>
      ) : null}

      {runLoading ? (
        <p className="trail__muted" role="status">
          Loading run {runLoading}…
        </p>
      ) : null}
      {runError ? (
        <p role="alert" className="trail__error">
          {runError}
        </p>
      ) : null}
      {run ? (
        <section className="trail__run" aria-labelledby={`${id}-run`}>
          <header className="trail__header">
            <h4 id={`${id}-run`} tabIndex={-1} ref={runHeading}>
              Run <code>{run.run_id}</code>
            </h4>
            <button type="button" onClick={closeRun} aria-label="Close run">
              Close
            </button>
          </header>
          <p className="trail__muted">
            Attendee <code>{run.attendee_id}</code> · {run.site ? (
              <>site {run.site.status}{run.site.builder ? ` · ${run.site.builder}` : ""}</>
            ) : (
              <span>Site details unavailable. Timeline remains available.</span>
            )}
            {runTraceUrl ? (
              <>
                {" · "}
                <a href={runTraceUrl} rel="noreferrer" target="_blank">
                  Open trace
                </a>
              </>
            ) : null}
          </p>
          {run.events.length ? (
            <ol className="trail__timeline" aria-label="Run timeline">
              {run.events.map((event) => (
                <li key={event.event_id}>
                  <TrailEvent item={event} />
                </li>
              ))}
            </ol>
          ) : (
            <p className="trail__muted">This run has no recorded events.</p>
          )}
        </section>
      ) : null}
    </section>
  );
}
