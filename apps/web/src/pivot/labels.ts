import type { PresenceTier } from "../api/types";
import type { Accessibility, Interest, Level, Vibe } from "./types";

export const ROLE_LABEL: Record<PresenceTier, string> = {
  attendee: "Attendee",
  speaker: "Speaker",
  staff: "Staff",
  organizer: "Organizer",
};

export const INTEREST_LABEL: Record<Interest, string> = {
  observability: "Observability",
  "platform-engineering": "Platform engineering",
  "ai-agents": "AI agents",
  security: "Security",
  networking: "Networking",
  "storage-data": "Storage and data",
  "gitops-delivery": "GitOps and delivery",
  "finops-sustainability": "FinOps and sustainability",
  "wasm-edge": "Wasm and edge",
  "community-careers": "Community and careers",
};

export const LEVEL_LABEL: Record<Level, string> = { new: "New to this", practitioner: "Practitioner", expert: "Expert" };

export const VIBE_LABEL: Record<Vibe, string> = { calm: "Calm", bold: "Bold", playful: "Playful" };

export const ACCESSIBILITY_LABEL: Record<Accessibility, string> = {
  large_text: "Larger text",
  reduced_motion: "Reduced motion",
  high_contrast: "High contrast",
};

const ALL: Record<string, string> = { ...ROLE_LABEL, ...INTEREST_LABEL, ...LEVEL_LABEL, ...VIBE_LABEL };

/** Label for any contract key. Unknown keys read as words: "schedule-first" becomes "Schedule first". */
export function keyLabel(key: string): string {
  const known = ALL[key];
  if (known) return known;
  const words = key.replace(/[-_]/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
