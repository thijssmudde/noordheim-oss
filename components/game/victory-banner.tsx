'use client';

import { ArrowRight, Flag } from 'lucide-react';

/**
 * The beat between the last flag and the debrief: the battlefield stays in
 * view under an operation-complete banner while its fuse burns down. Reduced
 * motion stops the fuse, so the banner then waits for the button.
 */
export function VictoryBanner({
  mapName,
  flags,
  onDebrief,
}: {
  mapName: string;
  /** Whether the operation was won on flags rather than by annihilation. */
  flags: boolean;
  onDebrief: () => void;
}) {
  return (
    <div className="tac-victory-region">
      <section
        className="tac-victory-banner"
        aria-label="Operation complete"
        aria-live="polite"
      >
        <Flag className="tac-victory-mark" size={30} aria-hidden="true" />
        <span className="tac-eyebrow">
          {mapName.toUpperCase()} · SECTOR SECURED
        </span>
        <h2>Operation complete</h2>
        <p>
          {flags
            ? 'Every enemy flag captured. The hostile armies have collapsed.'
            : 'Every enemy building and unit destroyed.'}{' '}
          The fjord is ours.
        </p>
        <button className="tac-victory-debrief" onClick={onDebrief}>
          Debrief
          <ArrowRight size={17} aria-hidden="true" />
          <span
            className="tac-victory-fuse"
            aria-hidden="true"
            onAnimationEnd={onDebrief}
          />
        </button>
      </section>
    </div>
  );
}
