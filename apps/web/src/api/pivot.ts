import type { Transport } from "./transport";

export const INTERESTS = ["observability", "platform-engineering", "ai-agents", "security", "networking", "storage-data", "gitops-delivery", "finops-sustainability", "wasm-edge", "community-careers"] as const;
export type Interest = typeof INTERESTS[number];
export type Source = "qr" | "simulator";
export type Level = "new" | "practitioner" | "expert";
export type Role = "attendee" | "speaker" | "staff" | "organizer";
export type Vibe = "calm" | "bold" | "playful";
export type Accessibility = "large_text" | "reduced_motion" | "high_contrast";
export interface Answers { role: Role; interests: Interest[]; level: Level; vibe: Vibe; accessibility: Accessibility[]; goal?: string }
export type PublicAnswers = Omit<Answers, "goal">;
export interface SurveyRequest { source: Source; answers: Answers }
export interface Session { session_id: string; title: string; abstract: string; track: string; tags: string[]; level: Level; format: string; room: string; starts_at: string; ends_at: string; synthetic: boolean }
export type ReasonCode = "interest" | "goal" | "level" | "trending" | "semantic";
export interface Recommendation extends Session { score: number; reasons: { code: ReasonCode; label: string }[] }
export interface Site { status: "queued" | "building" | "ready" | "failed"; run_id?: string | null; attempt?: number; builder?: "template" | "openai" | null; commit_mode?: "dry-run" | "github" | null; commit_sha?: string | null; commit_url?: string | null; html_sha256?: string | null; html?: string | null; spec?: Record<string, unknown> | null; updated_at?: string; error?: string | null }
export interface SurveyReceipt { attendee_id: string; site: Site; recommendations: Recommendation[] }
export interface Attendee extends SurveyReceipt { created_at: string; source: Source; answers: PublicAnswers; progress: { seq: number; step: string; title: string; at: string }[] }
export interface InteractionRequest { session_id: string; action: "open" | "save" | "dismiss"; position: number }
export interface Count { key: string; count: number }
export interface Series { buckets: string[]; series: { key: string; counts: number[] }[] }
export interface TrendsQuery { window?: "15m" | "30m" | "60m" | "6h" | "24h"; interval?: "1m" | "5m" | "15m" | "1h"; interest?: Interest | ""; source?: Source | "" }
export interface Trends { window: string; interval: string; generated_at: string; filters: { interest: Interest | null; source: Source | null }; totals: { surveys: number; simulated: number; sites_ready: number; sites_failed: number; interactions: number; open_rate: number }; interests_over_time: Series; roles: Count[]; levels: Count[]; vibes: Count[]; sessions: { session_id: string; title: string; recommended: number; opened: number; saved: number; dismissed: number }[]; agent: { builds_over_time: Series; latency_ms: { p50: number | null; p95: number | null }; decisions: Record<string, Count[]>; builders: Count[]; commit_modes: Count[] } }
export type LedgerKind = "decision" | "action" | "commit" | "log" | "error";
export type LedgerStep = "claim" | "retrieve" | "plan" | "write" | "validate" | "commit" | "publish";
export type LedgerTool = "elasticsearch" | "openai" | "template" | "validator" | "github";
export type Outcome = "ok" | "fallback" | "retry" | "rejected" | "error";
export interface LedgerEvent { event_id: string; run_id: string; attendee_id: string; seq: number; at: string; kind: LedgerKind; step: LedgerStep; title: string; detail: string; tool: LedgerTool; outcome: Outcome; builder: "openai" | "template"; source: Source; duration_ms?: number; run_duration_ms?: number; model?: string; tokens?: { input: number; output: number }; decision?: { name: "theme" | "layout" | "tone" | "featured"; value: string; alternatives?: string[]; rationale: string } | null; commit?: { mode: "dry-run" | "github"; sha?: string; url?: string | null; branch?: string; path?: string; message?: string; additions?: number } | null; trace_id: string | null; span_id?: string; trace_url: string | null; highlight?: Record<string, string[]> }
export interface TrailQuery { q?: string; kind?: LedgerKind | ""; step?: LedgerStep | ""; tool?: LedgerTool | ""; outcome?: Outcome | ""; attendee_id?: string; run_id?: string; from?: string; to?: string; limit?: number }
export interface TrailSearch { total: number; limit: number; items: LedgerEvent[]; facets: Record<"kind" | "step" | "tool" | "outcome", Count[]> }
export interface TrailRun { run_id: string; attendee_id: string | null; survey: (PublicAnswers & { source: Source; created_at: string }) | null; site: Site | null; trace_id: string | null; trace_url: string | null; events: LedgerEvent[] }
export type PivotResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string };
export interface PivotClient { submitSurvey(body: SurveyRequest, signal?: AbortSignal): Promise<PivotResult<SurveyReceipt>>; getAttendee(id: string, signal?: AbortSignal): Promise<PivotResult<Attendee>>; recordInteraction(id: string, body: InteractionRequest, signal?: AbortSignal): Promise<PivotResult<{ accepted: true }>>; getTrends(query?: TrendsQuery, signal?: AbortSignal): Promise<PivotResult<Trends>>; searchTrail(query?: TrailQuery, signal?: AbortSignal): Promise<PivotResult<TrailSearch>>; getTrailRun(id: string, signal?: AbortSignal): Promise<PivotResult<TrailRun>> }
export function createPivotClient({ transport, getToken = () => "" }: { transport: Transport; getToken?: () => string }): PivotClient {
  async function request<T>(method: "GET" | "POST", path: string, body: unknown, organizer: boolean, signal?: AbortSignal): Promise<PivotResult<T>> {
    try {
      const response = await transport({ method, path: "/api/v1" + path, body, headers: organizer ? { Authorization: `Bearer ${getToken()}` } : {}, signal });
      if (response.status >= 200 && response.status < 300) return { ok: true, data: response.json as T };
      const error = (response.json as { error?: { code?: string; message?: string } })?.error;
      return { ok: false, status: response.status, code: error?.code ?? "unavailable", message: error?.message ?? "Request unavailable. Try again." };
    } catch (error) { if (signal?.aborted) throw error; return { ok: false, status: 0, code: "network", message: "Could not connect. Try again." }; }
  }
  const query = (values: object) => { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== "") params.set(key, String(value)); }); return params.size ? "?" + params.toString() : ""; };
  return {
    submitSurvey: (body, signal) => request("POST", "/attendee/surveys", body, false, signal),
    getAttendee: (id, signal) => request("GET", `/attendee/${encodeURIComponent(id)}`, undefined, false, signal),
    recordInteraction: (id, body, signal) => request("POST", `/attendee/${encodeURIComponent(id)}/interactions`, body, false, signal),
    getTrends: (values = {}, signal) => request("GET", "/pivot/trends" + query(values), undefined, true, signal),
    searchTrail: (values = {}, signal) => request("GET", "/pivot/trail/search" + query(values), undefined, true, signal),
    getTrailRun: (id, signal) => request("GET", `/pivot/trail/runs/${encodeURIComponent(id)}`, undefined, true, signal),
  };
}
