import { useEffect, useRef, useState } from "react";
import type { Route } from "../ui/types";
import { spoken as speechText, type TourContext, type TourStep } from "./script";
import "./tour.css";

const TICK_MS = 100;
const CLICK_AFTER_MS = 1800;
const MAX_WAIT_MS = 20000;
const SPEAK_AFTER_MS = 400;

declare global {
  interface Window {
    /** Set by the recorder: minimum hold per step id so the recorded voiceover fits. */
    __TOUR_HOLDS?: Record<string, number>;
  }
}

function speech(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function speak(text: string) {
  const synth = speech();
  if (!synth) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = synth.getVoices().find((candidate) => candidate.lang === "en-US" && /Samantha|Google US English|Ava|Zoe/.test(candidate.name))
    ?? synth.getVoices().find((candidate) => candidate.lang.startsWith("en"));
  if (voice) utterance.voice = voice;
  utterance.rate = 1.02;
  synth.speak(utterance);
}

interface TourDirectorProps {
  steps: TourStep[];
  context: TourContext;
  onNavigate(route: Route): void;
  onIdentity(id: string): void;
  onExit(): void;
  onRestart(): void;
  /** Read each step aloud with the browser's speech engine. */
  voiceDefault?: boolean;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function TourDirector({ steps, context, onNavigate, onIdentity, onExit, onRestart, voiceDefault = false }: TourDirectorProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [voice, setVoice] = useState(voiceDefault && Boolean(speech()));
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const [progress, setProgress] = useState(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const done = index >= steps.length;
  const step = steps[Math.min(index, steps.length - 1)]!;

  useEffect(() => {
    const root = document.documentElement;
    if (done) {
      root.dataset.tourDone = "true";
      delete root.dataset.tourStep;
      return;
    }
    delete root.dataset.tourDone;
    root.dataset.tourStep = step.id;
    onIdentity(step.identity);
    onNavigate(step.route);
    step.enter?.(context);

    let focused: Element | null = null;
    let since = 0;
    let held = 0;
    let clicked = false;
    let selected = false;
    let typed = 0;
    let submitted = false;
    let spoken = false;
    const hold = Math.max(step.holdMs, window.__TOUR_HOLDS?.[step.id] ?? 0);
    speech()?.cancel();
    setProgress(0);

    const timer = setInterval(() => {
      if (pausedRef.current) return;
      since += TICK_MS;
      if (!spoken && since >= SPEAK_AFTER_MS) {
        spoken = true;
        if (voiceRef.current) speak(speechText(step.body));
      }
      if (step.select && !selected) {
        const card = document.querySelector<HTMLButtonElement>(`[data-incident-id="${step.select}"] .card__select`);
        if (card) {
          card.click();
          selected = true;
        }
      }
      const target = step.target ? document.querySelector(step.target) : null;
      if (target && target !== focused) {
        focused?.classList.remove("tour-focus");
        target.classList.add("tour-focus");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        focused = target;
      }
      if (step.click && !clicked && since >= CLICK_AFTER_MS) {
        const button = document.querySelector<HTMLButtonElement>(step.click);
        if (button && !button.disabled) {
          button.click();
          clicked = true;
        }
      }
      if (step.type && since >= CLICK_AFTER_MS && !submitted) {
        const input = document.querySelector<HTMLInputElement>(step.type.selector);
        if (input && typed < step.type.text.length) {
          if (since % 200 === 0) {
            typed += 1;
            input.focus();
            setNativeValue(input, step.type.text.slice(0, typed));
          }
        } else if (input) {
          input.form?.requestSubmit();
          submitted = true;
        }
      }
      const ready = !step.ready || step.ready() || since >= MAX_WAIT_MS;
      if (!ready) return;
      held += TICK_MS;
      setProgress(Math.min(1, held / hold));
      const talking = voiceRef.current && Boolean(speech()?.speaking);
      if (held >= hold && !talking) {
        clearInterval(timer);
        setIndex((value) => value + 1);
      }
    }, TICK_MS);

    return () => {
      clearInterval(timer);
      focused?.classList.remove("tour-focus");
    };
  }, [index]);

  useEffect(() => {
    const synth = speech();
    if (!synth) return;
    if (paused) synth.pause();
    else synth.resume();
  }, [paused]);

  useEffect(() => () => {
    speech()?.cancel();
    delete document.documentElement.dataset.tourStep;
    delete document.documentElement.dataset.tourDone;
  }, []);

  return (
    <aside className="tour" aria-label="Guided demo" aria-live="polite" data-route={step.route}>
      <div className="tour__meta">
        <span className="tour__badge">Simulated demo</span>
        <span className="tour__count">{done ? "Finished" : `${index + 1} of ${steps.length}`}</span>
      </div>
      <h2 className="tour__title">{done ? "That was the full run" : step.title}</h2>
      <p className="tour__body">{done ? "Replay it, or exit to explore the app yourself." : step.body}</p>
      <div className="tour__bar" aria-hidden="true">
        <span style={{ width: `${((Math.min(index, steps.length) + (done ? 0 : progress)) / steps.length) * 100}%` }} />
      </div>
      <div className="tour__controls">
        {done ? (
          <button type="button" className="tour__button tour__button--primary" onClick={() => { onRestart(); setIndex(0); setPaused(false); }}>
            Replay demo
          </button>
        ) : (
          <>
            <button type="button" className="tour__button" onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button>
            <button type="button" className="tour__button" onClick={() => setIndex(index + 1)}>Next</button>
            {speech() ? (
              <button type="button" className="tour__button" aria-pressed={voice} onClick={() => { if (voice) speech()?.cancel(); setVoice(!voice); }}>
                {voice ? "Voice on" : "Voice off"}
              </button>
            ) : null}
          </>
        )}
        <button type="button" className="tour__button tour__button--quiet" onClick={onExit}>Exit demo</button>
      </div>
    </aside>
  );
}
