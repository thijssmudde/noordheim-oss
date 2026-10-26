'use client';

import { useEffect, useRef, useState } from 'react';
import { ConvexError } from 'convex/values';
import { ArrowRight, Flag, ShieldCheck, ShieldOff } from 'lucide-react';
import { BATTLEFIELDS } from '@/lib/battlefields';
import { DIFFICULTIES } from '@/lib/tactical-difficulty';
import { DEFAULT_SKIRMISH_MODE, SKIRMISH_MODES } from '@/lib/skirmish-modes';
import { Button } from '@/components/ui/button';
import { SponsorRoll } from './sponsor-wall';
import { BattlefieldBackdrop } from './battlefield-backdrop';
import { isVictory, useOperation } from './operation-source';

/** The debrief for the current operation, won or lost, whichever source ran it. */
export function GameOver() {
  const { battle, withdraw } = useOperation()!;
  const won = isVictory(battle);
  const Mark = won ? ShieldCheck : ShieldOff;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const seconds = Math.max(
    0,
    Math.floor((battle.endedAt - battle.startedAt) / 1000),
  );
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  async function returnToOperations() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await withdraw();
    } catch (cause) {
      setError(
        cause instanceof ConvexError
          ? String(cause.data)
          : 'Could not leave the operation. Try again.',
      );
      setBusy(false);
    }
  }
  return (
    <main
      className={`tactical-game tac-game-over${won ? ' is-victory' : ''}`}
      aria-labelledby="game-over-title"
    >
      <BattlefieldBackdrop mapId={battle.mapId} className="is-debrief" />
      <section className="tac-game-over-card tac-plate tac-rivets">
        <Mark className="tac-game-over-mark" size={56} aria-hidden="true" />
        <span className="tac-eyebrow">
          {won ? 'OPERATION COMPLETE' : 'TASK FORCE DEFEATED'}
        </span>
        <h1 id="game-over-title" tabIndex={-1} ref={heading}>
          {won ? 'Victory' : 'Game over'}
        </h1>
        <p className="tac-game-over-reason">
          {won
            ? 'Every hostile army has collapsed. The fjord is ours.'
            : battle.gameOver === 'flag'
              ? 'The enemy captured your flag. Your task force has collapsed.'
              : battle.gameOver === 'buildings'
                ? 'All your forces have been lost.'
                : battle.gameOver === 'timeout'
                  ? 'The operation time limit has been reached.'
                  : 'The operation has ended in defeat.'}
        </p>
        <dl className="tac-game-over-stats">
          <div>
            <dt>Operation</dt>
            <dd>
              {battle.mode === 'solo' ? 'Solo skirmish' : 'Co-op'}
              {battle.skirmish && battle.skirmish !== DEFAULT_SKIRMISH_MODE
                ? ` · ${SKIRMISH_MODES[battle.skirmish].name}`
                : ''}
            </dd>
          </div>
          {won && (
            <div>
              <dt>Battlefield</dt>
              <dd>{BATTLEFIELDS[battle.mapId].name}</dd>
            </div>
          )}
          <div>
            <dt>Difficulty</dt>
            <dd>{DIFFICULTIES[battle.difficulty].name}</dd>
          </div>
          <div>
            <dt>{won ? 'Time to victory' : 'Time survived'}</dt>
            <dd>{duration}</dd>
          </div>
        </dl>
        {battle.status === 'active' && (
          <p className="tac-game-over-allies">
            <Flag size={17} /> Your allies are still fighting.
          </p>
        )}
        {error && (
          <p className="ops-error" role="alert">
            {error}
          </p>
        )}
        <Button
          className="tac-primary"
          disabled={busy}
          onClick={() => void returnToOperations()}
        >
          {busy
            ? 'Returning…'
            : won
              ? 'Return to operations'
              : 'Back to operations'}
          <ArrowRight size={19} />
        </Button>
        <p className="tac-game-over-next">
          Start a new skirmish or join another lobby.
        </p>
        <SponsorRoll />
      </section>
    </main>
  );
}
