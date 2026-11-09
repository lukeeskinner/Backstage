import type { BackgroundScenario } from "../mock/store";
import type { Route } from "../ui/types";

export interface TourContext {
  raise(): void;
  raiseBackground(scenario: BackgroundScenario): void;
  wave(): void;
}

export interface TourStep {
  id: string;
  title: string;
  body: string;
  route: Route;
  identity: "organizer" | "venue-staff" | "attendee";
  /** Element to spotlight and scroll to. */
  target?: string;
  /** Incident to open on the board before anything else happens. */
  select?: string;
  /** Button to press once it appears, after the viewer has seen it. */
  click?: string;
  /** Text typed into an input, then its form is submitted. */
  type?: { selector: string; text: string };
  /** The hold timer starts only after this returns true (or after the wait limit). */
  ready?: () => boolean;
  enter?: (ctx: TourContext) => void;
  holdMs: number;
}

const OVERFLOW = "inc-overflow-room-b";
const MIC = "inc-stage_av-room-b";
const BADGES = "inc-badge_stall-room-c";

function textIn(selector: string, text: string): () => boolean {
  return () => Array.from(document.querySelectorAll(selector)).some((node) => node.textContent?.includes(text));
}

export const TOUR: TourStep[] = [
  {
    id: "intro",
    title: "BACKSTAGE runs the conference floor",
    body: "Cameras, stage mics and badge printers report problems. AI agents work out what is wrong and who should fix it. People approve, and nothing closes until the fix is verified. This is a simulated run, so nothing here touches a real venue.",
    route: "board",
    identity: "organizer",
    target: ".shell__header",
    holdMs: 9000,
  },
  {
    id: "video",
    title: "Cameras watch the floor",
    body: "This is conference footage running through a YOLO person detector. The boxes are real model output, recorded at four samples a second and synced to playback.",
    route: "demo",
    identity: "organizer",
    target: ".video-demo__picture",
    click: ".video-demo__transport .btn--primary",
    holdMs: 9000,
  },
  {
    id: "counts",
    title: "Counts, never faces",
    body: "Only people counts per zone leave the camera. No frames, faces or identities are stored. At a live event, a door-zone count that stays over the threshold is what raises an incident.",
    route: "demo",
    identity: "organizer",
    target: ".video-demo__readout",
    holdMs: 9000,
  },
  {
    id: "raise",
    title: "The Venue agent raises an incident",
    body: "Room B's door zone has stayed over capacity. The Venue agent raises an incident, and it lands on the shared queue for every organizer at once.",
    route: "board",
    identity: "organizer",
    enter: (ctx) => ctx.raise(),
    target: ".console__cards",
    ready: () => Boolean(document.querySelector(".console__cards .card")),
    holdMs: 8000,
  },
  {
    id: "scene",
    title: "See the problem, live",
    body: "Each incident gets a live picture of what is happening. Here the seats are full and people are piling up at the door. The picture changes as the incident moves along.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail > .ivis",
    holdMs: 8000,
  },
  {
    id: "plan",
    title: "An agent proposes the fix",
    body: "The Incident Commander agent triaged the signal and proposed a plan: send venue staff and hold entry until the queue clears. Agents can propose, but they cannot act alone.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail__grid > .panel:first-child",
    holdMs: 9000,
  },
  {
    id: "protocol",
    title: "One protocol for every incident",
    body: "Every incident moves through Detect, Plan, Dispatch and Verify. The bar shows where this one is, who it is assigned to and whether it has been verified.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail__grid > .panel:nth-child(2)",
    holdMs: 8000,
  },
  {
    id: "mic",
    title: "Meanwhile, a stage mic drops",
    body: "A second signal arrives: Stage B's microphone input is lost. The AV agent raises its own incident, and the picture shows the dead input. Several problems can run at once, each with its own owner.",
    route: "board",
    identity: "organizer",
    enter: (ctx) => ctx.raiseBackground("stage_av"),
    select: MIC,
    target: ".detail > .ivis",
    ready: () => document.querySelectorAll(".console__cards .card").length > 1,
    holdMs: 8000,
  },
  {
    id: "tiers",
    title: "Permissions follow the role",
    body: "Switch to Venue staff (tier 2). They can see the incident but cannot approve the plan. Only an organizer (tier 3) can do that.",
    route: "board",
    identity: "venue-staff",
    select: OVERFLOW,
    target: ".panel__actions",
    holdMs: 8000,
  },
  {
    id: "approve",
    title: "An organizer approves",
    body: "Back as the organizer, one tap approves the plan. Each action carries the version it was based on and a one-time key, so a stale screen or a double tap cannot fire twice.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".panel__actions",
    click: ".panel__actions .btn--primary",
    holdMs: 6000,
  },
  {
    id: "dispatch",
    title: "The Venue agent dispatches staff",
    body: "With approval in hand, the Venue agent picks the nearest venue staff member and dispatches them. In the picture, staff are now walking to the door.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail > .ivis",
    ready: textIn(".detail__head .chip", "Dispatched"),
    holdMs: 7000,
  },
  {
    id: "inbox",
    title: "Staff get it in their inbox",
    body: "This is the venue staff member's phone. Their inbox says what happened, why they were picked and what to do. One tap accepts.",
    route: "me",
    identity: "venue-staff",
    target: '.inbox__card[data-kind="needs_you"]',
    holdMs: 7000,
  },
  {
    id: "accept",
    title: "Accepted",
    body: "The assignment is accepted and recorded. From here BACKSTAGE watches the floor itself.",
    route: "me",
    identity: "venue-staff",
    target: '.inbox__card[data-kind="needs_you"]',
    click: '.inbox__card[data-kind="needs_you"] .btn--primary',
    holdMs: 4000,
  },
  {
    id: "verify",
    title: "Verify before closing",
    body: "The door-zone count has to stay under the threshold for 60 seconds before the incident can close. No one gets to declare it fixed. The evidence has to show it.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail > .ivis",
    ready: () => textIn(".detail__head .chip", "Verifying")() || textIn(".detail__head .chip", "Resolved")(),
    holdMs: 6000,
  },
  {
    id: "resolved",
    title: "Verified and closed",
    body: "The count stayed down for the full window, so the incident closed itself. The mic incident is moving through the same steps on its own track.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".detail__head",
    ready: textIn(".detail__head .chip", "Resolved"),
    holdMs: 7000,
  },
  {
    id: "evidence",
    title: "Every step is on the record",
    body: "Each change is a committed event: who or what acted, the state it moved from and to, and the signals behind it. This is the audit trail.",
    route: "board",
    identity: "organizer",
    select: OVERFLOW,
    target: ".evidence__sequence",
    holdMs: 8000,
  },
  {
    id: "search",
    title: "Find anything fast",
    body: "The command bar jumps to any incident by room, type or ID.",
    route: "board",
    identity: "organizer",
    target: ".command",
    type: { selector: ".command__input", text: "stage" },
    holdMs: 6000,
  },
  {
    id: "badges",
    title: "Check-in has a problem too",
    body: "A badge printer at check-in stalls and the queue grows. The IT agent takes it and reroutes the print jobs to a working station.",
    route: "board",
    identity: "organizer",
    enter: (ctx) => ctx.raiseBackground("badge_stall"),
    select: BADGES,
    target: ".detail > .ivis",
    ready: () => document.querySelectorAll(".console__cards .card").length > 2,
    holdMs: 8000,
  },
  {
    id: "history",
    title: "History",
    body: "Every incident stays searchable after the event, with its full timeline.",
    route: "history",
    identity: "organizer",
    target: ".history",
    holdMs: 6000,
  },
  {
    id: "attendee",
    title: "What attendees see",
    body: "Attendees get a cleaned-up view: which rooms are affected or recovering, and nothing internal. Affected rooms pulse until they recover.",
    route: "status",
    identity: "attendee",
    target: ".status__grid",
    holdMs: 8000,
  },
  {
    id: "checkin",
    title: "Anonymous check-in",
    body: "People check in by scanning a QR code. BACKSTAGE counts by role and never stores names. Here a wave of attendees arrives.",
    route: "status",
    identity: "attendee",
    enter: (ctx) => ctx.wave(),
    target: ".presence",
    holdMs: 8000,
  },
  {
    id: "projector",
    title: "On the big screen",
    body: "The projector view runs on screens around the hall, with the check-in QR code. The stage page streams mic health and live captions into the same flow.",
    route: "projector",
    identity: "attendee",
    target: ".status__hero",
    holdMs: 9000,
  },
  {
    id: "outro",
    title: "That's BACKSTAGE",
    body: "Agents detect and plan, people approve, and the system verifies before anything closes. One queue for the whole floor.",
    route: "board",
    identity: "organizer",
    target: ".console__list",
    holdMs: 8000,
  },
];
