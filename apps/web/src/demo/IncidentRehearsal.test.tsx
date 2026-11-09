import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "../api/client";
import { IncidentRehearsal } from "./IncidentRehearsal";
import type { Incident } from "../api/types";

const client = () => createClient({ getToken: () => "scoped-role", transport: async () => ({ status: 200, json: { items: [], next_cursor: null } }) });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("works under StrictMode, starts only on a click and preserves the intent after an ambiguous failure", async () => {
  let posts = 0;
  const fetchMock = vi.fn(async (_path: string, options: RequestInit) => {
    if (options.method === "POST") { posts++; throw Error("connection lost"); }
    return { ok: true, json: async () => ({ run: null }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<StrictMode><IncidentRehearsal client={client()} token="organizer-token" organizer announce={() => {}} /></StrictMode>);
  const button = screen.getByRole("button", { name: "Inject crowd surge" });
  await waitFor(() => expect(button).toBeEnabled());
  expect(posts).toBe(0);
  const user = userEvent.setup();
  await user.click(button);
  await screen.findByText("connection lost");
  await user.click(button);
  const requests = fetchMock.mock.calls.filter((call) => call[1].method === "POST");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.[1].headers).toEqual(requests[1]?.[1].headers);
  expect(screen.getByRole("button", { name: /Clear surge/ })).toBeDisabled();
});
it("offers staff the scoped board and inbox without producer controls or producer requests", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(<IncidentRehearsal client={client()} token="staff-token" organizer={false} announce={() => {}} />);
  expect(screen.queryByRole("button", { name: "Inject crowd surge" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open your role inbox" })).toHaveAttribute("href", "#/me");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("hides the previous resolved incident while a new run is collecting trigger evidence", async () => {
  const previous: Incident = { id: "previous-run", type: "overflow", room_id: "room-b", session_id: null, priority: "high", state: "resolved", version: 8, updated_at: new Date().toISOString(), summary: "Previous resolved crowding", plan: null, assignment: null, verification: { status: "passed", summary: null }, allowed_actions: [], trace_id: null };
  const api = createClient({ getToken: () => "organizer", transport: async ({ path }) => path.endsWith("diagnostics") ? { status: 503, json: {} } : { status: 200, json: { items: path === "/incidents" ? [previous] : [], next_cursor: null } } });
  vi.stubGlobal("fetch", vi.fn(async (_path: string, options: RequestInit) => ({ ok: true, json: async () => ({ run: options.method === "POST" ? { id: "new-run", phase: "injecting", incident_id: null, samples: 1, error: null } : null }) })));
  render(<IncidentRehearsal client={api} token="organizer-token" organizer announce={() => {}} />);
  await screen.findByText("Previous resolved crowding");
  const start = screen.getByRole("button", { name: "Inject crowd surge" });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.setup().click(start);
  await screen.findByText("Crowd surge injected · waiting for 30 seconds of evidence");
  expect(screen.queryByText("Previous resolved crowding")).not.toBeInTheDocument();
});
