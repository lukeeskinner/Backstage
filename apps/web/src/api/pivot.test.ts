import { describe, expect, it } from "vitest";
import { createPivotClient, PivotApiError } from "./pivot";
import type { Transport, TransportRequest } from "./transport";

function fake(status = 200, json: unknown = {}) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (request) => {
    calls.push(request);
    return { status, json };
  };
  return { calls, transport };
}

describe("pivot client", () => {
  it("sends no Authorization header on public attendee routes", async () => {
    const { calls, transport } = fake();
    const pivot = createPivotClient({ transport, getToken: () => "secret" });
    await pivot.submitSurvey({
      source: "qr",
      answers: {
        role: "attendee",
        interests: ["observability"],
        level: "new",
        vibe: "calm",
        accessibility: [],
      },
    });
    await pivot.getAttendee("att_k7m2qx4n3w5p");
    await pivot.recordInteraction("att_k7m2qx4n3w5p", {
      session_id: "sess-014",
      action: "open",
      position: 0,
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /attendee/surveys",
      "GET /attendee/att_k7m2qx4n3w5p",
      "POST /attendee/att_k7m2qx4n3w5p/interactions",
    ]);
    for (const call of calls) {
      expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain(
        "authorization",
      );
    }
  });

  it("sends the bearer and omits empty query params on organizer routes", async () => {
    const { calls, transport } = fake();
    const pivot = createPivotClient({ transport, getToken: () => "secret" });
    await pivot.getTrends({ window: "60m", interval: "1m", interest: null, source: "" });
    await pivot.searchTrail({
      q: "why schedule-first",
      kind: "decision",
      step: null,
      tool: "",
      run_id: undefined,
      limit: 20,
    });
    await pivot.searchTrail();
    await pivot.getTrailRun("run_b3x6t2m7q4ha");
    expect(calls.map((call) => call.path)).toEqual([
      "/pivot/trends?window=60m&interval=1m",
      "/pivot/trail/search?q=why%20schedule-first&kind=decision&limit=20",
      "/pivot/trail/search",
      "/pivot/trail/runs/run_b3x6t2m7q4ha",
    ]);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.headers.Authorization).toBe("Bearer secret");
    }
  });

  it("turns a 429 body into a PivotApiError", async () => {
    const { transport } = fake(429, {
      error: { code: "rate_limited", message: "Try again in a minute." },
    });
    const pivot = createPivotClient({ transport });
    const error = await pivot
      .submitSurvey({
        source: "qr",
        answers: {
          role: "attendee",
          interests: ["security"],
          level: "expert",
          vibe: "bold",
          accessibility: [],
        },
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PivotApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "rate_limited",
      message: "Try again in a minute.",
    });
  });

  it("falls back when the error body is not the contract shape", async () => {
    const { transport } = fake(502, null);
    const pivot = createPivotClient({ transport });
    await expect(pivot.getTrailRun("run_x")).rejects.toMatchObject({
      status: 502,
      code: "http_502",
    });
  });
});
