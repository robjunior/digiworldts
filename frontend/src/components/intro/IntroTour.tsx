import { useCallback, useEffect, useState } from 'react';

import {
  INTRO_TOUR_ACTIVE_KEY,
  INTRO_TOUR_DONE_KEY,
  INTRO_TOUR_STEP_KEY,
  INTRO_TOUR_STEPS,
  type IntroTourStep,
} from './tourSteps';

const TARGET_ATTR = 'data-intro-target';

function loadInitialState(): { active: boolean; step: number } {
  if (typeof window === 'undefined') return { active: false, step: 0 };
  try {
    const active = window.localStorage.getItem(INTRO_TOUR_ACTIVE_KEY) === '1';
    const done = window.localStorage.getItem(INTRO_TOUR_DONE_KEY) === '1';
    if (done || !active) return { active: false, step: 0 };
    const raw = window.localStorage.getItem(INTRO_TOUR_STEP_KEY);
    const step = raw === null ? 0 : Math.max(0, Math.min(INTRO_TOUR_STEPS.length - 1, Number.parseInt(raw, 10) || 0));
    return { active: true, step };
  } catch {
    return { active: false, step: 0 };
  }
}

function highlight(href: string | undefined): (() => void) {
  if (typeof document === 'undefined' || href === undefined) return () => {};
  const el = document.querySelector<HTMLElement>(`a[href="${href}"]`);
  if (el === null) return () => {};
  el.setAttribute(TARGET_ATTR, 'true');
  return () => el.removeAttribute(TARGET_ATTR);
}

export function IntroTour(): JSX.Element | null {
  const [state, setState] = useState(loadInitialState);

  useEffect(() => {
    const rearm = (): void => setState(loadInitialState());
    window.addEventListener('storage', rearm);
    window.addEventListener('digiworld:intro-tour-armed', rearm);
    return () => {
      window.removeEventListener('storage', rearm);
      window.removeEventListener('digiworld:intro-tour-armed', rearm);
    };
  }, []);

  useEffect(() => {
    if (!state.active) return;
    const step = INTRO_TOUR_STEPS[state.step];
    if (step === undefined) return;
    const removeHighlight = highlight(step.targetHref);
    return removeHighlight;
  }, [state.active, state.step]);

  const persist = useCallback((next: { active: boolean; step: number; done: boolean }) => {
    try {
      window.localStorage.setItem(INTRO_TOUR_ACTIVE_KEY, next.active ? '1' : '0');
      window.localStorage.setItem(INTRO_TOUR_STEP_KEY, String(next.step));
      if (next.done) window.localStorage.setItem(INTRO_TOUR_DONE_KEY, '1');
    } catch {
      // storage unavailable — tour continues in memory only
    }
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      const nextStep = prev.step + 1;
      if (nextStep >= INTRO_TOUR_STEPS.length) {
        persist({ active: false, step: 0, done: true });
        return { active: false, step: 0 };
      }
      persist({ active: true, step: nextStep, done: false });
      return { active: true, step: nextStep };
    });
  }, [persist]);

  const skip = useCallback(() => {
    persist({ active: false, step: 0, done: true });
    setState({ active: false, step: 0 });
  }, [persist]);

  if (!state.active) return null;
  const step: IntroTourStep | undefined = INTRO_TOUR_STEPS[state.step];
  if (step === undefined) return null;
  const isFinal = state.step === INTRO_TOUR_STEPS.length - 1;
  const total = INTRO_TOUR_STEPS.length;

  return (
    <div className="intro-tour" role="dialog" aria-labelledby="intro-tour-title" aria-modal="false">
      <div className="intro-tour-card">
        <div className="intro-tour-progress">Step {state.step + 1} of {total}</div>
        <h2 id="intro-tour-title" className="intro-tour-title">{step.title}</h2>
        <p className="intro-tour-body">{step.body}</p>
        <div className="intro-tour-actions">
          <button type="button" className="intro-tour-skip" onClick={skip}>Skip intro</button>
          <button type="button" className="intro-tour-next" onClick={next}>{isFinal ? 'Finish' : 'Next →'}</button>
        </div>
      </div>
    </div>
  );
}
