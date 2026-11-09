import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import examples from "@contracts/pivot/examples.v1.json";
import { createPivotApi, recallAttendeeId, type PivotApi } from "./client";
import { createPivotMockTransport, PivotMock } from "./mock";
import { SitePage, withContentPolicy } from "./SitePage";
import { SURVEY_PRIVACY_NOTE, SurveyPage } from "./SurveyPage";
import { TrendsPage } from "./TrendsPage";
import type { AttendeeView, Recommendation, Site, Trends } from "./types";

const ID = "att_k7m2qx4n3w5p";
const READY = examples.http["GET /api/v1/attendee/{attendee_id}"].response_200_ready;
const PICKS = examples.http["POST /api/v1/attendee/surveys"].response_201.recommendations as Recommendation[];

function mockApi(mock: PivotMock, token = "mock-organizer"): PivotApi {
  return createPivotApi({ transport: createPivotMockTransport(mock), getToken: () => token });
}

function stubApi(view: AttendeeView) {
  const recordInteraction = vi.fn(async () => ({ ok: true as const, data: { accepted: true } }));
  const api = { getAttendee: vi.fn(async () => ({ ok: true as const, data: view })), recordInteraction } as unknown as PivotApi;
  return { api, recordInteraction };
}

const readyView: AttendeeView = { attendee_id: ID, recommendations: PICKS, site: READY.site as Site, progress: READY.progress };

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = "";
});

describe("survey", () => {
  async function fill(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("radio", { name: /Attendee/ }));
    await user.click(screen.getByRole("checkbox", { name: "Observability" }));
    await user.click(screen.getByRole("radio", { name: "Practitioner" }));
  }

  it("submits five answers, joins presence and hands back the site id", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn(async () => ({ ok: true, message: "" }));
    const onBuilt = vi.fn();
    render(<SurveyPage api={mockApi(new PivotMock())} onJoin={onJoin} onBuilt={onBuilt} existingId={null} />);
    await fill(user);
    await user.type(screen.getByRole("textbox"), "Cut alert noise");
    await user.click(screen.getByRole("checkbox", { name: "Larger text" }));
    await user.click(screen.getByRole("button", { name: "Build my site" }));
    await waitFor(() => expect(onBuilt).toHaveBeenCalledTimes(1));
    expect(onBuilt.mock.calls[0]?.[0]).toMatch(/^att_[a-z2-7]{12}$/);
    expect(onJoin).toHaveBeenCalledWith("attendee");
    expect(recallAttendeeId()).toBe(onBuilt.mock.calls[0]?.[0]);
    expect(screen.getByText(SURVEY_PRIVACY_NOTE)).toBeInTheDocument();
  });

  it("caps interests at three and asks for missing answers", async () => {
    const user = userEvent.setup();
    render(<SurveyPage api={mockApi(new PivotMock())} onJoin={async () => ({ ok: true, message: "" })} onBuilt={vi.fn()} existingId={null} />);
    await user.click(screen.getByRole("button", { name: "Build my site" }));
    expect(screen.getByRole("status")).toHaveTextContent("Choose how you are here today.");
    for (const name of ["Observability", "Security", "Networking"]) await user.click(screen.getByRole("checkbox", { name }));
    expect(screen.getByRole("checkbox", { name: "AI agents" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeEnabled();
  });

  it("answers a 429 with a plain sentence and a retry that works", async () => {
    const user = userEvent.setup();
    const mock = new PivotMock();
    mock.rateLimitNextSurvey();
    const onBuilt = vi.fn();
    render(<SurveyPage api={mockApi(mock)} onJoin={async () => ({ ok: false, message: "down" })} onBuilt={onBuilt} existingId={null} />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Build my site" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/try again/i);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onBuilt).toHaveBeenCalled());
  });
});

describe("generated page", () => {
  it("puts the content policy right after the one head tag and rejects other shapes", () => {
    const guarded = withContentPolicy("<html><head><title>x</title></head><body></body></html>");
    expect(guarded).toContain(`<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>`);
    expect(withContentPolicy("<html><body></body></html>")).toBeNull();
    expect(withContentPolicy("<head></head><head></head>")).toBeNull();
  });

  it("renders in a script-free sandbox and records taps from the frame and the picks list", async () => {
    const user = userEvent.setup();
    const { api, recordInteraction } = stubApi(readyView);
    render(<SitePage api={api} attendeeId={ID} />);
    const frame = (await screen.findByTitle("Your conference site")) as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("Content-Security-Policy");
    expect(screen.getByRole("link", { name: "commit 3f2a9c1" })).toHaveAttribute("href", READY.site.commit_url);

    const doc = frame.contentDocument as Document;
    doc.body.innerHTML = `<article data-session-id="sess-031"><h2>B</h2></article><article data-session-id="sess-014"><button data-action="save">Save</button></article>`;
    const button = doc.querySelector("button") as Element;
    doc.elementFromPoint = () => button;
    fireEvent.click(screen.getByTestId("site-tap"));
    expect(recordInteraction).toHaveBeenLastCalledWith(ID, "sess-014", "save", 1);
    doc.elementFromPoint = () => doc.querySelector("h2");
    fireEvent.click(screen.getByTestId("site-tap"));
    expect(recordInteraction).toHaveBeenLastCalledWith(ID, "sess-031", "open", 0);

    await user.click(screen.getAllByRole("button", { name: "Not for me" })[1] as HTMLElement);
    expect(recordInteraction).toHaveBeenLastCalledWith(ID, "sess-031", "dismiss", 1);
    expect(screen.getByRole("status")).toHaveTextContent("Hid Golden Paths That People Actually Walk.");
  });

  it("shows a dry-run build's page hash instead of a commit link", async () => {
    const site = { ...(READY.site as Site), commit_mode: "dry-run" as const, commit_sha: null, commit_url: null };
    render(<SitePage api={stubApi({ ...readyView, site }).api} attendeeId={ID} />);
    expect(await screen.findByText("9b6f0c2")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /commit/ })).not.toBeInTheDocument();
  });

  it("lists the agent's steps while building and falls back to plain picks on failure", async () => {
    const building: AttendeeView = { ...readyView, site: { status: "building" }, progress: READY.progress.slice(0, 2) };
    const first = render(<SitePage api={stubApi(building).api} attendeeId={ID} />);
    expect(await screen.findByRole("list", { name: "What the agent has done" })).toHaveTextContent("Found six sessions that fit you");
    expect(screen.getByRole("heading", { name: "Building your site" })).toBeInTheDocument();
    first.unmount();

    render(<SitePage api={stubApi({ ...readyView, site: { status: "failed" } }).api} attendeeId={ID} />);
    expect(await screen.findByRole("heading", { name: "Your sessions" })).toBeInTheDocument();
    expect(screen.getByText(PICKS[0]?.title ?? "")).toBeInTheDocument();
    expect(screen.queryByTitle("Your conference site")).not.toBeInTheDocument();
  });

  it("does not call the API for an id that is not an attendee id", () => {
    const { api } = stubApi(readyView);
    render(<SitePage api={api} attendeeId="../incidents" />);
    expect(screen.getByRole("heading", { name: "No site here yet" })).toBeInTheDocument();
    expect(api.getAttendee).not.toHaveBeenCalled();
  });
});

describe("mock pivot API", () => {
  it("moves a survey from queued through building to ready and never returns the goal", async () => {
    let now = 1_000_000;
    const api = mockApi(new PivotMock(() => now));
    const created = await api.submitSurvey({ role: "attendee", interests: ["security"], level: "new", vibe: "calm", accessibility: [], goal: "secret words" });
    if (!created.ok) throw new Error("survey rejected");
    const read = async () => {
      const result = await api.getAttendee(created.data.attendee_id);
      if (!result.ok) throw new Error("attendee missing");
      return result.data;
    };
    expect((await read()).site.status).toBe("queued");
    now += 2500;
    const building = await read();
    expect(building.site.status).toBe("building");
    expect(building.progress.length).toBeGreaterThan(0);
    expect(JSON.stringify(building)).not.toContain("secret words");
    now += 10000;
    const ready = await read();
    expect(ready.site.status).toBe("ready");
    expect(ready.progress).toHaveLength(7);
    expect((await api.getAttendee("att_aaaaaaaaaaaa")).ok).toBe(false);
  });

  it("keeps trends behind the organizer token", async () => {
    const result = await mockApi(new PivotMock(), "mock-attendee").getTrends({});
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe("trends", () => {
  it("labels simulated traffic and filters every chart through the URL", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/trends";
    const getTrends = vi.fn(mockApi(new PivotMock()).getTrends);
    render(<TrendsPage api={{ getTrends } as unknown as PivotApi} />);
    expect(await screen.findByText("Includes 120 simulated attendees.")).toBeInTheDocument();
    expect(screen.getAllByRole("table", { hidden: true }).length).toBe(5);
    await user.click(screen.getByRole("button", { name: /^Security/ }));
    expect(window.location.hash).toBe("#/trends?interest=security");
    await waitFor(() => expect(getTrends).toHaveBeenLastCalledWith({ interest: "security", source: null }, expect.anything()));
    await user.click(screen.getByRole("checkbox", { name: "Real scans only" }));
    expect(window.location.hash).toBe("#/trends?interest=security&source=qr");
  });

  it("explains a missing organizer token", async () => {
    render(<TrendsPage api={mockApi(new PivotMock(), "")} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Organizer access needed.");
  });
});

export type { Trends };
