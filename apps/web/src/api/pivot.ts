import type { Transport } from "./transport";

/** Pivot contract v1. Shapes mirror contracts/pivot/examples.v1.json. */
export const ROLES = ["attendee", "speaker", "staff", "organizer"] as const;
export const INTERESTS = [
  "observability",
  "platform-engineering",
  "ai-agents",
  "security",
  "networking",
  "storage-data",
  "gitops-delivery",
  "finops-sustainability",
  "wasm-edge",
  "community-careers",
] as const;
export const LEVELS = ["new", "practitioner", "expert"] as const;
export const VIBES = ["calm", "bold", "playful"] as const;
export const ACCESSIBILITY = [
  "large_text",
  "reduced_motion",
  "high_contrast",
] as const;

export type Role = (typeof ROLES)[number];
export type Interest = (typeof INTERESTS)[number];
export type Level = (typeof LEVELS)[number];
export type Vibe = (typeof VIBES)[number];
export type AccessibilityNeed = (typeof ACCESSIBILITY)[number];
export type SurveySource = "qr" | "simulator";
export type SiteStatus = "queued" | "building" | "ready" | "failed";
export type Builder = "template" | "openai";
export type CommitMode = "dry-run" | "github";
export type ReasonCode = "interest" | "goal" | "level" | "trending" | "semantic";
export type InteractionAction = "open" | "save" | "dismiss";
export type LedgerKind = "decision" | "action" | "commit" | "log" | "error";
export type LedgerStep =
  | "claim"
  | "retrieve"
  | "plan"
  | "write"
  | "validate"
  | "commit"
  | "publish";
export type LedgerOutcome = "ok" | "fallback" | "retry" | "rejected" | "error";
export type LedgerTool =
  | "elasticsearch"
  | "openai"
  | "template"
  | "validator"
  | "github";

export interface SurveyAnswers {
  role: Role;
  interests: Interest[];
  level: Level;
  /** Optional free text, at most 140 characters. Never returned by public routes. */
  goal?: string;
  vibe: Vibe;
  accessibility: AccessibilityNeed[];
}

export interface SurveyRequest {
  source: SurveySource;
  answers: SurveyAnswers;
}

export interface RecommendationReason {
  code: ReasonCode;
  label: string;
}

export interface Recommendation {
  session_id: string;
  title: string;
  abstract: string;
  track: string;
  tags: string[];
  level: string;
  format: string;
  room: string;
  starts_at: string;
  ends_at: string;
  synthetic: boolean;
  score: number;
  reasons: RecommendationReason[];
}

export interface SiteSpec {
  version: number;
  headline: string;
  tone: string;
  theme: {
    name: string;
    background: string;
    text: string;
    accent: string;
    text_scale: number;
    motion: string;
  };
  layout: string;
  sections: string[];
  featured: { session_id: string; reason: string }[];
}

export interface SiteState {
  status: SiteStatus;
  run_id?: string | null;
  attempt?: number;
  builder?: Builder | null;
  commit_mode?: CommitMode | null;
  commit_sha?: string | null;
  commit_url?: string | null;
  html_sha256?: string | null;
  html?: string | null;
  spec?: SiteSpec | null;
  updated_at?: string;
}

export interface ProgressStep {
  seq: number;
  step: LedgerStep;
  title: string;
  at: string;
}

export interface SurveyCreated {
  attendee_id: string;
  site: SiteState;
  recommendations: Recommendation[];
}

export interface AttendeeView {
  attendee_id: string;
  answers: Omit<SurveyAnswers, "goal">;
  recommendations: Recommendation[];
  site: SiteState;
  progress: ProgressStep[];
}

export interface InteractionRequest {
  session_id: string;
  action: InteractionAction;
  position: number;
}

export interface InteractionAccepted {
  accepted: boolean;
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface SeriesGroup {
  buckets: string[];
  series: { key: string; counts: number[] }[];
}

export interface TrendsParams {
  window?: string | null;
  interval?: string | null;
  interest?: string | null;
  source?: string | null;
}

export interface TrendsResponse {
  window: string;
  interval: string;
  generated_at: string;
  filters: { interest: string | null; source: string | null };
  totals: {
    surveys: number;
    simulated: number;
    sites_ready: number;
    sites_failed: number;
    interactions: number;
    open_rate: number;
  };
  interests_over_time: SeriesGroup;
  roles: KeyCount[];
  levels: KeyCount[];
  vibes: KeyCount[];
  sessions: {
    session_id: string;
    title: string;
    recommended: number;
    opened: number;
    saved: number;
    dismissed: number;
  }[];
  agent: {
    builds_over_time: SeriesGroup;
    latency_ms: { p50: number; p95: number };
    decisions: {
      theme: KeyCount[];
      layout: KeyCount[];
      tone: KeyCount[];
    };
    builders: KeyCount[];
    commit_modes: KeyCount[];
  };
}

export interface TrailDecision {
  name: string;
  value: string;
  alternatives?: string[];
  rationale?: string;
}

export interface TrailCommit {
  mode: CommitMode;
  sha: string;
  url?: string | null;
  branch?: string;
  path?: string;
  message?: string;
  additions?: number;
}

export interface TrailItem {
  event_id: string;
  run_id: string;
  attendee_id: string;
  seq: number;
  at: string;
  kind: LedgerKind;
  step: LedgerStep;
  title: string;
  detail?: string | null;
  highlight?: Record<string, string[]> | null;
  decision?: TrailDecision | null;
  tool?: LedgerTool | null;
  model?: string | null;
  tokens?: { input: number; output: number } | null;
  duration_ms?: number | null;
  outcome?: LedgerOutcome | null;
  builder?: Builder | null;
  source?: SurveySource | null;
  commit?: TrailCommit | null;
  trace_id?: string | null;
  span_id?: string | null;
  trace_url?: string | null;
}

export interface TrailSearchParams {
  q?: string | null;
  kind?: string | null;
  step?: string | null;
  tool?: string | null;
  outcome?: string | null;
  attendee_id?: string | null;
  run_id?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
}

export interface TrailFacets {
  kind: KeyCount[];
  step: KeyCount[];
  tool: KeyCount[];
  outcome: KeyCount[];
}

export interface TrailSearchResponse {
  total: number;
  limit: number;
  items: TrailItem[];
  facets: TrailFacets;
}

export interface TrailRunResponse {
  run_id: string;
  attendee_id: string;
  survey: (Omit<SurveyAnswers, "goal"> & {
    source: SurveySource;
    created_at: string;
  }) | null;
  site: Pick<
    SiteState,
    | "status"
    | "builder"
    | "commit_mode"
    | "commit_sha"
    | "commit_url"
    | "html_sha256"
  > | null;
  trace_id: string | null;
  trace_url: string | null;
  events: TrailItem[];
}

export class PivotApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PivotApiError";
    this.status = status;
    this.code = code;
  }
}

function toError(status: number, json: unknown): PivotApiError {
  const error =
    json && typeof json === "object"
      ? (json as { error?: unknown }).error
      : null;
  const fields =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code =
    typeof fields.code === "string" && fields.code
      ? fields.code
      : status === 0
        ? "network_error"
        : `http_${status}`;
  const message =
    typeof fields.message === "string" && fields.message
      ? fields.message
      : `Request failed with status ${status}.`;
  return new PivotApiError(status, code, message);
}

function query(params: object): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function createPivotClient({
  transport,
  getToken,
}: {
  transport: Transport;
  getToken?: () => string;
}) {
  async function call<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; signal?: AbortSignal; organizer?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.organizer) {
      const token = getToken?.() ?? "";
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    let response;
    try {
      response = await transport({
        method,
        path,
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError")
        throw cause;
      throw new PivotApiError(
        0,
        "network_error",
        cause instanceof Error ? cause.message : "Network request failed.",
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw toError(response.status, response.json);
    return response.json as T;
  }

  return {
    /** Public. */
    submitSurvey(body: SurveyRequest) {
      return call<SurveyCreated>("POST", "/attendee/surveys", { body });
    },
    /** Public; the attendee id is the capability. */
    getAttendee(attendeeId: string, signal?: AbortSignal) {
      return call<AttendeeView>(
        "GET",
        `/attendee/${encodeURIComponent(attendeeId)}`,
        { signal },
      );
    },
    /** Public. */
    recordInteraction(attendeeId: string, body: InteractionRequest) {
      return call<InteractionAccepted>(
        "POST",
        `/attendee/${encodeURIComponent(attendeeId)}/interactions`,
        { body },
      );
    },
    /** Organizer bearer. */
    getTrends(params: TrendsParams = {}) {
      const { window, interval, interest, source } = params;
      return call<TrendsResponse>(
        "GET",
        `/pivot/trends${query({ window, interval, interest, source })}`,
        { organizer: true },
      );
    },
    /** Organizer bearer. */
    searchTrail(params: TrailSearchParams = {}) {
      const { q, kind, step, tool, outcome, attendee_id, run_id, from, to, limit } =
        params;
      return call<TrailSearchResponse>(
        "GET",
        `/pivot/trail/search${query({ q, kind, step, tool, outcome, attendee_id, run_id, from, to, limit })}`,
        { organizer: true },
      );
    },
    /** Organizer bearer. */
    getTrailRun(runId: string) {
      return call<TrailRunResponse>(
        "GET",
        `/pivot/trail/runs/${encodeURIComponent(runId)}`,
        { organizer: true },
      );
    },
  };
}

export type PivotClient = ReturnType<typeof createPivotClient>;
