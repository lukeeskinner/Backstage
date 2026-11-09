import type { Domain, Incident } from "../api/types";
import { phaseOf, type Phase } from "../visuals/IncidentVisual";

/**
 * Demo floor model. Area names come from NAMED_AREAS in kubecon-na-2026.ts; positions are a schematic, not the
 * real floor plan, and occupancy is simulated because capacities are not published.
 */
export type AreaKind = "registration" | "keynote" | "expo" | "session" | "overflow";

export interface Area {
  id: string;
  label: string;
  level: "Level 1" | "Level 2" | "Hyatt Regency";
  kind: AreaKind;
  /** Contract room id when incidents can name this area. */
  roomId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Typical share of seats taken during a session block. */
  base: number;
}

export const AREAS: Area[] = [
  { id: "registration", label: "Registration", level: "Level 1", kind: "registration", roomId: "room-c", x: 20, y: 44, w: 170, h: 130, base: 0.45 },
  { id: "hall-de", label: "Hall DE · Keynotes", level: "Level 1", kind: "keynote", x: 210, y: 44, w: 330, h: 130, base: 0.6 },
  { id: "hall-1", label: "Hall 1 · Showcase", level: "Level 1", kind: "expo", x: 560, y: 44, w: 200, h: 130, base: 0.55 },
  { id: "hall-5", label: "Hall 5 · Theater", level: "Level 1", kind: "expo", x: 780, y: 44, w: 200, h: 130, base: 0.5 },
  { id: "room-151", label: "Room 151", level: "Level 2", kind: "session", x: 20, y: 222, w: 150, h: 84, base: 0.5 },
  { id: "room-251", label: "Room 251 A-C", level: "Level 2", kind: "session", x: 190, y: 222, w: 220, h: 84, base: 0.65 },
  { id: "room-254", label: "Room 254", level: "Level 2", kind: "session", x: 430, y: 222, w: 150, h: 84, base: 0.4 },
  { id: "room-255a", label: "Room 255 A", level: "Level 2", kind: "session", x: 600, y: 222, w: 150, h: 84, base: 0.55 },
  { id: "room-255bc", label: "Room 255 BC", level: "Level 2", kind: "session", roomId: "room-b", x: 770, y: 222, w: 210, h: 84, base: 0.8 },
  { id: "ballroom-gi", label: "Grand Ballroom GI", level: "Level 2", kind: "session", x: 20, y: 322, w: 390, h: 84, base: 0.5 },
  { id: "hyatt-b", label: "Hyatt Regency Ballroom B · overflow", level: "Hyatt Regency", kind: "overflow", x: 430, y: 322, w: 550, h: 84, base: 0.2 },
];

export interface Volunteer {
  id: string;
  label: string;
  domain: Domain;
  home: string;
}

export const VOLUNTEERS: Volunteer[] = [
  { id: "venue-staff-01", label: "Venue 1", domain: "venue", home: "room-255a" },
  { id: "venue-staff-02", label: "Venue 2", domain: "venue", home: "hall-de" },
  { id: "venue-staff-03", label: "Venue 3", domain: "venue", home: "hall-de" },
  { id: "venue-staff-04", label: "Venue 4", domain: "venue", home: "registration" },
  { id: "venue-staff-05", label: "Venue 5", domain: "venue", home: "room-251" },
  { id: "venue-staff-06", label: "Venue 6", domain: "venue", home: "hall-1" },
  { id: "av-staff-01", label: "AV 1", domain: "av", home: "room-254" },
  { id: "av-staff-02", label: "AV 2", domain: "av", home: "hall-de" },
  { id: "av-staff-03", label: "AV 3", domain: "av", home: "hall-5" },
  { id: "it-staff-01", label: "IT 1", domain: "it", home: "hall-1" },
  { id: "it-staff-02", label: "IT 2", domain: "it", home: "ballroom-gi" },
  { id: "it-staff-03", label: "IT 3", domain: "it", home: "registration" },
];

export type AreaStatus = "normal" | "affected" | "recovering";

export interface AreaView {
  area: Area;
  status: AreaStatus;
  occupancy: number;
  incidents: { type: Incident["type"]; phase: Phase }[];
}

export interface VolunteerView {
  volunteer: Volunteer;
  x: number;
  y: number;
  busy: boolean;
}

function centre(area: Area, slot = 0, of = 1): { x: number; y: number } {
  const spread = Math.min(area.w - 40, 26 * of);
  return { x: area.x + area.w / 2 - spread / 2 + (of > 1 ? (spread / (of - 1)) * slot : spread / 2), y: area.y + area.h - 14 };
}

function statusOf(phases: Phase[]): AreaStatus {
  if (phases.some((phase) => phase === "alert" || phase === "responding")) return "affected";
  if (phases.includes("recovering")) return "recovering";
  return "normal";
}

/** Pure: everything on the map at simulated second `t`. */
export function floorAt(incidents: Incident[], t: number): { areas: AreaView[]; volunteers: VolunteerView[] } {
  const byArea = new Map<string, Incident[]>();
  for (const incident of incidents) {
    const area = AREAS.find((candidate) => candidate.roomId === incident.room_id);
    if (area) byArea.set(area.id, [...(byArea.get(area.id) ?? []), incident]);
  }

  const areas = AREAS.map((area, index) => {
    const here = byArea.get(area.id) ?? [];
    const phases = here.map((incident) => phaseOf(incident.state));
    const drift = 0.07 * Math.sin(t / 6 + index * 1.7) + 0.03 * Math.sin(t / 2.3 + index);
    let occupancy = area.base + drift;
    const crowd = here.find((incident) => incident.type === "overflow");
    if (crowd) {
      const phase = phaseOf(crowd.state);
      occupancy = phase === "alert" ? 1.18 + 0.03 * Math.sin(t) : phase === "responding" ? 1.08 : phase === "recovering" ? 0.94 : 0.86;
    }
    return {
      area,
      status: statusOf(phases),
      occupancy: Math.max(0.05, occupancy),
      incidents: here.map((incident) => ({ type: incident.type, phase: phaseOf(incident.state) })),
    };
  });

  const assigned = new Map<string, Area>();
  for (const incident of incidents) {
    const phase = phaseOf(incident.state);
    const area = AREAS.find((candidate) => candidate.roomId === incident.room_id);
    if (area && incident.assignment && (phase === "responding" || phase === "recovering")) assigned.set(incident.assignment.assignee_id, area);
  }

  const homeCount = new Map<string, number>();
  const volunteers = VOLUNTEERS.map((volunteer) => {
    const home = AREAS.find((area) => area.id === volunteer.home)!;
    const slot = homeCount.get(home.id) ?? 0;
    homeCount.set(home.id, slot + 1);
    const total = VOLUNTEERS.filter((other) => other.home === home.id).length;
    const target = assigned.get(volunteer.id);
    const spot = target ? { x: target.x + target.w / 2 + (volunteer.domain === "av" ? 26 : volunteer.domain === "it" ? -26 : 0), y: target.y + target.h - 14 } : centre(home, slot, total);
    return { volunteer, x: spot.x, y: spot.y, busy: Boolean(target) };
  });

  return { areas, volunteers };
}
