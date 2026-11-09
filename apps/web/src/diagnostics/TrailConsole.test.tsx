import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  PivotClient,
  TrailItem,
  TrailSearchResponse,
} from "../api/pivot";
import { TrailConsole } from "./TrailConsole";

const item: TrailItem = {
  event_id: "run_b3x6t2m7q4ha:0003",
  run_id: "run_b3x6t2m7q4ha",
  attendee_id: "att_k7m2qx4n3w5p",
  seq: 3,
  at: "2026-11-09T23:30:09Z",
  kind: "decision",
  step: "plan",
  title: "Chose a bold, schedule-first layout",
  detail: "Three of the six picks start soon, so the schedule leads.",
  highlight: {
    detail: ["so the <em>schedule</em> leads <img src=x onerror=alert(1)>"],
  },
  decision: {
    name: "layout",
    value: "schedule-first",
    rationale: "Three of the six picks start within the next two hours.",
  },
  tool: "openai",
  duration_ms: 1840,
  outcome: "ok",
  commit: null,
  trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  trace_url: null,
};
const response: TrailSearchResponse = {
  total: 1,
  limit: 20,
  items: [item],
  facets: {
    kind: [{ key: "decision", count: 12 }],
    step: [{ key: "plan", count: 12 }],
    tool: [{ key: "openai", count: 14 }],
    outcome: [{ key: "ok", count: 35 }],
  },
};

function fakePivot(result: TrailSearchResponse = response) {
  const searchTrail = vi.fn(async () => result);
  const getTrailRun = vi.fn(async () => ({
    run_id: item.run_id,
    attendee_id: item.attendee_id,
    survey: {
      role: "attendee" as const,
      interests: ["observability" as const],
      level: "practitioner" as const,
      vibe: "bold" as const,
      accessibility: [],
      source: "qr" as const,
      created_at: "2026-11-09T23:30:04Z",
    },
    site: { status: "ready" as const },
    trace_id: item.trace_id ?? null,
    trace_url: null,
    events: [{ ...item, highlight: undefined, title: "Timeline event" }],
  }));
  const pivot = { searchTrail, getTrailRun } as unknown as PivotClient;
  return { pivot, searchTrail, getTrailRun };
}

describe("TrailConsole", () => {
  it("loads results on mount with an empty query", async () => {
    const { pivot, searchTrail } = fakePivot();
    render(<TrailConsole pivot={pivot} />);
    expect(
      await screen.findByRole("heading", { name: item.title }),
    ).toBeInTheDocument();
    expect(searchTrail).toHaveBeenCalledTimes(1);
    expect(searchTrail).toHaveBeenCalledWith(
      expect.objectContaining({ q: "" }),
    );
    expect(
      screen.getByRole("option", { name: "decision (12)" }),
    ).toBeInTheDocument();
  });

  it("renders highlights inside <mark> without injecting HTML", async () => {
    const { pivot } = fakePivot();
    const { container } = render(<TrailConsole pivot={pivot} />);
    const mark = await screen.findByText("schedule", { selector: "mark" });
    expect(mark.tagName).toBe("MARK");
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByText(/<img src=x onerror=alert\(1\)>/),
    ).toBeInTheDocument();
  });

  it("searches with the submitted query", async () => {
    const user = userEvent.setup();
    const { pivot, searchTrail } = fakePivot();
    render(<TrailConsole pivot={pivot} />);
    await screen.findByRole("heading", { name: item.title });
    await user.type(
      screen.getByRole("searchbox", { name: "Search agent events" }),
      "why schedule-first",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(searchTrail).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "why schedule-first" }),
      ),
    );
  });

  it("opens a run timeline and shows the empty and error states", async () => {
    const user = userEvent.setup();
    const { pivot, getTrailRun } = fakePivot();
    const { unmount } = render(<TrailConsole pivot={pivot} />);
    await user.click(await screen.findByRole("button", { name: /^Open run/ }));
    expect(getTrailRun).toHaveBeenCalledWith(item.run_id);
    expect(
      await screen.findByRole("list", { name: "Run timeline" }),
    ).toHaveTextContent("Timeline event");
    await user.click(screen.getByRole("button", { name: "Close run" }));
    expect(screen.queryByRole("list", { name: "Run timeline" })).toBeNull();
    unmount();

    const empty = fakePivot({ ...response, total: 0, items: [] });
    const second = render(<TrailConsole pivot={empty.pivot} />);
    expect(
      await screen.findByText("No matching agent events yet."),
    ).toBeInTheDocument();
    second.unmount();

    const failing = {
      searchTrail: vi.fn(async () => {
        throw new Error("Organizer access required.");
      }),
      getTrailRun: vi.fn(),
    } as unknown as PivotClient;
    render(<TrailConsole pivot={failing} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Organizer access required.",
    );
  });

  it("shows inline sample data in mock mode without calling the API", async () => {
    const { pivot, searchTrail } = fakePivot();
    render(<TrailConsole pivot={pivot} mockMode />);
    expect(screen.getByText("Mock data")).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Agent events" }).children,
    ).toHaveLength(2);
    expect(searchTrail).not.toHaveBeenCalled();
  });
});
