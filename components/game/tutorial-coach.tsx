'use client';
import { ArrowRight, Check, GraduationCap } from 'lucide-react';
import { TUTORIAL_STEPS, type TutorialStep } from '@/lib/tutorial';

/**
 * The first-match coach: one objective at a time, ticked off by the battle
 * itself. The step comes from the HUD, which derives it from battle state.
 */
export function TutorialCoach({
  step,
  steps = TUTORIAL_STEPS,
  onShow,
  onNext,
  onSkip,
}: {
  step: number;
  /** The objectives for this battle's skirmish mode. */
  steps?: readonly TutorialStep[];
  /** Opens the sidebar on the blueprint this step asks for. */
  onShow?: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const current = steps[step],
    previous = steps[step - 1],
    last = step === steps.length - 1;
  return (
    <section
      className="tac-coach tac-plate tac-rivets"
      aria-label="Tutorial"
      aria-live="polite"
    >
      <div className="tac-panel-heading">
        <span>
          <GraduationCap size={13} /> TRAINING {step + 1}/{steps.length}
        </span>
        <button className="tac-coach-skip" onClick={onSkip}>
          Skip tutorial
        </button>
      </div>
      <ol className="tac-coach-pips" aria-hidden="true">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className={i < step ? 'is-done' : i === step ? 'is-current' : ''}
          />
        ))}
      </ol>
      {previous && (
        <p className="tac-coach-done" key={previous.id}>
          <Check size={13} /> {previous.title}
        </p>
      )}
      <div className="tac-coach-body" key={current.id}>
        <strong>{current.title}</strong>
        <p>{current.detail}</p>
      </div>
      <div className="tac-coach-actions">
        {onShow && (
          <button className="tac-coach-show" onClick={onShow}>
            Show me
          </button>
        )}
        <button className="tac-coach-next" onClick={onNext}>
          {last ? 'Done' : 'Next'}
          {last ? <Check size={14} /> : <ArrowRight size={14} />}
        </button>
      </div>
    </section>
  );
}
