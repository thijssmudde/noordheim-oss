'use client';

import { useId, useState, type CSSProperties } from 'react';
import { useMutation } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import { ArrowRight, Copy, Crown, Mountain, Radio } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { CULTURES, type Culture } from '@/lib/cultures';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { OperationSettings } from './operation-settings';
import { AttractBackdrop } from './battlefield-backdrop';
import { SponsorWall } from './sponsor-wall';
import { MapSelect } from './map-select';
import { BATTLEFIELDS } from '@/lib/battlefields';

type Overview = FunctionReturnType<typeof api.operations.overview>;
export type WaitingLobby = NonNullable<Overview['lobby']>;

export function PlayerLimit({
  value,
  disabled,
  minimum = 2,
  onChange,
}: {
  value: number;
  disabled: boolean;
  minimum?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <label className="ops-field" htmlFor={id}>
      Player limit
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {Array.from({ length: 7 }, (_, i) => i + 2).map((n) => (
          <NativeSelectOption key={n} value={n} disabled={n < minimum}>
            {n} players
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}

/** The waiting room: roster, join code and the host's settings until the operation launches. */
export function LobbyPage({
  token,
  name,
  viewerId,
  lobby,
  review = false,
}: {
  token: string;
  name: string;
  viewerId: string;
  lobby: WaitingLobby;
  review?: boolean;
}) {
  const configure = useMutation(api.operations.configureLobby),
    leave = useMutation(api.operations.leaveLobby),
    start = useMutation(api.operations.startLobby);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  const host = lobby.hostId === viewerId;
  const battlefield = BATTLEFIELDS[lobby.mapId];
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    if (review) {
      setError('This is the interface preview. Return to the game to deploy.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      const message =
        cause instanceof ConvexError
          ? String(cause.data)
          : cause instanceof Error
            ? cause.message
            : 'Could not reach Northern Command.';
      setError(message.replace(/^[\s\S]*ConvexError: /, '').split('\n')[0]);
    } finally {
      setBusy(false);
    }
  }
  const settings = (patch: Partial<Parameters<typeof configure>[0]>) =>
    run(() =>
      configure({
        token,
        lobbyId: lobby.id,
        difficulty: lobby.difficulty,
        maxPlayers: lobby.maxPlayers,
        enemyCount: lobby.enemyCount,
        ...patch,
      }),
    );
  return (
    <main
      className="tactical-game operation-hub"
      style={{ '--map-accent': battlefield.accent } as CSSProperties}
    >
      <AttractBackdrop mapId={lobby.mapId} />
      <aside className="ops-hero" aria-label="Battlefield briefing">
        <span className="ops-hero-eyebrow">
          OPERATION BRIEFING · {battlefield.biome.toUpperCase()}
        </span>
        <h2>{battlefield.name}</h2>
        <p>{battlefield.tagline}</p>
      </aside>
      <div className="ops-shell">
        <header className="ops-header">
          <div>
            <span className="ops-brand">
              <Mountain size={22} /> NOORDHEIM
              <span className="ops-biome">
                {' · '}
                {battlefield.biome.toUpperCase()}
              </span>
            </span>
            <h1>Assemble your task force.</h1>
          </div>
          <span className="ops-callsign">
            COMMANDER <strong>{name}</strong>
          </span>
        </header>
        {error && (
          <p className="ops-error" role="alert">
            {error}
          </p>
        )}
        <section
          className="ops-panel tac-plate tac-rivets"
          aria-label="Multiplayer lobby"
        >
          <div className="ops-lobby-heading">
            <div>
              <span className="tac-eyebrow">WAITING FOR COMMANDERS</span>
              <h2>{lobby.name}</h2>
            </div>
            <strong>
              {lobby.count} / {lobby.maxPlayers}
            </strong>
          </div>
          <div className="ops-invite">
            <div>
              <span>Join code</span>
              <strong>{lobby.code}</strong>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(lobby.code);
                  setCopied(true);
                })
              }
            >
              <Copy size={16} />
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>
          <p className="ops-muted">
            Share this code with your friends. They enter it on the home screen
            under Join a lobby. The host starts when everyone is here.
          </p>
          <div className="ops-lobby-columns">
            <section aria-label="Lobby roster">
              <h3>Commanders</h3>
              <ol className="ops-roster">
                {Array.from({ length: lobby.maxPlayers }, (_, i) => {
                  const member = lobby.members[i];
                  return (
                    <li
                      key={i}
                      style={
                        member
                          ? ({
                              '--culture':
                                CULTURES[member.culture as Culture]?.color,
                            } as CSSProperties)
                          : undefined
                      }
                      className={member ? 'is-filled' : undefined}
                    >
                      <span className="ops-slot">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {member ? (
                        <>
                          <div>
                            <strong>
                              {member.name}
                              {member.id === viewerId ? ' (you)' : ''}
                            </strong>
                            <span>
                              {CULTURES[member.culture as Culture]?.name ??
                                member.culture}
                            </span>
                          </div>
                          {member.id === lobby.hostId && (
                            <span className="ops-host">
                              <Crown size={15} /> Host
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="ops-muted">Open slot</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
            <section aria-label="Lobby configuration">
              <MapSelect
                compact
                value={lobby.mapId}
                disabled={busy || !host}
                onChange={(mapId) => void settings({ mapId })}
              />
              <OperationSettings
                mapId={lobby.mapId}
                value={lobby.difficulty}
                enemyCount={lobby.enemyCount}
                playerSlots={lobby.maxPlayers}
                onEnemyCountChange={(enemyCount) =>
                  void settings({ enemyCount })
                }
                locked={!host}
                disabled={busy}
                onChange={(difficulty) => void settings({ difficulty })}
              />
              <PlayerLimit
                value={lobby.maxPlayers}
                minimum={lobby.count}
                disabled={busy || !host}
                onChange={(maxPlayers) => void settings({ maxPlayers })}
              />
              <p className="ops-muted">
                A fresh {battlefield.name} battlefield is generated at launch.
                The clock and enemy attacks wait until then.
              </p>
            </section>
          </div>
          {/* Pinned to the bottom of the scroll view so the launch control stays
              in reach however long the roster and map picker grow. */}
          <footer className="ops-lobby-actions">
            {host ? (
              <Button
                className="tac-primary"
                disabled={busy}
                onClick={() =>
                  void run(() => start({ token, lobbyId: lobby.id }))
                }
              >
                {busy
                  ? 'Preparing…'
                  : `Start operation · ${lobby.count} ${lobby.count === 1 ? 'player' : 'players'}`}
                <ArrowRight size={18} />
              </Button>
            ) : (
              <output className="ops-waiting">
                <Radio size={18} /> Waiting for the host to start…
              </output>
            )}
            <Button
              variant="ghost"
              className="ops-leave"
              disabled={busy}
              onClick={() =>
                void run(() => leave({ token, lobbyId: lobby.id }))
              }
            >
              Leave lobby
            </Button>
          </footer>
        </section>
        <SponsorWall placement="operations" />
      </div>
    </main>
  );
}
