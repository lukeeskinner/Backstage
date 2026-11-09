import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createDemoServer } from "./index.mjs";

test("the real Vite proxy preserves same-origin POSTs while rejecting foreign origins", async (t) => {
  const runtime = createDemoServer({ rehearsal: {
    env: { DEMO_OPERATOR_TOKEN: "proxy-organizer", DEMO_SIGNAL_TOKEN: "proxy-producer" },
    schedule: () => 1, cancel: () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [], incident_id: null }) }),
  } });
  await new Promise((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { runtime.close(resolve); runtime.closeAllConnections(); }));
  const oldTarget = process.env.WEB_SERVER_PROXY_TARGET;
  process.env.WEB_SERVER_PROXY_TARGET = `http://127.0.0.1:${runtime.address().port}`;
  t.after(() => { if (oldTarget === undefined) delete process.env.WEB_SERVER_PROXY_TARGET; else process.env.WEB_SERVER_PROXY_TARGET = oldTarget; });
  const vite = await createViteServer({ configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)), server: { host: "127.0.0.1", port: 0 } });
  t.after(() => vite.close());
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const headers = { Authorization: "Bearer proxy-organizer", Origin: origin, "Idempotency-Key": "proxy-start-intent" };
  const good = await fetch(`${origin}/demo-api/run`, { method: "POST", headers });
  assert.equal(good.status, 202);
  assert.equal((await good.json()).run.phase, "injecting");
  const denied = await fetch(`${origin}/demo-api/run`, { method: "POST", headers: { ...headers, Origin: "https://foreign.example" } });
  assert.equal(denied.status, 403);
});
