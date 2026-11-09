import type { Incident } from "../api/types";
import type { MockIncidentApi } from "../mock/store";
import type { RehearsalDriver, Run } from "./IncidentRehearsal";

const INCIDENT_ID = "inc-overflow-room-b";

/** Simulated rehearsal: the same run phases as /demo-api, driven by the in-browser mock incident API. */
export function createMockRehearsal(api: MockIncidentApi, token: string, evidenceMs = 4000): RehearsalDriver & { reset(): void } {
  let run: Run | null = null;
  let cancelTimer: (() => void) | undefined;

  const incident = (): Incident | null => {
    const response = api.handle({ method: "GET", path: `/incidents/${INCIDENT_ID}`, headers: { Authorization: `Bearer ${token}` } });
    return response.status === 200 ? (response.json as Incident) : null;
  };

  return {
    async poll() {
      if (!run) return null;
      if (run.phase === "injecting" || run.phase === "recovering") run.samples += 1;
      if (run.incident_id && incident()?.state === "resolved") run.phase = "completed";
      return { ...run };
    },
    async command(phase) {
      const now = new Date().toISOString();
      if (phase === "run") {
        if (run && run.phase !== "completed") return { ...run };
        if (incident()?.state === "resolved") api.reset();
        run = { id: crypto.randomUUID(), phase: "injecting", started_at: now, recovery_started_at: null, incident_id: null, samples: 1, error: null };
        cancelTimer = api.schedule(evidenceMs, () => {
          api.raise();
          if (run) {
            run.phase = "awaiting_humans";
            run.incident_id = INCIDENT_ID;
          }
        });
        return { ...run };
      }
      if (!run) throw new Error("Start a rehearsal first.");
      if (run.phase === "awaiting_humans") {
        run.phase = "recovering";
        run.recovery_started_at = now;
      }
      return { ...run };
    },
    reset() {
      cancelTimer?.();
      cancelTimer = undefined;
      run = null;
    },
  };
}
