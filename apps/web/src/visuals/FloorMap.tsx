import { useEffect, useId, useState } from "react";
import type { Incident } from "../api/types";
import { floorAt, type AreaView } from "../venue/floor";
import "./floor.css";

const ICON: Record<Incident["type"], string> = {
  overflow: "M-9 6a9 9 0 0 1 18 0M0-9a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  stage_av: "M-4-10h8v12h-8zM-8 0a8 8 0 0 0 16 0M0 8v5",
  badge_stall: "M-8-10h16v20h-16zM-4-5h8M-4 0h8",
  reported_problem: "M-9-8h18v12h-10l-5 5v-5h-3z",
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function AreaBox({ view }: { view: AreaView }) {
  const { area, status, occupancy, incidents } = view;
  const barWidth = area.w - 28;
  return (
    <g className="floor__area" data-status={status} data-kind={area.kind}>
      <rect x={area.x} y={area.y} width={area.w} height={area.h} rx="12" className="floor__room" />
      <text x={area.x + 14} y={area.y + 24} className="floor__name">{area.label}</text>
      <rect x={area.x + 14} y={area.y + 36} width={barWidth} height="6" rx="3" className="floor__track" />
      <rect x={area.x + 14} y={area.y + 36} width={Math.min(barWidth, barWidth * occupancy)} height="6" rx="3" className="floor__fill" data-over={occupancy > 1 ? "true" : undefined} />
      <text x={area.x + 14} y={area.y + 60} className="floor__occ">{percent(occupancy)} full</text>
      {incidents.map((incident, index) => (
        <g key={`${incident.type}-${index}`} transform={`translate(${area.x + area.w - 22 - index * 30} ${area.y + 24})`} className="floor__alert" data-phase={incident.phase}>
          <circle r="13" />
          <path d={ICON[incident.type]} />
        </g>
      ))}
    </g>
  );
}

export function FloorMap({ incidents }: { incidents: Incident[] }) {
  const titleId = useId();
  const [t, setT] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setT((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const { areas, volunteers } = floorAt(incidents, t);
  const affected = areas.filter((view) => view.status === "affected").length;
  const recovering = areas.filter((view) => view.status === "recovering").length;
  const busy = volunteers.filter((view) => view.busy).length;

  return (
    <section className="floor" aria-labelledby={titleId}>
      <header className="floor__head">
        <div>
          <h2 id={titleId} className="floor__title">Venue floor</h2>
          <p className="floor__summary">
            {areas.length - affected - recovering} of {areas.length} areas normal
            {affected ? ` · ${affected} affected` : ""}
            {recovering ? ` · ${recovering} recovering` : ""} · {volunteers.length} volunteers on shift, {busy} responding
          </p>
        </div>
        <ul className="floor__legend" aria-label="Legend">
          <li><span data-swatch="venue" />Venue</li>
          <li><span data-swatch="av" />AV</li>
          <li><span data-swatch="it" />IT</li>
        </ul>
      </header>
      <svg viewBox="0 0 1000 420" className="floor__map" role="img" aria-label={`Venue map. ${affected} areas affected, ${recovering} recovering.`}>
        <text x="20" y="34" className="floor__level">LEVEL 1</text>
        <text x="20" y="210" className="floor__level">LEVEL 2 · HYATT REGENCY</text>
        {areas.map((view) => <AreaBox key={view.area.id} view={view} />)}
        {volunteers.map((view) => (
          <g key={view.volunteer.id} className="floor__person" data-domain={view.volunteer.domain} data-busy={view.busy ? "true" : undefined}
            style={{ transform: `translate(${view.x}px, ${view.y}px)` }}>
            <circle r="8" />
            <title>{`${view.volunteer.label}${view.busy ? ", responding" : ""}`}</title>
          </g>
        ))}
      </svg>
      <ul className="sr-only">
        {areas.map((view) => (
          <li key={view.area.id}>{view.area.label}: {view.status}, about {percent(view.occupancy)} full.</li>
        ))}
      </ul>
      <p className="floor__note">Schematic layout. Occupancy is simulated for the demo; real capacities are not published.</p>
    </section>
  );
}
