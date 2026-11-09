import type { Incident, IncidentState } from "../api/types";
import "./visuals.css";

export type Phase = "alert" | "responding" | "recovering" | "clear";

export function phaseOf(state: IncidentState): Phase {
  if (state === "resolved") return "clear";
  if (state === "verifying") return "recovering";
  if (state === "dispatched" || state === "accepted") return "responding";
  return "alert";
}

const CAPTIONS: Record<Incident["type"], Record<Phase, string>> = {
  overflow: {
    alert: "Seats full, people queuing at the door",
    responding: "Staff heading to the door",
    recovering: "Door queue clearing",
    clear: "Within capacity",
  },
  stage_av: {
    alert: "Microphone input lost",
    responding: "AV tech on the way",
    recovering: "Audio back, watching for dropouts",
    clear: "Audio steady",
  },
  badge_stall: {
    alert: "Badge printer stalled, queue growing",
    responding: "IT rerouting jobs",
    recovering: "Queue draining",
    clear: "Badges printing",
  },
  reported_problem: {
    alert: "Someone reported a problem",
    responding: "Staff responding",
    recovering: "Checking it is fixed",
    clear: "Resolved",
  },
};

const SEATS = Array.from({ length: 24 }, (_, i) => ({ x: 26 + (i % 8) * 22, y: 30 + Math.floor(i / 8) * 22 }));
const SPILL = [
  { x: 224, y: 58 },
  { x: 240, y: 70 },
  { x: 232, y: 86 },
  { x: 252, y: 54 },
  { x: 256, y: 84 },
  { x: 270, y: 68 },
];
const QUEUE = [0, 1, 2, 3, 4, 5, 6];

function Overflow({ phase }: { phase: Phase }) {
  const emptySeats = phase === "clear" ? new Set([3, 9, 14, 20, 22]) : phase === "recovering" ? new Set([9, 20]) : new Set<number>();
  return (
    <svg viewBox="0 0 300 120" className="ivis__svg" aria-hidden="true">
      <rect x="10" y="12" width="196" height="96" rx="12" className="ivis__room" />
      <rect x="203" y="48" width="6" height="40" rx="3" className="ivis__door" />
      {SEATS.map((seat, i) => (
        <circle key={i} cx={seat.x} cy={seat.y} r="7" className={emptySeats.has(i) ? "ivis__seat" : "ivis__seat ivis__seat--taken"} />
      ))}
      <g className="ivis__spill">
        {SPILL.map((dot, i) => (
          <circle key={i} cx={dot.x} cy={dot.y} r="7" style={{ animationDelay: `${i * 0.18}s` }} />
        ))}
      </g>
      <circle cx="292" cy="70" r="7" className="ivis__staff" />
    </svg>
  );
}

function Microphone({ phase }: { phase: Phase }) {
  return (
    <svg viewBox="0 0 300 120" className="ivis__svg" aria-hidden="true">
      <g className="ivis__mic">
        <rect x="46" y="22" width="34" height="56" rx="17" />
        <path d="M36 62 Q36 92 63 92 Q90 92 90 62" fill="none" />
        <line x1="63" y1="92" x2="63" y2="108" />
        <line x1="48" y1="108" x2="78" y2="108" />
      </g>
      <line x1="30" y1="104" x2="98" y2="16" className="ivis__slash" />
      <g className="ivis__bars">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <rect key={i} x={126 + i * 18} y="30" width="10" height="60" rx="5" style={{ animationDelay: `${(i % 4) * 0.12}s` }} />
        ))}
      </g>
      <path d="M120 60 H290" className="ivis__flat" />
    </svg>
  );
}

function Badge({ phase }: { phase: Phase }) {
  const queued = phase === "clear" ? 1 : phase === "recovering" ? 3 : QUEUE.length;
  return (
    <svg viewBox="0 0 300 120" className="ivis__svg" aria-hidden="true">
      <rect x="22" y="20" width="70" height="84" rx="10" className="ivis__kiosk" />
      <rect x="34" y="34" width="46" height="28" rx="4" className="ivis__screen" />
      <circle cx="57" cy="82" r="8" className="ivis__light" />
      <rect x="40" y="104" width="34" height="8" rx="2" className="ivis__paper" />
      <g className="ivis__queue">
        {QUEUE.slice(0, queued).map((i) => (
          <circle key={i} cx={122 + i * 24} cy="70" r="9" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </g>
    </svg>
  );
}

function Reported() {
  return (
    <svg viewBox="0 0 300 120" className="ivis__svg" aria-hidden="true">
      <circle cx="150" cy="60" r="18" className="ivis__ping" />
      <circle cx="150" cy="60" r="18" className="ivis__ping ivis__ping--late" />
      <path d="M128 42 h44 a8 8 0 0 1 8 8 v18 a8 8 0 0 1 -8 8 h-26 l-12 10 v-10 h-6 a8 8 0 0 1 -8 -8 v-18 a8 8 0 0 1 8 -8 z" className="ivis__bubble" />
    </svg>
  );
}

export function IncidentVisual({ incident, size = "lg" }: { incident: Pick<Incident, "type" | "state">; size?: "sm" | "lg" }) {
  const phase = phaseOf(incident.state);
  const caption = CAPTIONS[incident.type][phase];
  return (
    <figure className={`ivis ivis--${size}`} data-type={incident.type} data-phase={phase}>
      {incident.type === "overflow" ? <Overflow phase={phase} /> : null}
      {incident.type === "stage_av" ? <Microphone phase={phase} /> : null}
      {incident.type === "badge_stall" ? <Badge phase={phase} /> : null}
      {incident.type === "reported_problem" ? <Reported /> : null}
      <figcaption className="ivis__caption">
        <span className="ivis__pulse" aria-hidden="true" />
        {caption}
      </figcaption>
    </figure>
  );
}
