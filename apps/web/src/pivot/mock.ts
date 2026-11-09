import examples from "@contracts/pivot/examples.v1.json";
import type { Transport, TransportRequest, TransportResponse } from "../api/transport";
import { ATTENDEE_ID, INTERESTS } from "./types";
import type { AttendeeView, KeyCount, ProgressStep, Recommendation, Site, SurveyAnswers, TimeSeries, Trends } from "./types";

const HTTP = examples.http;
const READY = HTTP["GET /api/v1/attendee/{attendee_id}"].response_200_ready;
const RECOMMENDATIONS = HTTP["POST /api/v1/attendee/surveys"].response_201.recommendations as Recommendation[];
const TRENDS = HTTP["GET /api/v1/pivot/trends"].response_200 as unknown as Trends;

const QUEUED_MS = 1200;
const STEP_MS = 1100;
const BUCKETS = 20;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const MOCK_COMMIT_SUBJECT = "site(att_k7m2qx4n3w5p): bold-contrast, schedule-first";

function error(status: number, code: string, message: string): TransportResponse {
  return { status, json: { error: { code, message } } };
}

function newAttendeeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `att_${Array.from(bytes, (byte) => ID_ALPHABET[byte % 32]).join("")}`;
}

function scale(items: KeyCount[], factor: number): KeyCount[] {
  return items.map((item) => ({ ...item, count: Math.round(item.count * factor) }));
}

interface StoredSurvey {
  answers: SurveyAnswers;
  createdAt: number;
}

/** Pivot routes served from contracts/pivot/examples.v1.json. Mock tokens only; nothing leaves the browser. */
export class PivotMock {
  private surveys = new Map<string, StoredSurvey>();
  private opened = new Map<string, number>();
  private rateLimitNext = false;

  constructor(private now: () => number = () => Date.now(), private organizerToken = "mock-organizer") {}

  /** Rehearsal control: the next survey submit answers 429. */
  rateLimitNextSurvey(): void {
    this.rateLimitNext = true;
  }

  handle(request: TransportRequest): TransportResponse {
    const [path = "", query = ""] = request.path.split("?");
    if (request.method === "POST" && path === "/attendee/surveys") return this.createSurvey(request.body);
    const interaction = /^\/attendee\/([^/]+)\/interactions$/.exec(path);
    if (request.method === "POST" && interaction) return this.recordInteraction(interaction[1] ?? "", request.body);
    const attendee = /^\/attendee\/([^/]+)$/.exec(path);
    if (request.method === "GET" && attendee) return this.readAttendee(attendee[1] ?? "");
    if (request.method === "GET" && path === "/pivot/trends") {
      if (request.headers.Authorization !== `Bearer ${this.organizerToken}`) {
        return error(403, "forbidden", "Trends are for organizers.");
      }
      return { status: 200, json: this.trends(new URLSearchParams(query)) };
    }
    return error(404, "not_found", "No such pivot route in the mock.");
  }

  private createSurvey(body: unknown): TransportResponse {
    if (this.rateLimitNext) {
      this.rateLimitNext = false;
      return { status: 429, json: HTTP["POST /api/v1/attendee/surveys"].response_429 };
    }
    const answers = (body as { answers?: SurveyAnswers } | undefined)?.answers;
    if (!answers || answers.interests.length < 1 || answers.interests.length > 3) {
      return { status: 422, json: HTTP["POST /api/v1/attendee/surveys"].response_422 };
    }
    const attendeeId = newAttendeeId();
    this.surveys.set(attendeeId, { answers, createdAt: this.now() });
    return { status: 201, json: { attendee_id: attendeeId, site: { status: "queued" }, recommendations: RECOMMENDATIONS } };
  }

  private readAttendee(attendeeId: string): TransportResponse {
    const survey = this.surveys.get(attendeeId);
    if (!ATTENDEE_ID.test(attendeeId) || !survey) {
      return { status: 404, json: HTTP["GET /api/v1/attendee/{attendee_id}"].response_404 };
    }
    const elapsed = this.now() - survey.createdAt - QUEUED_MS;
    const steps = READY.progress as ProgressStep[];
    const shown = elapsed < 0 ? 0 : Math.min(steps.length, 1 + Math.floor(elapsed / STEP_MS));
    const done = shown === steps.length;
    const site: Site = done
      ? (READY.site as Site)
      : { status: shown === 0 ? "queued" : "building", run_id: shown === 0 ? null : READY.site.run_id, html: null, commit_sha: null, commit_url: null, html_sha256: null };
    const { goal: _goal, ...answers } = survey.answers;
    const view: AttendeeView = { attendee_id: attendeeId, answers, recommendations: RECOMMENDATIONS, site, progress: steps.slice(0, shown) };
    return { status: 200, json: view };
  }

  private recordInteraction(attendeeId: string, body: unknown): TransportResponse {
    if (!this.surveys.has(attendeeId)) return error(404, "not_found", "We could not find that site.");
    const { session_id: sessionId, action } = (body ?? {}) as { session_id?: string; action?: string };
    if (!sessionId || !["open", "save", "dismiss"].includes(action ?? "")) {
      return error(422, "invalid_payload", "Send a session and one of open, save or dismiss.");
    }
    if (action === "open") this.opened.set(sessionId, (this.opened.get(sessionId) ?? 0) + 1);
    return { status: 202, json: { accepted: true } };
  }

  private series(keys: readonly string[], tick: number, only: string | null, factor: number): TimeSeries {
    const start = Math.floor(this.now() / 60000) * 60000 - (BUCKETS - 1) * 60000;
    const buckets = Array.from({ length: BUCKETS }, (_, index) => new Date(start + index * 60000).toISOString());
    const series = keys
      .filter((key) => !only || key === only)
      .map((key, k) => ({
        key,
        counts: buckets.map((_, index) => {
          const wave = Math.sin((index + tick) / (2.5 + k * 0.4) + k * 1.7);
          return Math.max(0, Math.round((2 + (keys.length - k) * 0.7 + wave * 2.5 + index * 0.15) * factor));
        }),
      }));
    return { buckets, series };
  }

  private trends(params: URLSearchParams): Trends {
    const interest = params.get("interest");
    const source = params.get("source");
    const tick = Math.floor(this.now() / 5000);
    const mine = this.surveys.size;
    const realShare = (TRENDS.totals.surveys - TRENDS.totals.simulated) / TRENDS.totals.surveys;
    const factor = (source === "qr" ? realShare : 1) * (interest ? 0.4 : 1);
    return {
      ...TRENDS,
      generated_at: new Date(this.now()).toISOString(),
      filters: { interest, source },
      totals: {
        ...TRENDS.totals,
        surveys: Math.round(TRENDS.totals.surveys * factor) + mine,
        simulated: source === "qr" ? 0 : Math.round(TRENDS.totals.simulated * (interest ? 0.4 : 1)),
        sites_ready: Math.round(TRENDS.totals.sites_ready * factor) + mine,
        interactions: Math.round(TRENDS.totals.interactions * factor),
      },
      interests_over_time: this.series(INTERESTS, tick, interest, factor),
      roles: scale(TRENDS.roles, factor),
      levels: scale(TRENDS.levels, factor),
      vibes: scale(TRENDS.vibes, factor),
      sessions: TRENDS.sessions.map((session) => ({
        ...session,
        recommended: Math.round(session.recommended * factor) + mine,
        opened: Math.round(session.opened * factor) + (this.opened.get(session.session_id) ?? 0),
      })),
      agent: {
        ...TRENDS.agent,
        builds_over_time: this.series(["ok", "fallback", "error"], tick, null, factor),
        decisions: { ...TRENDS.agent.decisions, theme: scale(TRENDS.agent.decisions.theme, factor), layout: scale(TRENDS.agent.decisions.layout, factor) },
      },
    };
  }
}

export function createPivotMockTransport(mock: PivotMock, latencyMs = 0): Transport {
  return async (request) => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (request.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return mock.handle({ ...request, body: request.body === undefined ? undefined : JSON.parse(JSON.stringify(request.body)) });
  };
}
