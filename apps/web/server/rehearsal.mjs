import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest();

/** One bounded, explicitly injected rehearsal. It never approves, acknowledges or resets API state. */
export function createRehearsalRoutes({ env = process.env, fetchImpl = fetch, now = Date.now,
  schedule = (fn) => { const timer = setTimeout(fn, 5000); timer.unref(); return timer; }, cancel = clearTimeout } = {}) {
  const base = (env.INCIDENT_API_BASE_URL || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
  let run = null;
  let timer;
  let busy = false;
  const operator = () => env.DEMO_OPERATOR_TOKEN?.trim() || "";
  const producer = () => env.DEMO_SIGNAL_TOKEN?.trim() || "";
  const snapshot = () => run && { id: run.id, phase: run.phase, started_at: run.started_at,
    recovery_started_at: run.recovery_started_at, incident_id: run.incident_id, samples: run.samples,
    error: run.error, signal_prefix: `demo-video-${run.id}`, label: "Injected rehearsal counts; video detections are separate" };
  const call = async (path, token, body) => {
    const response = await fetchImpl(`${base}${path}`, { method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error(`Incident API returned ${response.status}. Rehearsal paused; existing evidence is preserved.`);
    return response.json();
  };
  const stopTimer = () => { cancel(timer); timer = undefined; };
  async function tick() {
    if (!run || busy || !["injecting", "awaiting_humans", "recovering"].includes(run.phase)) return;
    busy = true;
    try {
      if (now() - Date.parse(run.started_at) > 8 * 60_000) throw Error("Eight-minute rehearsal limit reached. Existing incident remains in the API.");
      if (run.incident_id) {
        const incident = await call(`/incidents/${encodeURIComponent(run.incident_id)}`, operator());
        if (incident.state === "resolved") { run.phase = "completed"; return; }
        if (incident.state === "escalated") throw Error("Incident escalated. Review its timeline before another rehearsal.");
      }
      const clear = run.phase === "recovering";
      const at = new Date(now()).toISOString();
      for (const [zone, count, threshold] of [["seating", clear ? 10 : 30, 30], ["door", clear ? 2 : 8, 5]]) {
        const signal = { schema_version: 1, signal_id: `demo-video-${run.id}-${run.samples}-${zone}`,
          kind: "zone_count", source_id: "cam-b", room_id: "room-b", session_id: "session-room-b",
          occurred_at: at, data: { zone, count, threshold } };
        // A failed delivery stops the producer instead of fabricating a success or advancing the clock.
        const receipt = await call("/signals", producer(), signal);
        if (receipt.incident_id) run.incident_id = receipt.incident_id;
      }
      run.samples++;
      if (run.incident_id && !clear) run.phase = "awaiting_humans";
    } catch (error) {
      run.phase = "paused";
      run.error = error instanceof Error ? error.message : "Signal delivery failed. Review the incident board.";
    } finally {
      busy = false;
      if (["injecting", "awaiting_humans", "recovering"].includes(run.phase)) timer = schedule(tick);
    }
  }
  return {
    close: stopTimer,
    async handle(request, response) {
      const path = (request.url || "").split("?")[0];
      if (!path.startsWith("/demo-api/")) return false;
      const send = (status, body) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(body)); return true; };
      const fail = (status, message) => send(status, { error: { message } });
      if (!operator() || !producer()) return fail(503, "The rehearsal producer is not configured on this server.");
      const bearer = request.headers.authorization?.replace(/^Bearer /, "") || "";
      if (!bearer || !timingSafeEqual(digest(bearer), digest(operator()))) return fail(403, "Only the configured rehearsal organizer can inject signals.");
      if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}` && request.headers.origin !== `http://${request.headers.host}`) return fail(403, "Use the same-origin rehearsal page.");
      try {
        const incidents = await call("/incidents", bearer);
        if (!Array.isArray(incidents.items)) return fail(503, "Could not verify incident access.");
        if (request.method === "GET" && path === "/demo-api/run") return send(200, { run: snapshot() });
        if (request.method !== "POST") return fail(405, "Method not allowed.");
        if (path === "/demo-api/run") {
          const key = request.headers["idempotency-key"];
          if (typeof key !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(key)) return fail(422, "A rehearsal intent key is required.");
          if (run?.key === key) return send(200, { run: snapshot() });
          if (busy || (run && run.phase !== "completed")) return fail(409, "A rehearsal already exists. Finish its incident before starting another.");
          if (incidents.items.some((incident) => incident.room_id === "room-b" && incident.type === "overflow" && incident.state !== "resolved")) return fail(409, "Room B already has an unresolved overflow. Finish it on the board first.");
          run = { id: randomUUID(), key, phase: "injecting", started_at: new Date(now()).toISOString(), recovery_started_at: null, incident_id: null, samples: 0, error: null };
          await tick();
          return send(202, { run: snapshot() });
        }
        if (path === "/demo-api/recover") {
          if (busy) return fail(409, "A sample is being committed. Try again in a moment.");
          if (run?.phase === "recovering" || run?.phase === "completed") return send(200, { run: snapshot() });
          if (!run?.incident_id || run.phase !== "awaiting_humans") return fail(409, "Wait for the incident and human acceptance before clearing the surge.");
          const incident = await call(`/incidents/${encodeURIComponent(run.incident_id)}`, bearer);
          if (run.phase === "recovering" || run.phase === "completed") return send(200, { run: snapshot() });
          if (busy) return fail(409, "A sample is being committed. Try again in a moment.");
          if (!["accepted", "verifying"].includes(incident.state)) return fail(409, "The assigned venue staff member must accept before recovery starts.");
          stopTimer();
          run.phase = "recovering";
          run.recovery_started_at = new Date(now()).toISOString();
          await tick();
          return send(202, { run: snapshot() });
        }
        return fail(404, "Rehearsal route not found.");
      } catch { return fail(503, "Could not reach the incident API. No successful action is assumed."); }
    },
  };
}
