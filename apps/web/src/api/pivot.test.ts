import { describe, it, expect } from "vitest";
import { createPivotClient } from "./pivot";
import type { TransportRequest } from "./transport";

describe("pivot client", () => {
  it("keeps public capability calls credential-free and organizer queries encoded", async () => {
    const calls: TransportRequest[] = [];
    const client = createPivotClient({ getToken: () => "organizer", transport: async r => { calls.push(r); return { status: 200, json: { accepted: true } }; } });
    await client.getAttendee("att_a/b");
    await client.searchTrail({ q: "layout & tone", limit: 20 });
    expect(calls[0].path).toBe("/api/v1/attendee/att_a%2Fb");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].path).toContain("q=layout+%26+tone");
    expect(calls[1].headers.Authorization).toBe("Bearer organizer");
  });
  it("preserves structured rate limit errors without retrying survey creation", async () => {
    let count = 0;
    const client = createPivotClient({ transport: async () => { count++; return { status: 429, json: { error: { code: "rate_limited", message: "Try again later." } } }; } });
    const result = await client.submitSurvey({ source: "qr", answers: { role: "attendee", interests: ["observability"], level: "new", vibe: "calm", accessibility: [] } });
    expect(result).toEqual({ ok: false, status: 429, code: "rate_limited", message: "Try again later." });
    expect(count).toBe(1);
  });
});
