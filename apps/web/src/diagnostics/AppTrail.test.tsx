import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Keep tour navigation stationary; its timing is covered by tour/pause.test.tsx.
vi.mock("../tour/TourDirector", () => ({ TourDirector: () => <aside>Simulated tour</aside> }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("mounts the live trail route with organizer auth and clears its run when credentials change", async () => {
  vi.stubEnv("VITE_MOCK_API", "false");
  window.history.replaceState(null, "", "/#/trail");
  window.sessionStorage.setItem("backstage.tokens", JSON.stringify({ organizer: "trail-test-token" }));
  const event = {
    event_id: "run_b3x6t2m7q4ha:0001", run_id: "run_b3x6t2m7q4ha", attendee_id: "att_k7m2qx4n3w5p",
    seq: 1, at: "2026-11-09T23:30:00Z", kind: "action", step: "claim", title: "Live trail route event",
    detail: "Claimed the queued site.", tool: "elasticsearch", outcome: "ok", trace_id: null, trace_url: null,
  };
  const network = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const path = String(input);
    const data = path.startsWith("/api/v1/pivot/trail/search")
      ? { total: 1, limit: 20, items: [event], facets: { kind: [], step: [], tool: [], outcome: [] } }
      : path.startsWith("/api/v1/pivot/trail/runs/")
        ? { run_id: event.run_id, attendee_id: event.attendee_id, survey: null, site: null, trace_id: null, trace_url: null, events: [{ ...event, title: "Live run timeline event" }] }
        : path === "/presence"
          ? { counts: { attendee: 0, speaker: 0, staff: 0, organizer: 0 } }
          : null;
    if (!data) throw new Error("Unexpected App request");
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", network);
  vi.resetModules();
  const { default: App } = await import("../App");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Search the agent trail" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: event.title })).toBeInTheDocument();
  const searchCall = network.mock.calls.find(([url]) => String(url).startsWith("/api/v1/pivot/trail/search"));
  expect(searchCall?.[1]?.headers).toMatchObject({ Authorization: "Bearer trail-test-token" });
  fireEvent.click(screen.getByRole("button", { name: /^Open run/ }));
  expect(await screen.findByRole("list", { name: "Run timeline" })).toHaveTextContent("Live run timeline event");
  fireEvent.change(screen.getByLabelText("API token"), { target: { value: "replacement-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Use token", hidden: true }));
  await waitFor(() => expect(network.mock.calls.some(([url, init]) =>
    String(url).startsWith("/api/v1/pivot/trail/search") && (init?.headers as Record<string, string>)?.Authorization === "Bearer replacement-token",
  )).toBe(true));
  expect(screen.queryByRole("list", { name: "Run timeline" })).toBeNull();
});

it("mounts sample trail events in a live build's tour without a live request", async () => {
  vi.stubEnv("VITE_MOCK_API", "false");
  window.history.replaceState(null, "", "/?tour=1#/trail");
  const network = vi.fn(() => Promise.reject(new Error("Tour must remain offline")));
  vi.stubGlobal("fetch", network);
  vi.resetModules();
  const { default: App } = await import("../App");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Search the agent trail" })).toBeInTheDocument();
  expect(screen.getByText("Mock data")).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Agent events" }).children).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: /^Open run/ })[0]!);
  expect(await screen.findByRole("list", { name: "Run timeline" })).toBeInTheDocument();
  expect(network).not.toHaveBeenCalled();
});
