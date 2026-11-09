import examples from "@fixtures/http.examples.json";
import overflowSignalsRaw from "@fixtures/overflow.signals.jsonl?raw";
import type {
  Action,
  AllowedAction,
  Assignment,
  EventType,
  EventsPage,
  Incident,
  IncidentState,
  IncidentsPage,
  ProtocolEvent,
  PublicStatus,
} from "../api/types";

export interface Principal {
  id: string;
  tier: 0 | 1 | 2 | 3;
}

export interface MockRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface MockResponse {
  status: number;
  json: unknown;
}

interface FixtureExample {
  scenario: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
  request?: unknown;
}

interface Signal {
  signal_id: string;
  occurred_at: string;
  data: { zone: string; count: number; threshold: number };
}

export interface MockOptions {
  principals: Record<string, Principal>;
  now?: () => Date;
  dispatchDelayMs?: number;
  /** Real milliseconds between clearing-replay samples. */
  tickMs?: number;
  /** Guided demo: the overflow incident stays off the board until raise() is called. */
  startHidden?: boolean;
  /** Real milliseconds between the automatic steps of a background incident. */
  backgroundStepMs?: number;
}

/** Incident types the guided demo can raise beside the overflow incident. They progress without user actions. */
export type BackgroundScenario = "stage_av" | "badge_stall";

interface SimulationTimer {
  remainingMs: number;
  dueAt: number;
  run: () => void;
  handle?: ReturnType<typeof setTimeout>;
}

interface IncidentRecord {
  incident: Incident;
  events: ProtocolEvent[];
}

const SCENARIO = "overflow";
const INCIDENT_ID = "inc-overflow-room-b";
const VERIFY_WINDOW_MS = 60_000;

const fixtures = examples as unknown as FixtureExample[];

function fixture(method: string, path: string, status = 200, scenario = SCENARIO): FixtureExample {
  const found = fixtures.find(
    (example) =>
      example.scenario === scenario && example.method === method && example.path === path && example.status === status,
  );
  if (!found) {
    throw new Error(`Missing shared fixture ${method} ${path} ${status}`);
  }
  return found;
}

function fixtureErrorMessage(status: number): string {
  const found = fixtures.find(
    (example) => example.scenario === SCENARIO && example.method === "POST" && example.status === status,
  );
  return (found?.response as { error: { message: string } }).error.message;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function errorResponse(status: number, code: string, message: string): MockResponse {
  return { status, json: { error: { code, message } } };
}

export class NetworkDropped extends TypeError {
  constructor() {
    super("Mock network drop after commit");
  }
}

export class MockIncidentApi {
  private readonly options: Required<Omit<MockOptions, "principals">> & Pick<MockOptions, "principals">;
  private incident!: Incident;
  private events!: ProtocolEvent[];
  private idempotency = new Map<string, { hash: string; response: MockResponse }>();
  private observed: Signal[] = [];
  private timers = new Set<SimulationTimer>();
  private paused = false;
  private dropNext = false;
  private hidden = false;
  private background = new Map<string, IncidentRecord>();
  private readonly clearingSignals: Signal[];

  constructor(options: MockOptions) {
    this.options = {
      now: () => new Date(),
      dispatchDelayMs: 1200,
      tickMs: 1500,
      startHidden: false,
      backgroundStepMs: 2500,
      ...options,
    };
    this.clearingSignals = overflowSignalsRaw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Signal)
      .filter((signal) => signal.data.zone === "door" && signal.data.count < signal.data.threshold);
    this.seed();
  }

  reset(): void {
    this.timers.forEach((timer) => clearTimeout(timer.handle));
    this.timers.clear();
    this.idempotency.clear();
    this.observed = [];
    this.dropNext = false;
    this.background.clear();
    this.seed();
  }

  /** Guided demo: the venue agent's signal crosses the threshold and the incident appears. */
  raise(): void {
    this.hidden = false;
    this.incident.updated_at = this.timestamp();
  }

  /**
   * Guided demo: raise a second incident that other operators handle. It walks approve, dispatch, accept,
   * verify and close on a timer so the board shows several incident types moving at once.
   */
  raiseBackground(scenario: BackgroundScenario): void {
    const id = `inc-${scenario}-room-${scenario === "stage_av" ? "b" : "c"}`;
    if (this.background.has(id)) return;
    const incident = clone(fixture("GET", `/api/v1/incidents/${id}`, 200, scenario).response as Incident);
    const events = clone((fixture("GET", `/api/v1/incidents/${id}/events`, 200, scenario).response as EventsPage).items);
    incident.updated_at = this.timestamp();
    const record: IncidentRecord = { incident, events };
    this.background.set(id, record);
    const accepted = (fixtures.filter(
      (example) => example.scenario === scenario && example.method === "POST" && example.status === 200,
    ).map((example) => example.response as Incident).find((item) => item.assignment)?.assignment) ?? null;
    const domain = scenario === "stage_av" ? "av" : "it";
    const step = this.options.backgroundStepMs;
    const human = (who: string, tier: 2 | 3) => ({ id: who, kind: "human" as const, tier });
    this.schedule(step, () => this.transition("approve", "approved", human("organizer-02", 3), { plan_id: incident.plan?.id }, record));
    this.schedule(step * 2, () => {
      record.incident.assignment = accepted ? clone(accepted) : { id: `assignment-${scenario}-1`, assignee_id: `${domain}-staff-01`, domain };
      this.transition("dispatch", "dispatched", { id: `${domain}-worker`, kind: "agent", tier: 2 }, { assignment_id: record.incident.assignment.id }, record);
    });
    this.schedule(step * 3, () => this.transition("ack", "accepted", human(record.incident.assignment?.assignee_id ?? `${domain}-staff-01`, 2), { decision: "accepted" }, record));
    this.schedule(step * 4, () => {
      record.incident.verification = { status: "pending", summary: scenario === "stage_av" ? "Microphone input is back. Watching for dropouts." : "Station B printed the rerouted badges. Watching the queue." };
      this.transition("verify", "verifying", { id: "incident-api", kind: "system", tier: null }, {}, record);
    });
    this.schedule(step * 6, () => {
      record.incident.verification = { status: "passed", summary: scenario === "stage_av" ? "Audio stayed up for the full window." : "The badge queue drained and stayed clear." };
      this.transition("close", "resolved", { id: "incident-api", kind: "system", tier: null }, {}, record);
    });
  }

  /** Rehearsal control: another operator changed the incident, so the next approve or ack is stale. */
  bumpVersion(): void {
    this.incident.version += 1;
    this.incident.updated_at = this.timestamp();
  }

  /** Rehearsal control: the next POST commits, then the response is lost. */
  dropNextResponse(): void {
    this.dropNext = true;
  }

  handle(request: MockRequest): MockResponse {
    const principal = this.authenticate(request.headers);
    if (!principal) {
      return errorResponse(401, "unauthorized", "A valid token is required.");
    }
    const path = request.path.split("?")[0] ?? request.path;

    if (request.method === "GET" && path === "/status") {
      return { status: 200, json: this.publicStatus() };
    }
    if (principal.tier < 1) {
      return errorResponse(403, "forbidden", "Incident access requires staff or organizer scope.");
    }
    if (request.method === "GET" && path === "/incidents") {
      const items = [...(this.hidden ? [] : [this.view(principal)]), ...[...this.background.values()].map((record) => this.backgroundView(record))];
      const page: IncidentsPage = { items, next_cursor: null };
      return { status: 200, json: page };
    }
    const match = /^\/incidents\/([^/]+)(\/events|\/actions)?$/.exec(path);
    const requestedId = decodeURIComponent(match?.[1] ?? "");
    const other = this.background.get(requestedId);
    if (match && other) {
      if (request.method === "GET" && !match[2]) return { status: 200, json: this.backgroundView(other) };
      if (request.method === "GET" && match[2] === "/events") return { status: 200, json: { items: clone(other.events), next_cursor: null } };
      return errorResponse(403, "forbidden", "Another operator is handling this incident in the simulation.");
    }
    if (!match || requestedId !== INCIDENT_ID || this.hidden) {
      return errorResponse(404, "not_found", "Incident not found.");
    }
    const suffix = match[2];
    if (request.method === "GET" && !suffix) {
      return { status: 200, json: this.view(principal) };
    }
    if (request.method === "GET" && suffix === "/events") {
      const page: EventsPage = { items: clone(this.events), next_cursor: null };
      return { status: 200, json: page };
    }
    if (request.method === "POST" && suffix === "/actions") {
      const response = this.applyAction(principal, request);
      if (this.dropNext) {
        this.dropNext = false;
        throw new NetworkDropped();
      }
      return response;
    }
    return errorResponse(404, "not_found", "Route not found.");
  }

  private seed(): void {
    this.hidden = this.options.startHidden;
    this.incident = clone(fixture("GET", `/api/v1/incidents/${INCIDENT_ID}`).response as Incident);
    this.events = clone((fixture("GET", `/api/v1/incidents/${INCIDENT_ID}/events`).response as EventsPage).items);
  }

  private authenticate(headers: Record<string, string>): Principal | null {
    const token = /^Bearer (.+)$/.exec(headers.Authorization ?? "")?.[1];
    return (token && this.options.principals[token]) || null;
  }

  private timestamp(): string {
    return this.options.now().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  private view(principal: Principal): Incident {
    const view = clone(this.incident);
    const isAssignee = view.assignment?.assignee_id === principal.id;
    const allowed: AllowedAction[] = [];
    if (principal.tier === 3 && view.state === "plan_proposed") {
      allowed.push("approve");
    }
    if (isAssignee && view.state === "dispatched") {
      allowed.push("ack");
    }
    if (isAssignee && (view.state === "dispatched" || view.state === "accepted")) {
      allowed.push("handoff");
    }
    view.allowed_actions = allowed;
    return view;
  }

  private backgroundView(record: IncidentRecord): Incident {
    return { ...clone(record.incident), allowed_actions: [] };
  }

  private publicStatus(): PublicStatus {
    const status = clone(fixture("GET", "/api/v1/status").response as PublicStatus);
    const live = [...(this.hidden ? [] : [this.incident]), ...[...this.background.values()].map((record) => record.incident)];
    const rank = { affected: 2, recovering: 1, normal: 0 } as const;
    const roomStatus = (state: IncidentState) => (state === "resolved" ? "normal" : state === "verifying" ? "recovering" : "affected");
    const badgeRoom = (fixture("GET", "/api/v1/status", 200, "badge_stall").response as PublicStatus).rooms;
    for (const room of badgeRoom) if (!status.rooms.some((known) => known.room_id === room.room_id)) status.rooms.push({ ...room });
    status.rooms = status.rooms.map((room) => {
      const worst = live.filter((incident) => incident.room_id === room.room_id).map((incident) => roomStatus(incident.state))
        .sort((a, b) => rank[b] - rank[a])[0];
      return { ...room, status: worst ?? "normal" };
    });
    return status;
  }

  private applyAction(principal: Principal, request: MockRequest): MockResponse {
    const key = request.headers["Idempotency-Key"];
    if (!key) {
      return errorResponse(422, "invalid_payload", "Idempotency-Key header is required.");
    }
    const hash = stableStringify({ path: request.path, body: request.body });
    const cached = this.idempotency.get(`${principal.id}:${key}`);
    if (cached) {
      return cached.hash === hash
        ? clone(cached.response)
        : errorResponse(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    const body = request.body as Action | undefined;
    if (!body || typeof body.expected_version !== "number" || !body.payload) {
      return errorResponse(422, "invalid_payload", "Action body does not match the contract.");
    }

    const outcome = this.executeAction(principal, body);
    if (outcome.status === 200) {
      this.idempotency.set(`${principal.id}:${key}`, { hash, response: clone(outcome) });
    }
    return outcome;
  }

  private executeAction(principal: Principal, body: Action): MockResponse {
    if (body.action === "approve") {
      if (principal.tier < 3) {
        return errorResponse(403, "forbidden", fixtureErrorMessage(403));
      }
    } else if (body.action === "ack" || body.action === "handoff") {
      if (this.incident.assignment?.assignee_id !== principal.id) {
        return errorResponse(403, "forbidden", "Only the assigned staff member can respond to this assignment.");
      }
    } else {
      return errorResponse(422, "invalid_payload", "Unknown action.");
    }

    if (body.expected_version !== this.incident.version) {
      return errorResponse(409, "stale_version", fixtureErrorMessage(409));
    }

    if (body.action === "approve") {
      if (this.incident.state !== "plan_proposed") {
        return errorResponse(409, "invalid_transition", "The plan is no longer awaiting approval.");
      }
      if (body.payload.plan_id !== this.incident.plan?.id) {
        return errorResponse(422, "invalid_payload", "plan_id does not match the proposed plan.");
      }
      this.transition("approve", "approved", { id: principal.id, kind: "human", tier: principal.tier }, {
        plan_id: body.payload.plan_id,
      });
      this.schedule(this.options.dispatchDelayMs, () => this.dispatch());
      return { status: 200, json: this.view(principal) };
    }

    if (body.action === "ack") {
      if (this.incident.state !== "dispatched") {
        return errorResponse(409, "invalid_transition", "The assignment is not awaiting a response.");
      }
      if (body.payload.assignment_id !== this.incident.assignment?.id) {
        return errorResponse(422, "invalid_payload", "assignment_id does not match the active assignment.");
      }
      if (body.payload.decision !== "accepted") {
        return errorResponse(422, "invalid_payload", "Declining is not available in the mock.");
      }
      this.transition("ack", "accepted", { id: principal.id, kind: "human", tier: principal.tier }, {
        assignment_id: body.payload.assignment_id,
        decision: "accepted",
      });
      this.startClearingReplay();
      return { status: 200, json: this.view(principal) };
    }

    return errorResponse(422, "invalid_payload", "Handoff is not available in the mock.");
  }

  private dispatch(): void {
    if (this.incident.state !== "approved") {
      return;
    }
    const assignment = clone(
      (fixture("POST", `/api/v1/incidents/${INCIDENT_ID}/actions`).response as Incident).assignment ??
        ({ id: "assignment-overflow-1", assignee_id: "venue-staff-01", domain: "venue" } as Assignment),
    );
    this.incident.assignment = assignment;
    this.transition("dispatch", "dispatched", { id: "venue-worker", kind: "agent", tier: 2 }, {
      assignment_id: assignment.id,
    });
  }

  private startClearingReplay(): void {
    this.clearingSignals.forEach((signal, index) => {
      this.schedule((index + 1) * this.options.tickMs, () => this.observe(signal));
    });
  }

  private observe(signal: Signal): void {
    if (this.incident.state !== "accepted" && this.incident.state !== "verifying") {
      return;
    }
    this.observed.push(signal);
    const evidence = this.observed.map((item) => item.signal_id);
    const elapsed = this.clearedMs();
    this.incident.verification = {
      status: "pending",
      summary: `Door count has stayed under ${signal.data.threshold} for ${Math.floor(elapsed / 1000)} of ${
        VERIFY_WINDOW_MS / 1000
      } seconds.`,
    };
    this.transition("verify", "verifying", { id: "incident-api", kind: "system", tier: null }, {
      evidence_signal_ids: evidence,
    });
    if (elapsed >= VERIFY_WINDOW_MS) {
      this.incident.verification = {
        status: "passed",
        summary: `Door count stayed under ${signal.data.threshold} for ${VERIFY_WINDOW_MS / 1000} seconds.`,
      };
      this.transition("close", "resolved", { id: "incident-api", kind: "system", tier: null }, {
        evidence_signal_ids: evidence,
      });
    }
  }

  private clearedMs(): number {
    const first = this.observed[0];
    const last = this.observed[this.observed.length - 1];
    if (!first || !last) {
      return 0;
    }
    return Date.parse(last.occurred_at) - Date.parse(first.occurred_at);
  }

  private transition(
    type: EventType,
    to: IncidentState,
    actor: ProtocolEvent["actor"],
    payload: Record<string, unknown>,
    record: IncidentRecord = { incident: this.incident, events: this.events },
  ): void {
    const { incident, events } = record;
    const from = incident.state;
    const at = this.timestamp();
    incident.state = to;
    incident.version += 1;
    incident.updated_at = at;
    events.push({
      schema_version: 1,
      event_id: `${incident.id}-${events.length + 1}`,
      incident_id: incident.id,
      sequence: events.length + 1,
      type,
      occurred_at: at,
      actor,
      state_from: from,
      state_to: to,
      payload,
      trace_id: incident.trace_id,
    });
  }

  /** Freeze all scenario work, retaining each timer's remaining delay. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    for (const timer of this.timers) {
      timer.remainingMs = Math.max(0, timer.dueAt - Date.now());
      clearTimeout(timer.handle);
      timer.handle = undefined;
    }
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    for (const timer of this.timers) this.arm(timer);
  }

  /** Rehearsal injection shares the pausable clock used by incident transitions. */
  schedule(delayMs: number, run: () => void): () => void {
    const timer: SimulationTimer = { remainingMs: delayMs, dueAt: Date.now() + delayMs, run };
    this.timers.add(timer);
    if (!this.paused) this.arm(timer);
    return () => {
      clearTimeout(timer.handle);
      this.timers.delete(timer);
    };
  }

  private arm(timer: SimulationTimer): void {
    timer.dueAt = Date.now() + timer.remainingMs;
    timer.handle = setTimeout(() => {
      this.timers.delete(timer);
      timer.run();
    }, timer.remainingMs);
  }
}
