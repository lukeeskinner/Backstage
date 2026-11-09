import type { Transport } from "../api/transport";
import { ATTENDEE_ID } from "./types";
import type { AttendeeView, InteractionAction, PivotResult, SurveyAnswers, SurveyCreated, Trends } from "./types";

export interface PivotApiOptions {
  transport: Transport;
  getToken: () => string;
}

const NETWORK_MESSAGE = "Could not reach Backstage. Check your connection and try again.";

export function createPivotApi({ transport, getToken }: PivotApiOptions) {
  async function request<T>(method: "GET" | "POST", path: string, options: { body?: unknown; auth?: boolean; signal?: AbortSignal } = {}): Promise<PivotResult<T>> {
    try {
      const response = await transport({
        method,
        path,
        headers: options.auth ? { Authorization: `Bearer ${getToken()}` } : {},
        body: options.body,
        signal: options.signal,
      });
      if (response.status >= 200 && response.status < 300) return { ok: true, data: response.json as T };
      const error = (response.json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      return {
        ok: false,
        status: response.status,
        code: typeof error?.code === "string" ? error.code : "unavailable",
        message: typeof error?.message === "string" ? error.message : `Request failed with status ${response.status}.`,
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      return { ok: false, status: 0, code: "network", message: NETWORK_MESSAGE };
    }
  }

  return {
    submitSurvey: (answers: SurveyAnswers) =>
      request<SurveyCreated>("POST", "/attendee/surveys", { body: { source: "qr", answers } }),
    getAttendee: (attendeeId: string, signal?: AbortSignal) =>
      request<AttendeeView>("GET", `/attendee/${encodeURIComponent(attendeeId)}`, { signal }),
    recordInteraction: (attendeeId: string, sessionId: string, action: InteractionAction, position: number) =>
      request<{ accepted: boolean }>("POST", `/attendee/${encodeURIComponent(attendeeId)}/interactions`, {
        body: { session_id: sessionId, action, position },
      }),
    getTrends: (query: { interest?: string | null; source?: string | null }, signal?: AbortSignal) => {
      const params = new URLSearchParams({ window: "60m", interval: "1m" });
      if (query.interest) params.set("interest", query.interest);
      if (query.source) params.set("source", query.source);
      return request<Trends>("GET", `/pivot/trends?${params}`, { auth: true, signal });
    },
  };
}

export type PivotApi = ReturnType<typeof createPivotApi>;

const ATTENDEE_KEY = "backstage.attendeeId";

/** The attendee id is the only credential a phone holds. It stays in this browser. */
export function rememberAttendeeId(attendeeId: string): void {
  try {
    window.localStorage.setItem(ATTENDEE_KEY, attendeeId);
  } catch {
    return;
  }
}

export function recallAttendeeId(): string | null {
  try {
    const stored = window.localStorage.getItem(ATTENDEE_KEY);
    return stored && ATTENDEE_ID.test(stored) ? stored : null;
  } catch {
    return null;
  }
}
