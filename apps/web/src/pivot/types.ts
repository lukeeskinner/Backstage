import type { PresenceTier } from "../api/types";

/** Pivot contract v1 (contracts/pivot/README.md). Swap for src/api/pivot.ts once Anurup's typed client lands. */

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
export type Interest = (typeof INTERESTS)[number];

export const LEVELS = ["new", "practitioner", "expert"] as const;
export type Level = (typeof LEVELS)[number];

export const VIBES = ["calm", "bold", "playful"] as const;
export type Vibe = (typeof VIBES)[number];

export const ACCESSIBILITY = ["large_text", "reduced_motion", "high_contrast"] as const;
export type Accessibility = (typeof ACCESSIBILITY)[number];

export type SiteStatus = "queued" | "building" | "ready" | "failed";
export type InteractionAction = "open" | "save" | "dismiss";

export interface SurveyAnswers {
  role: PresenceTier;
  interests: Interest[];
  level: Level;
  vibe: Vibe;
  accessibility: Accessibility[];
  goal?: string;
}

export interface Recommendation {
  session_id: string;
  title: string;
  abstract?: string;
  track?: string;
  room?: string;
  starts_at?: string;
  ends_at?: string;
  reasons?: { code: string; label: string }[];
}

export interface Site {
  status: SiteStatus;
  run_id?: string | null;
  builder?: "template" | "openai" | null;
  commit_mode?: "dry-run" | "github" | null;
  commit_sha?: string | null;
  commit_url?: string | null;
  html_sha256?: string | null;
  html?: string | null;
}

export interface ProgressStep {
  seq: number;
  step: string;
  title: string;
  at: string;
}

export interface SurveyCreated {
  attendee_id: string;
  site: Site;
  recommendations: Recommendation[];
}

export interface AttendeeView {
  attendee_id: string;
  answers?: Omit<SurveyAnswers, "goal">;
  recommendations: Recommendation[];
  site: Site;
  progress: ProgressStep[];
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface TimeSeries {
  buckets: string[];
  series: { key: string; counts: number[] }[];
}

export interface SessionTrend {
  session_id: string;
  title: string;
  recommended: number;
  opened: number;
  saved: number;
  dismissed: number;
}

export interface Trends {
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
  interests_over_time: TimeSeries;
  roles: KeyCount[];
  levels: KeyCount[];
  vibes: KeyCount[];
  sessions: SessionTrend[];
  agent: {
    builds_over_time: TimeSeries;
    latency_ms: { p50: number | null; p95: number | null };
    decisions: { theme: KeyCount[]; layout: KeyCount[]; tone?: KeyCount[] };
    builders?: KeyCount[];
    commit_modes?: KeyCount[];
  };
}

export type PivotResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export const ATTENDEE_ID = /^att_[a-z2-7]{12}$/;
