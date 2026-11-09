import assert from "node:assert/strict";
import { test } from "node:test";
import { createDemoServer } from "./index.mjs";

async function fixture(t) {
  let clock = Date.parse("2026-11-09T20:00:00Z");
  let next;
  let state = "plan_proposed";
  let fail = false;
  const signals = [];
  const paths = [];
  const incident = () => ({ id: "incident-rehearsal", room_id: "room-b", type: "overflow", state });
  const server = createDemoServer({ rehearsal: {
    env: { DEMO_OPERATOR_TOKEN: "organizer-private", DEMO_SIGNAL_TOKEN: "producer-private" }, now: () => clock,
    schedule: (fn) => { next = fn; return 1; }, cancel: () => { next = null; },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      paths.push(path);
      assert.ok(!path.includes("actions"));
      if (path.endsWith("/signals")) {
        assert.equal(options.headers.Authorization, "Bearer producer-private");
        if (fail) return { ok: false, status: 503 };
        signals.push(JSON.parse(options.body));
        const raised = clock >= Date.parse("2026-11-09T20:00:30Z");
        return { ok: true, json: async () => ({ incident_id: raised ? "incident-rehearsal" : null }) };
      }
      assert.equal(options.headers.Authorization, "Bearer organizer-private");
      return { ok: true, json: async () => path.endsWith("/incidents") ? { items: signals.length >= 14 ? [incident()] : [] } : incident() };
    },
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path = "run", { token = "organizer-private", method = "POST", key = "rehearsal-intent-1", origin } = {}) => {
    const response = await fetch(`${base}/demo-api/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": key, ...(origin ? { Origin: origin } : {}) } });
    return { status: response.status, body: await response.json() };
  };
  return { request, signals, paths, fail: () => { fail = true; }, state: (value) => { state = value; }, advance: async (seconds = 5) => { clock += seconds * 1000; const fn = next; next = null; await fn?.(); } };
}

test("rehearsal rejects other identities and cross-origin writes before calling the API", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("run", { token: "staff-private" })).status, 403);
  assert.equal((await f.request("run", { token: "" })).status, 403);
  assert.equal((await f.request("run", { origin: "https://attacker.example" })).status, 403);
  assert.equal(f.paths.length, 0);
});
test("one intent is idempotent, creates only count signals, and never performs human actions", async (t) => {
  const f = await fixture(t);
  const first = await f.request();
  assert.equal(first.status, 202);
  assert.equal(f.signals.length, 2);
  assert.equal((await f.request()).body.run.id, first.body.run.id);
  assert.equal(f.signals.length, 2);
  assert.equal((await f.request("run", { key: "new-intent-2" })).status, 409);
  for (let n = 0; n < 6; n++) await f.advance();
  const run = (await f.request("run", { method: "GET" })).body.run;
  assert.equal(run.phase, "awaiting_humans");
  assert.equal(run.incident_id, "incident-rehearsal");
  assert.equal((await f.request("recover")).status, 409);
  f.state("verifying");
  assert.equal((await f.request("recover")).status, 202);
  const began = (await f.request("run", { method: "GET" })).body.run.recovery_started_at;
  await f.advance();
  assert.equal((await f.request("recover")).body.run.recovery_started_at, began);
  assert.equal(f.signals.at(-1).data.count, 2);
  f.state("resolved");
  const count = f.signals.length;
  await f.advance();
  assert.equal((await f.request("run", { method: "GET" })).body.run.phase, "completed");
  assert.equal(f.signals.length, count);
  assert.ok(f.signals.every((signal) => signal.signal_id.startsWith("demo-video-") && signal.kind === "zone_count"));
  assert.equal(new Set(f.signals.map((signal) => signal.signal_id)).size, f.signals.length);
  assert.ok(!JSON.stringify(run).includes("private"));
});
test("failed ingress pauses honestly, prevents another run, and preserves prior receipts", async (t) => {
  const f = await fixture(t);
  await f.request();
  f.fail();
  await f.advance();
  const run = (await f.request("run", { method: "GET" })).body.run;
  assert.equal(run.phase, "paused");
  assert.equal(run.samples, 1);
  assert.match(run.error, /503/);
  assert.equal((await f.request("run", { key: "different-intent" })).status, 409);
});
test("the bounded run stops when eight minutes elapse instead of injecting indefinitely", async (t) => {
  const f = await fixture(t);
  await f.request();
  await f.advance(481);
  const run = (await f.request("run", { method: "GET" })).body.run;
  assert.equal(run.phase, "paused");
  assert.match(run.error, /Eight-minute/);
  assert.equal(f.signals.length, 2);
});
