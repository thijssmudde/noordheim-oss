'use client';
import { useSyncExternalStore } from 'react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { Id } from '@/convex/_generated/dataModel';
import type { MapId } from '@/lib/maps';
import type { SkirmishMode } from '@/lib/skirmish-modes';
import TacticalCommand from '../game/tactical-command';
import { LocalBattleSource } from '../game/battle-source';
import { GameAudioProvider } from '../game/game-audio';
import {
  launchLocalOperation,
  localOperation,
  subscribeLocalOperation,
} from '../game/local-operation';
const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
const player = {
  _id: 'solo-review' as Id<'players'>,
  name: 'Raven 07',
  culture: 'fjordborn',
};

/**
 * `/?uiReview=solo`: a live first match exactly as Deploy starts one — the
 * real worker simulation from a bare command station — without enrolling a
 * commander, so the opening HUD can be played and captured offline.
 */
export default function SoloReview({
  mapId,
  mode,
}: {
  mapId: MapId;
  /** `&mode=megawealth`: the first match under a skirmish mission. */
  mode?: SkirmishMode;
}) {
  const operation = useSyncExternalStore(
    subscribeLocalOperation,
    () => localOperation(player._id),
    () => null,
  );
  const launch = () =>
    launchLocalOperation(
      { id: player._id, name: player.name, culture: player.culture },
      { difficulty: 'normal', mapId, enemyCount: 1, seed: 947, mode },
    );
  return (
    <ConvexProvider client={client}>
      <GameAudioProvider>
        {operation && (
          <LocalBattleSource key={operation.id} operation={operation}>
            <TacticalCommand
              player={player}
              token="solo-preview"
              onOperations={launch}
            />
          </LocalBattleSource>
        )}
        {/* Out of the way once the match runs; Operations restarts it. */}
        {!operation && (
          <nav className="interface-review-nav" aria-label="Interface preview">
            <span>SOLO REVIEW</span>
            <button data-solo-launch onClick={launch}>
              Start first match
            </button>
            <a href="/">Home</a>
          </nav>
        )}
      </GameAudioProvider>
    </ConvexProvider>
  );
}
