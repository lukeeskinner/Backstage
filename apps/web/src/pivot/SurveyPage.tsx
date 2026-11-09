import { useId, useState, type FormEvent } from "react";
import { PRESENCE_TIERS, type PresenceTier } from "../api/types";
import type { PivotApi } from "./client";
import { rememberAttendeeId } from "./client";
import { ACCESSIBILITY, INTERESTS, LEVELS, VIBES } from "./types";
import type { Accessibility, Interest, Level, SurveyAnswers, Vibe } from "./types";
import { ACCESSIBILITY_LABEL, INTEREST_LABEL, LEVEL_LABEL, ROLE_LABEL, VIBE_LABEL } from "./labels";
import "./pivot.css";

export const SURVEY_PRIVACY_NOTE =
  "No names or emails. Your answers shape your site and add to anonymous trend counts. Your site lives at a private link.";

const MAX_INTERESTS = 3;
const GOAL_MAX = 140;

export interface SurveyPageProps {
  api: PivotApi;
  /** Keeps the floor count working. A failed presence join never blocks the survey. */
  onJoin(tier: PresenceTier): Promise<{ ok: boolean; message: string }>;
  onBuilt(attendeeId: string): void;
  /** A site this browser already built, offered as a way back. */
  existingId: string | null;
}

export function SurveyPage({ api, onJoin, onBuilt, existingId }: SurveyPageProps) {
  const ids = useId();
  const [role, setRole] = useState<PresenceTier | null>(null);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [level, setLevel] = useState<Level | null>(null);
  const [goal, setGoal] = useState("");
  const [vibe, setVibe] = useState<Vibe>("calm");
  const [comfort, setComfort] = useState<Accessibility[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rateLimited, setRateLimited] = useState(false);

  const toggleInterest = (interest: Interest) => {
    setMessage("");
    setInterests((current) =>
      current.includes(interest) ? current.filter((item) => item !== interest) : current.length < MAX_INTERESTS ? [...current, interest] : current,
    );
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    if (!role) return setMessage("Choose how you are here today.");
    if (interests.length === 0) return setMessage("Pick one to three topics.");
    if (!level) return setMessage("Choose your level.");
    const answers: SurveyAnswers = { role, interests, level, vibe, accessibility: comfort };
    const trimmed = goal.trim();
    if (trimmed) answers.goal = trimmed.slice(0, GOAL_MAX);
    setBusy(true);
    setRateLimited(false);
    setMessage("Sending your answers...");
    try {
      await onJoin(role).catch(() => null);
      const result = await api.submitSurvey(answers);
      if (result.ok) {
        rememberAttendeeId(result.data.attendee_id);
        setMessage("Building your site...");
        onBuilt(result.data.attendee_id);
        return;
      }
      if (result.status === 429) {
        setRateLimited(true);
        setMessage("A lot of sites are being built right now. Wait a moment, then try again.");
      } else {
        setMessage(result.message);
      }
    } catch {
      setMessage("Could not send your answers. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="join survey" aria-labelledby={`${ids}-title`}>
      <div className="join__sheet">
        <p className="join__brand">BACKSTAGE</p>
        <form className="join__form" onSubmit={submit} aria-describedby={`${ids}-intro`} aria-busy={busy || undefined} noValidate>
          <h1 id={`${ids}-title`} className="join__title">
            Get a conference site built for you
          </h1>
          <p id={`${ids}-intro`} className="join__text">
            Five quick answers. A coding agent then writes a page for you and picks your sessions.
          </p>
          {existingId ? (
            <p className="join__text">
              <a href={`#/site/${existingId}`}>Go back to the site you already built</a>
            </p>
          ) : null}

          <fieldset className="join__options" disabled={busy}>
            <legend className="survey__legend">1. How are you here today?</legend>
            {PRESENCE_TIERS.map((tier) => (
              <div key={tier} className="join__option" data-tier={tier}>
                <input id={`${ids}-${tier}`} type="radio" name={`${ids}-role`} checked={role === tier} onChange={() => { setRole(tier); setMessage(""); }} />
                <label htmlFor={`${ids}-${tier}`}>
                  <span className="join__option-dot" aria-hidden="true" />
                  <span className="join__option-name">{ROLE_LABEL[tier]}</span>
                </label>
              </div>
            ))}
          </fieldset>

          <fieldset className="survey__group" disabled={busy}>
            <legend className="survey__legend">
              2. What are you into? <span className="survey__hint">Pick up to three. {interests.length} of {MAX_INTERESTS} chosen.</span>
            </legend>
            <div className="survey__chips">
              {INTERESTS.map((interest) => {
                const checked = interests.includes(interest);
                return (
                  <label key={interest} className="survey__chip">
                    <input type="checkbox" checked={checked} disabled={!checked && interests.length >= MAX_INTERESTS} onChange={() => toggleInterest(interest)} />
                    <span>{INTEREST_LABEL[interest]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="survey__group" disabled={busy}>
            <legend className="survey__legend">3. Your level</legend>
            <div className="survey__chips">
              {LEVELS.map((item) => (
                <label key={item} className="survey__chip">
                  <input type="radio" name={`${ids}-level`} checked={level === item} onChange={() => { setLevel(item); setMessage(""); }} />
                  <span>{LEVEL_LABEL[item]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="survey__group">
            <label className="survey__legend" htmlFor={`${ids}-goal`}>
              4. What do you want from today? <span className="survey__hint">Optional. Used to find sessions, never shown or published.</span>
            </label>
            <input id={`${ids}-goal`} className="survey__goal" type="text" maxLength={GOAL_MAX} value={goal} disabled={busy} autoComplete="off"
              onChange={(event) => setGoal(event.target.value)} placeholder="Find talks on cutting alert noise" />
          </div>

          <fieldset className="survey__group" disabled={busy}>
            <legend className="survey__legend">5. Look and comfort</legend>
            <div className="survey__chips">
              {VIBES.map((item) => (
                <label key={item} className="survey__chip">
                  <input type="radio" name={`${ids}-vibe`} checked={vibe === item} onChange={() => setVibe(item)} />
                  <span>{VIBE_LABEL[item]}</span>
                </label>
              ))}
            </div>
            <div className="survey__chips">
              {ACCESSIBILITY.map((item) => (
                <label key={item} className="survey__chip">
                  <input type="checkbox" checked={comfort.includes(item)}
                    onChange={() => setComfort((current) => (current.includes(item) ? current.filter((value) => value !== item) : [...current, item]))} />
                  <span>{ACCESSIBILITY_LABEL[item]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="join__continue" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Sending..." : rateLimited ? "Try again" : "Build my site"}
          </button>
        </form>

        <p role="status" aria-live="polite" className="join__message">
          {message}
        </p>
        <p className="join__privacy">{SURVEY_PRIVACY_NOTE}</p>
      </div>
    </section>
  );
}
