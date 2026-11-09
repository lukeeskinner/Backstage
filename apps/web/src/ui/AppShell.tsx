import { useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
import "../styles.css";
import { EVENT } from "../venue/kubecon-na-2026";
import type { Identity, Route } from "./types";

export const PRIVACY_NOTE = "Cameras report people counts only. No frames, faces or identities are stored.";

const MAIN_ROLES = new Set(["organizer", "venue-staff", "it-staff", "attendee"]);

const NAV: { route: Route; label: string }[] = [
  { route: "board", label: "Board" },
  { route: "history", label: "History" },
  { route: "trends", label: "Trends" },
  { route: "trail", label: "Trail" },
  { route: "demo", label: "Video & vision" },
  { route: "me", label: "Your inbox" },
  { route: "status", label: "Attendee status" },
  { route: "projector", label: "Projector" },
];

export interface AppShellProps {
  route: Route;
  onNavigate(route: Route): void;
  identities: Identity[];
  activeIdentityId: string;
  onIdentityChange(id: string): void;
  mockMode: boolean;
  token: string;
  onTokenChange(token: string): void;
  announcement: string;
  children: ReactNode;
  devPanel?: ReactNode;
  touring?: boolean;
  onStartTour?: () => void;
}

export function AppShell({
  route,
  onNavigate,
  identities,
  activeIdentityId,
  onIdentityChange,
  mockMode,
  token,
  onTokenChange,
  announcement,
  children,
  devPanel,
  touring = false,
  onStartTour,
}: AppShellProps) {
  const [draftToken, setDraftToken] = useState(token);
  useEffect(() => setDraftToken(token), [token, activeIdentityId]);
  const ids = useId();
  const identityId = `${ids}-identity`;
  const identityHelpId = `${ids}-identity-help`;
  const tokenId = `${ids}-token`;
  const projector = route === "projector";
  const active = identities.find((identity) => identity.id === activeIdentityId);

  const go = (target: Route) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onNavigate(target);
  };

  return (
    <div className={projector ? "shell shell--projector" : "shell"}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__header">
        <div className="wordmark">
          <span className="wordmark__text">BACKSTAGE</span>
          <span className="wordmark__tagline">On-call for the conference floor</span>
        </div>
        {projector ? null : (
          <>
            <nav className="shell__nav" aria-label="Views">
              <ul>
                {NAV.map((item) => (
                  <li key={item.route}>
                    <a
                      href={`#/${item.route}`}
                      aria-current={route === item.route ? "page" : undefined}
                      onClick={go(item.route)}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="shell__identity">
              {onStartTour && !touring ? (
                <button type="button" className="btn btn--primary tour-start" onClick={onStartTour}>
                  Start demo
                </button>
              ) : null}
              <div
                role="group"
                aria-labelledby={identityId}
                aria-describedby={active ? identityHelpId : undefined}
                className="roles"
              >
                <span id={identityId} className="roles__label">
                  Viewing as
                </span>
                <div className="roles__pills">
                  {identities.filter((identity) => MAIN_ROLES.has(identity.id)).map((identity) => (
                    <button
                      key={identity.id}
                      type="button"
                      className="roles__pill"
                      aria-pressed={identity.id === activeIdentityId}
                      onClick={() => onIdentityChange(identity.id)}
                    >
                      {identity.label}
                      <span className="sr-only">, tier {identity.tier}</span>
                    </button>
                  ))}
                </div>
              </div>
              <details className="shell__settings">
                <summary>Connection settings{active && !MAIN_ROLES.has(active.id) ? ` · ${active.label}` : ""}</summary>
                <div className="shell__settings-content">
                  {identities.length ? (
                    <label className="field">
                      All roles
                      <select value={activeIdentityId} onChange={(event) => onIdentityChange(event.target.value)}>
                        {identities.map((identity) => <option key={identity.id} value={identity.id}>{identity.label}</option>)}
                      </select>
                    </label>
                  ) : null}
              {mockMode ? null : (
                <form className="field" onSubmit={(event) => { event.preventDefault(); onTokenChange(draftToken.trim()); }}>
                  <label htmlFor={tokenId}>API token</label>
                  <input
                    id={tokenId}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draftToken}
                    onChange={(event) => setDraftToken(event.target.value)}
                  />
                  <button type="submit" className="btn btn--quiet">Use token</button>
                </form>
              )}
                </div>
              </details>
              {active ? (
                <p className="shell__identity-help" id={identityHelpId}>
                  {active.description}
                  {mockMode ? " Using mock data." : ""}
                </p>
              ) : null}
            </div>
          </>
        )}
      </header>

      <div role="status" aria-live="polite" aria-atomic="true" className="live-region">
        {announcement}
      </div>

      <main id="main" tabIndex={-1} className="shell__main">
        {children}
      </main>

      {projector ? null : (
        <footer className="shell__footer">
          <p className="privacy-note">{PRIVACY_NOTE}</p>
          <p className="shell__event">
            {EVENT.name} at {EVENT.venue}, {EVENT.city}. {EVENT.dates}.
          </p>
          <p className="shell__event">Built for the conference floor. An independent hackathon project, not affiliated with the event.</p>
          {devPanel}
        </footer>
      )}
    </div>
  );
}
