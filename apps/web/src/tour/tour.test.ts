import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Incident, IncidentsPage } from "../api/types";
import { MockIncidentApi } from "../mock/store";
import { MOCK_PRINCIPALS } from "../mock/transport";
import { phaseOf } from "../visuals/IncidentVisual";
import { TOUR } from "./script";
import { floorAt } from "../venue/floor";

const organizer = { Authorization: "Bearer mock-organizer" };

function list(api: MockIncidentApi): Incident[] {
  return (api.handle({ method: "GET", path: "/incidents", headers: organizer }).json as IncidentsPage).items;
}

describe("guided demo mock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps the overflow incident off the board until it is raised", () => {
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS, startHidden: true });
    expect(list(api)).toEqual([]);
    expect(api.handle({ method: "GET", path: "/incidents/inc-overflow-room-b", headers: organizer }).status).toBe(404);
    api.raise();
    expect(list(api).map((incident) => incident.id)).toEqual(["inc-overflow-room-b"]);
  });

  it("walks a background incident to resolved without user actions and refuses actions on it", () => {
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS, startHidden: true, backgroundStepMs: 1000 });
    api.raiseBackground("stage_av");
    const id = "inc-stage_av-room-b";
    expect(list(api)[0]?.state).toBe("plan_proposed");
    expect(list(api)[0]?.allowed_actions).toEqual([]);
    const action = api.handle({ method: "POST", path: `/incidents/${id}/actions`, headers: { ...organizer, "Idempotency-Key": "k" }, body: {} });
    expect(action.status).toBe(403);
    vi.advanceTimersByTime(6000);
    const done = list(api)[0];
    expect(done?.state).toBe("resolved");
    expect(done?.verification.status).toBe("passed");
    const events = api.handle({ method: "GET", path: `/incidents/${id}/events`, headers: organizer }).json as { items: { type: string }[] };
    expect(events.items.slice(-5).map((event) => event.type)).toEqual(["approve", "dispatch", "ack", "verify", "close"]);
  });

  it("clears background incidents on reset", () => {
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS, startHidden: true });
    api.raiseBackground("badge_stall");
    api.raise();
    api.reset();
    expect(list(api)).toEqual([]);
  });
});

describe("tour script", () => {
  it("has unique step ids and a hold on every step", () => {
    expect(new Set(TOUR.map((step) => step.id)).size).toBe(TOUR.length);
    for (const step of TOUR) expect(step.holdMs).toBeGreaterThan(0);
  });

  it("raises the incident before any step that needs it on the board", () => {
    const raise = TOUR.findIndex((step) => step.id === "raise");
    const firstSelect = TOUR.findIndex((step) => step.select);
    expect(raise).toBeGreaterThan(-1);
    expect(firstSelect).toBeGreaterThan(raise);
  });
});

describe("incident visual phases", () => {
  it("maps protocol states to visual phases", () => {
    expect(phaseOf("plan_proposed")).toBe("alert");
    expect(phaseOf("dispatched")).toBe("responding");
    expect(phaseOf("accepted")).toBe("responding");
    expect(phaseOf("verifying")).toBe("recovering");
    expect(phaseOf("resolved")).toBe("clear");
  });
});

describe("venue floor", () => {
  it("lights up only the incident's area and walks the assignee there", () => {
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS });
    const incident = list(api)[0]!;
    const calm = floorAt([incident], 0);
    const room = calm.areas.find((view) => view.area.id === "room-255bc")!;
    expect(room.status).toBe("affected");
    expect(room.occupancy).toBeGreaterThan(1);
    expect(calm.areas.filter((view) => view.status !== "normal")).toHaveLength(1);

    const dispatched = { ...incident, state: "dispatched" as const, assignment: { id: "a", assignee_id: "venue-staff-01", domain: "venue" as const } };
    const walking = floorAt([dispatched], 0).volunteers.find((view) => view.volunteer.id === "venue-staff-01")!;
    expect(walking.busy).toBe(true);
    expect(walking.x).toBeGreaterThanOrEqual(room.area.x);
    expect(walking.x).toBeLessThanOrEqual(room.area.x + room.area.w);
  });
});
