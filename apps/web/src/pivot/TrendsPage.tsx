import { useCallback, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { usePolling } from "../hooks/usePolling";
import type { PivotApi } from "./client";
import { keyLabel } from "./labels";
import { INTERESTS } from "./types";
import type { KeyCount, SessionTrend, TimeSeries, Trends } from "./types";
import "./pivot.css";

const POLL_MS = 5000;

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readFilters(hash: string): { interest: string | null; source: string | null } {
  const params = new URLSearchParams(hash.split("?")[1] ?? "");
  return { interest: params.get("interest"), source: params.get("source") };
}

function writeFilters(next: { interest: string | null; source: string | null }): void {
  const params = new URLSearchParams();
  if (next.interest) params.set("interest", next.interest);
  if (next.source) params.set("source", next.source);
  const query = params.toString();
  window.location.hash = query ? `#/trends?${query}` : "#/trends";
}

function clock(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function seconds(ms: number | null): string {
  return ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`;
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  const rounded = Math.ceil(value / (step / 2)) * (step / 2);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="chart__table">
      <summary>Show as table</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{row.map((cell, column) => (column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>))}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ChartCard({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? "chart chart--wide" : "chart"} aria-label={title}>
      <h2 className="chart__title">{title}</h2>
      {note ? <p className="chart__note">{note}</p> : null}
      {children}
    </section>
  );
}

const W = 720;
const H = 260;
const PAD = { left: 36, right: 168, top: 12, bottom: 28 };

function InterestLines({ data, active, onPick }: { data: TimeSeries; active: string | null; onPick(key: string): void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const count = data.buckets.length;
  const max = niceMax(Math.max(1, ...data.series.flatMap((series) => series.counts)));
  const x = (index: number) => PAD.left + (count <= 1 ? 0 : (index * (W - PAD.left - PAD.right)) / (count - 1));
  const y = (value: number) => PAD.top + (1 - value / max) * (H - PAD.top - PAD.bottom);
  const lit = peek ?? active;
  const last = (counts: number[]) => counts[counts.length - 1] ?? 0;
  const ranked = [...data.series].sort((a, b) => last(b.counts) - last(a.counts));
  const labelled = ranked.filter((series, index) => index < 3 || series.key === lit);
  let floor = -Infinity;
  const labels = [...labelled].sort((a, b) => y(last(a.counts)) - y(last(b.counts))).map((series) => {
    const at = Math.max(y(last(series.counts)), floor + 16);
    floor = at;
    return { key: series.key, at };
  });
  const totals = new Map(data.series.map((series) => [series.key, series.counts.reduce((sum, value) => sum + value, 0)]));
  const keys = [...new Set<string>([...INTERESTS, ...data.series.map((series) => series.key)])];

  const move = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    const index = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (count - 1));
    setHover(Math.min(count - 1, Math.max(0, index)));
  };
  const keys_ = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHover((current) => Math.min(count - 1, Math.max(0, (current ?? count - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
  };
  const reading = hover === null ? [] : [...data.series].map((series) => ({ key: series.key, value: series.counts[hover] ?? 0 })).sort((a, b) => b.value - a.value).slice(0, 5);

  return (
    <>
      {count === 0 ? <p className="chart__empty">No surveys in this window yet.</p> : (
        <div className="lines" tabIndex={0} role="group" aria-label="Interests over time. Use the left and right arrow keys to read each minute."
          onKeyDown={keys_} onFocus={() => setHover((current) => current ?? count - 1)} onBlur={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart of survey interests per minute, one line per topic" onMouseMove={move} onMouseLeave={() => setHover(null)}>
            {[0, max / 2, max].map((tick) => (
              <g key={tick}>
                <line className="lines__grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
                <text className="lines__tick" x={PAD.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
              </g>
            ))}
            <text className="lines__tick" x={PAD.left} y={H - 6}>{clock(data.buckets[0] ?? "")}</text>
            <text className="lines__tick" x={W - PAD.right} y={H - 6} textAnchor="end">{clock(data.buckets[count - 1] ?? "")}</text>
            {[...data.series].sort((a) => (a.key === lit ? 1 : -1)).map((series) => (
              <polyline key={series.key} className="lines__line" data-lit={series.key === lit || undefined} data-dim={(lit !== null && series.key !== lit) || undefined}
                points={series.counts.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
            ))}
            {labels.map((label) => (
              <text key={label.key} className="lines__label" data-lit={label.key === lit || undefined} x={W - PAD.right + 8} y={label.at + 4}>{keyLabel(label.key)}</text>
            ))}
            {hover !== null ? <line className="lines__cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} /> : null}
          </svg>
          {hover !== null ? (
            <div className="lines__tip" role="status" style={{ left: `${(x(hover) / W) * 100}%` }} data-flip={hover > count / 2 || undefined}>
              <strong>{clock(data.buckets[hover] ?? "")}</strong>
              {reading.map((row) => <span key={row.key}>{keyLabel(row.key)} <b>{row.value}</b></span>)}
            </div>
          ) : null}
        </div>
      )}
      <ul className="legend" aria-label="Filter every chart by topic">
        {keys.map((key) => (
          <li key={key}>
            <button type="button" className="legend__chip" aria-pressed={active === key} onClick={() => onPick(key)}
              onMouseEnter={() => setPeek(key)} onMouseLeave={() => setPeek(null)} onFocus={() => setPeek(key)} onBlur={() => setPeek(null)}>
              {keyLabel(key)} <span className="legend__count">{totals.get(key) ?? 0}</span>
            </button>
          </li>
        ))}
      </ul>
      <DataTable caption="Interests per minute" head={["Minute", ...data.series.map((series) => keyLabel(series.key))]}
        rows={data.buckets.map((bucket, index) => [clock(bucket), ...data.series.map((series) => series.counts[index] ?? 0)])} />
    </>
  );
}

function Bars({ title, items }: { title: string; items: KeyCount[] }) {
  const max = Math.max(1, ...items.map((item) => item.count));
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return (
    <div className="bars">
      <h3 className="bars__title">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.key} className="bars__row" title={`${keyLabel(item.key)}: ${item.count}${total ? ` (${Math.round((item.count / total) * 100)}%)` : ""}`}>
            <span className="bars__label">{keyLabel(item.key)}</span>
            <span className="bars__track" aria-hidden="true"><span className="bars__fill" style={{ width: `${(item.count / max) * 100}%` }} /></span>
            <span className="bars__value">{item.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SessionBars({ sessions }: { sessions: SessionTrend[] }) {
  const sorted = [...sessions].sort((a, b) => b.recommended - a.recommended);
  const max = Math.max(1, ...sorted.map((session) => session.recommended), ...sorted.map((session) => session.opened));
  if (sorted.length === 0) return <p className="chart__empty">No recommendations in this window yet.</p>;
  return (
    <>
      <p className="pairs__legend" aria-hidden="true">
        <span><i className="pairs__swatch" /> Recommended</span>
        <span><i className="pairs__swatch pairs__swatch--opened" /> Opened</span>
      </p>
      <ul className="pairs">
        {sorted.map((session) => (
          <li key={session.session_id} title={`${session.title}: recommended ${session.recommended}, opened ${session.opened}, saved ${session.saved}, hidden ${session.dismissed}`}>
            <span className="pairs__name">{session.title}</span>
            <span className="bars__row"><span className="sr-only">Recommended</span><span className="bars__track" aria-hidden="true"><span className="bars__fill bars__fill--base" style={{ width: `${(session.recommended / max) * 100}%` }} /></span><span className="bars__value">{session.recommended}</span></span>
            <span className="bars__row"><span className="sr-only">Opened</span><span className="bars__track" aria-hidden="true"><span className="bars__fill" style={{ width: `${(session.opened / max) * 100}%` }} /></span><span className="bars__value">{session.opened}</span></span>
          </li>
        ))}
      </ul>
      <DataTable caption="Recommended against opened, per session" head={["Session", "Recommended", "Opened", "Saved", "Hidden"]}
        rows={sorted.map((session) => [session.title, session.recommended, session.opened, session.saved, session.dismissed])} />
    </>
  );
}

function Builds({ data, latency }: { data: TimeSeries; latency: Trends["agent"]["latency_ms"] }) {
  const totals = data.buckets.map((_, index) => data.series.reduce((sum, series) => sum + (series.counts[index] ?? 0), 0));
  const notOk = data.series.filter((series) => series.key !== "ok").map((series) => `${series.counts.reduce((sum, value) => sum + value, 0)} ${keyLabel(series.key).toLowerCase()}`);
  const max = niceMax(Math.max(1, ...totals));
  const width = 480;
  const height = 140;
  const slot = totals.length ? width / totals.length : width;
  return (
    <>
      <div className="builds">
        <svg viewBox={`0 0 ${width} ${height + 20}`} role="img" aria-label="Column chart of site builds per minute">
          <line className="lines__grid" x1={0} x2={width} y1={height} y2={height} />
          {totals.map((total, index) => {
            const tall = (total / max) * (height - 8);
            return (
              <rect key={index} className="builds__bar" x={index * slot + 1} y={height - tall} width={Math.max(slot - 2, 1)} height={tall} rx={Math.min(4, slot / 3)}>
                <title>{`${clock(data.buckets[index] ?? "")}: ${total} builds`}</title>
              </rect>
            );
          })}
          <text className="lines__tick" x={0} y={height + 16}>{totals.length ? clock(data.buckets[0] ?? "") : ""}</text>
          <text className="lines__tick" x={width} y={height + 16} textAnchor="end">{totals.length ? clock(data.buckets[totals.length - 1] ?? "") : ""}</text>
        </svg>
        <dl className="builds__numbers">
          <div><dt>p50 build time</dt><dd>{seconds(latency.p50)}</dd></div>
          <div><dt>p95 build time</dt><dd>{seconds(latency.p95)}</dd></div>
        </dl>
      </div>
      {notOk.length ? <p className="chart__note">Of these, {notOk.join(" and ")}.</p> : null}
      <DataTable caption="Builds per minute" head={["Minute", ...data.series.map((series) => keyLabel(series.key))]}
        rows={data.buckets.map((bucket, index) => [clock(bucket), ...data.series.map((series) => series.counts[index] ?? 0)])} />
    </>
  );
}

function keyTable(caption: string, groups: [string, KeyCount[]][]) {
  return <DataTable caption={caption} head={["Group", "Value", "Count"]} rows={groups.flatMap(([group, items]) => items.map((item) => [group, keyLabel(item.key), item.count]))} />;
}

export function TrendsPage({ api }: { api: PivotApi }) {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const { interest, source } = readFilters(hash);
  const [trends, setTrends] = useState<Trends | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const result = await api.getTrends({ interest, source }, signal);
    if (signal.aborted) return;
    if (result.ok) {
      setTrends(result.data);
      setError(null);
    } else {
      setError({ status: result.status, message: result.message });
    }
  }, [api, interest, source]);
  usePolling(load, POLL_MS);

  const pick = (key: string) => writeFilters({ interest: interest === key ? null : key, source });
  const denied = error !== null && (error.status === 401 || error.status === 403);

  return (
    <section className="trends" aria-labelledby="trends-title">
      <div className="trends__heading">
        <div>
          <h1 id="trends-title">Trends</h1>
          <p>What attendees asked for and what the agent built, over the last hour. Updates every five seconds.</p>
        </div>
        <div className="trends__filters">
          {interest ? (
            <button type="button" className="btn btn--quiet" onClick={() => writeFilters({ interest: null, source })}>
              Topic: {keyLabel(interest)} · Clear
            </button>
          ) : null}
          {trends && (trends.totals.simulated > 0 || source === "qr") ? (
            <label className="trends__toggle">
              <input type="checkbox" checked={source === "qr"} onChange={(event) => writeFilters({ interest, source: event.target.checked ? "qr" : null })} />
              Real scans only
            </label>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="notice notice--error">
          <strong>{denied ? "Organizer access needed." : "Could not load trends."}</strong>{" "}
          {denied ? "Switch to Organizer and enter the organizer token." : error.message}
        </p>
      ) : null}
      {trends === null && !error ? <p>Loading trends...</p> : null}

      {trends ? (
        <>
          {trends.totals.simulated > 0 ? (
            <p className="trends__simulated">Includes {trends.totals.simulated} simulated {trends.totals.simulated === 1 ? "attendee" : "attendees"}.</p>
          ) : null}
          <dl className="tiles">
            <div><dt>Surveys</dt><dd>{trends.totals.surveys}</dd></div>
            <div><dt>Sites built</dt><dd>{trends.totals.sites_ready}</dd></div>
            <div><dt>Taps</dt><dd>{trends.totals.interactions}</dd></div>
            <div><dt>Open rate</dt><dd>{Math.round(trends.totals.open_rate * 100)}%</dd></div>
          </dl>
          <div className="trends__grid">
            <ChartCard wide title="Interests over time" note="Surveys per minute by topic. Pick a topic to filter every chart.">
              <InterestLines data={trends.interests_over_time} active={interest} onPick={pick} />
            </ChartCard>
            <ChartCard title="Who is here">
              <Bars title="Role" items={trends.roles} />
              <Bars title="Level" items={trends.levels} />
              <Bars title="Look" items={trends.vibes} />
              {keyTable("Who is here", [["Role", trends.roles], ["Level", trends.levels], ["Look", trends.vibes]])}
            </ChartCard>
            <ChartCard title="Recommended against opened" note="Per session, most recommended first.">
              <SessionBars sessions={trends.sessions} />
            </ChartCard>
            <ChartCard title="What the agent decided">
              <Bars title="Theme" items={trends.agent.decisions.theme} />
              <Bars title="Layout" items={trends.agent.decisions.layout} />
              {keyTable("What the agent decided", [["Theme", trends.agent.decisions.theme], ["Layout", trends.agent.decisions.layout]])}
            </ChartCard>
            <ChartCard title="Builds per minute">
              <Builds data={trends.agent.builds_over_time} latency={trends.agent.latency_ms} />
            </ChartCard>
          </div>
        </>
      ) : null}
    </section>
  );
}
