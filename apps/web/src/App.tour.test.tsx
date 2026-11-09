import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// Timer behavior is exercised with the real director in tour/pause.test.tsx.
vi.mock("./tour/TourDirector", () => ({ TourDirector: () => <aside>Simulated tour</aside> }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); window.localStorage.clear(); window.history.replaceState(null, "", "/"); });

it("keeps the merged survey, site and trends in a live build's tour without network writes", async () => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_MOCK_API", "false");
  window.history.replaceState(null, "", "/?tour=1#/");
  const network = vi.fn(() => Promise.reject(new Error("Tour must not use the network")));
  vi.stubGlobal("fetch", network);
  vi.resetModules();
  const { default: App } = await import("./App");
  render(<App />);
  const navigate = async (hash: string) => {
    await act(async () => {
      window.history.replaceState(null, "", `/?tour=1${hash}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      await vi.advanceTimersByTimeAsync(200);
    });
  };
  await navigate("#/trends");
  expect(screen.getByRole("heading", { name: /trends/i })).toBeInTheDocument();
  await navigate("#/projector");
  expect(screen.getByText(/site\(att_k7m2qx4n3w5p\)/)).toBeInTheDocument();
  await navigate("#/join");
  expect(screen.getByRole("heading", { name: "Get a conference site built for you" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Attendee" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "AI agents" }));
  fireEvent.click(screen.getByRole("radio", { name: "Practitioner" }));
  fireEvent.click(screen.getByRole("button", { name: "Build my site" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(window.location.hash).toMatch(/^#\/site\/att_/);
  expect(network).not.toHaveBeenCalled();
});

it("clears the rehearsal driver when the mock controls reset the scenario", async () => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_MOCK_API", "true");
  window.history.replaceState(null, "", "/#/demo");
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("No external service in mock mode"))));
  vi.resetModules();
  const { default: App } = await import("./App");
  render(<App />);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.click(screen.getByRole("button", { name: "Inject crowd surge" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(screen.getByText(/Crowd surge injected/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Mock controls (rehearsal only)"));
  fireEvent.click(screen.getByRole("button", { name: "Reset scenario" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
  expect(screen.getByText("Ready. No rehearsal has been started.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Inject crowd surge" })).toBeEnabled();
});
