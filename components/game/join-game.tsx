'use client';

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type SubmitEvent,
} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useConvex, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import { AttractBackdrop } from './battlefield-backdrop';
import { OperationSettings } from './operation-settings';
import { BATTLEFIELDS, mapIds, type MapId } from '@/lib/battlefields';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  KeyRound,
  Play,
  Radio,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { CULTURES, cultureKeys, type Culture } from '../../lib/cultures';
import {
  createPlayerKey,
  isPlayerKey,
  normalizeRecoveryKey,
} from '../../lib/player-identity';
import { MAIN_SPONSOR } from '@/lib/sponsorship';
import { Input } from '../ui/input';
import { DIFFICULTIES, type Difficulty } from '@/lib/tactical-difficulty';
import type { SkirmishMode } from '@/lib/skirmish-modes';
import { rememberPlayer } from './player-session';
import { saveLaunchSettings, useLaunchSettings } from './launch-settings';
import { sponsorHref } from './sponsor-credit';
import { useOperation } from './operation-source';
import { launchLocalOperation } from './local-operation';
import { CommanderPortrait } from './commander-portrait';
import { commanderFor } from '@/lib/commanders';
import { HowToPlayDialog } from './how-to-play';

type Overview = FunctionReturnType<typeof api.operations.overview>;

/** A map's player and enemy capacity; maps without one allow the classic eight. */
export function capacityOf(mapId: MapId) {
  const info = BATTLEFIELDS[mapId] as {
    capacity?: { players: number; enemies: number };
  };
  return info.capacity ?? { players: 8, enemies: 8 };
}

type Sheet = null | 'commander' | 'operation' | 'coop' | 'recover';

/**
 * The home screen is a game launcher: the live battlefield fills the screen
 * with only the wordmark, one line, a map picker and Play over it. Pressing
 * Play opens a focused sheet: callsign and faction for a new commander, then
 * the operation (difficulty, enemy armies, Deploy). Co-op sits beside it and
 * leads to the lobby sheet: create a lobby, enter a join code or pick an open
 * one. An enrolled commander deploys or resumes in one click.
 */
export function JoinGame({
  missingPlayer = false,
  mapId,
  onMapChange,
  player = null,
  token = null,
  overview = null,
  onResume,
}: {
  missingPlayer?: boolean;
  mapId: MapId;
  onMapChange: (mapId: MapId) => void;
  player?: { name: string; culture: string } | null;
  token?: string | null;
  overview?: Overview | null;
  onResume?: () => void;
}) {
  const lobby = useQuery(api.players.lobby, {});
  const connect = useMutation(api.players.connect),
    solo = useMutation(api.operations.solo),
    create = useMutation(api.operations.createLobby),
    join = useMutation(api.operations.joinLobby);
  const convex = useConvex();
  const operation = useOperation();
  const enrolled = Boolean(player && token);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [guide, setGuide] = useState(false);
  // Where the commander step continues: a solo operation or the co-op lobby.
  const [after, setAfter] = useState<'operation' | 'coop'>('operation');
  const [name, setName] = useState('');
  const [culture, setCulture] = useState<Culture>('fjordborn');
  const [recovery, setRecovery] = useState('');
  // Difficulty, enemy count and mission are remembered across games and reloads.
  const { difficulty, enemyCount, mode } = useLaunchSettings();
  const setDifficulty = (next: Difficulty) =>
    saveLaunchSettings({ difficulty: next });
  const setEnemyCount = (next: number) =>
    saveLaunchSettings({ enemyCount: next });
  const setMode = (next: SkirmishMode) => saveLaunchSettings({ mode: next });
  const [lobbyName, setLobbyName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidate = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const capacity = capacityOf(mapId);
  // Enemy count and lobby size never exceed what the chosen map can hold.
  const enemies = Math.max(1, Math.min(enemyCount, capacity.enemies));
  const returning = !enrolled && sheet === 'recover';

  function open(next: Sheet) {
    if (next === 'operation' || next === 'coop') setAfter(next);
    setSheet(next);
    setError('');
  }

  /** Start a path, enrolling a commander first when there is none. */
  function begin(next: 'operation' | 'coop') {
    setAfter(next);
    open(enrolled ? next : 'commander');
  }

  /** The session key to act with: the enrolled commander's, or a fresh enrolment. */
  async function enrol() {
    if (enrolled) return token!;
    if (returning) {
      const key = normalizeRecoveryKey(recovery);
      if (!isPlayerKey(key)) throw new Error('Enter your full recovery key.');
      const found = await convex.query(api.players.session, { token: key });
      if (!found) throw new Error('No commander matches that key.');
      rememberPlayer(key);
      return key;
    }
    if (name.trim().length < 2) {
      setSheet('commander');
      throw new Error('Choose a callsign of at least two characters.');
    }
    candidate.current ??= createPlayerKey();
    await connect({ token: candidate.current, name, culture });
    rememberPlayer(candidate.current);
    return candidate.current;
  }

  async function run(action?: (key: string) => Promise<unknown>) {
    if (busy) return;
    if (form.current && !form.current.reportValidity()) return;
    setBusy(true);
    setError('');
    try {
      const key = await enrol();
      if (action) await action(key);
    } catch (cause) {
      const message =
        cause instanceof ConvexError
          ? String(cause.data)
          : cause instanceof Error
            ? cause.message
            : 'Could not reach Northern Command. Try again.';
      setError(message.replace(/^[\s\S]*ConvexError: /, '').split('\n')[0]);
    } finally {
      setBusy(false);
    }
  }

  /**
   * A solo skirmish runs in this browser; Convex only confirms who commands
   * it. `?engine=server` keeps the hosted simulation for comparison, which
   * plays standard rules only.
   */
  async function skirmish(key: string) {
    if (new URLSearchParams(location.search).get('engine') === 'server')
      return solo({ token: key, difficulty, enemyCount: enemies, mapId });
    const commander = await convex.query(api.players.session, { token: key });
    if (!commander)
      throw new Error('Reconnect to Noordheim to command a sector.');
    if (operation?.battle.status === 'active')
      throw new Error(
        'Withdraw from your current operation before starting another.',
      );
    // A finished operation still selected on the server would return after this one.
    if (operation) await operation.withdraw();
    launchLocalOperation(
      {
        id: commander._id,
        name: commander.name,
        culture: commander.culture,
      },
      {
        difficulty,
        mapId,
        enemyCount: enemies,
        seed: Math.floor(Math.random() * 4294967296),
        mode,
      },
    );
  }
  const deploy = () => run(skirmish);
  const host = (key: string) =>
    create({
      token: key,
      difficulty,
      mapId,
      enemyCount: enemies,
      maxPlayers: Math.max(2, capacity.players),
      name: lobbyName.trim() || undefined,
    });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sheet === 'commander') {
      open(after);
      return;
    }
    if (sheet === 'coop') {
      void run((key) =>
        code.trim().length === 6 ? join({ token: key, code }) : host(key),
      );
      return;
    }
    // A returning commander only reconnects; a deploy starts a skirmish at once.
    void run(returning ? undefined : skirmish);
  }

  const battle = operation?.battle ?? null;
  const active = battle?.status === 'active';
  const index = mapIds.indexOf(mapId);
  function step(by: number) {
    if (busy || active) return;
    const next = mapIds[(index + by + mapIds.length) % mapIds.length];
    onMapChange(next);
  }

  // Esc closes the sheet; ← → change the battlefield on the title screen.
  // Focus the first field whenever a sheet step opens.
  useEffect(() => {
    if (sheet)
      form.current
        ?.querySelector<HTMLElement>(
          'input:not([type=radio]), button[type=submit]',
        )
        ?.focus();
  }, [sheet]);
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (guide) return;
    if (e.key === 'Escape' && sheet) setSheet(null);
    const typing =
      e.target instanceof HTMLElement &&
      e.target.closest('input, select, textarea, [role=radiogroup]');
    if (!sheet && !typing && e.key === 'ArrowLeft') step(-1);
    if (!sheet && !typing && e.key === 'ArrowRight') step(1);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const live = lobby?.operation?.status === 'active';
  const status = !lobby
    ? null
    : live
      ? `${lobby.operation!.commanders} in the field`
      : lobby.playerCount
        ? `${lobby.playerCount} ${lobby.playerCount === 1 ? 'commander' : 'commanders'} online`
        : null;
  const battlefield = BATTLEFIELDS[mapId];
  const chosen = CULTURES[culture];
  const faction =
    player && player.culture in CULTURES
      ? CULTURES[player.culture as Culture]
      : null;

  return (
    <main
      className="launcher"
      data-sheet={sheet ?? undefined}
      style={
        {
          '--map-accent': battlefield.accent,
          position: 'fixed',
          inset: 0,
          isolation: 'isolate',
        } as CSSProperties
      }
    >
      <AttractBackdrop mapId={mapId} />

      <nav className="launcher-top" aria-label="Noordheim">
        {status && (
          <span className="launcher-status">
            <span className={`live-dot ${live ? 'is-live' : ''}`} />
            {status}
          </span>
        )}
        <span className="launcher-links">
          {!enrolled && (
            <button type="button" onClick={() => open('recover')}>
              <KeyRound size={13} /> Recovery key
            </button>
          )}
          <Link href="/sponsor">Sponsor</Link>
        </span>
      </nav>

      <section className="launcher-title" aria-labelledby="launcher-name">
        <h1 id="launcher-name">NOORDHEIM</h1>
        <p>Cold War strategy on a living diorama. Free, in your browser.</p>

        {active && battle ? (
          <div className="launcher-actions">
            <button className="launcher-play" type="button" onClick={onResume}>
              <Play size={20} fill="currentColor" /> Resume
            </button>
            <button
              type="button"
              className="launcher-quiet"
              disabled={busy}
              onClick={() => void run(() => operation!.withdraw())}
            >
              Withdraw from {BATTLEFIELDS[battle.mapId]?.name ?? 'operation'}
            </button>
          </div>
        ) : (
          <div className="launcher-actions">
            <button
              className="launcher-play"
              type="button"
              disabled={busy || lobby === undefined}
              onClick={() => (enrolled ? void deploy() : begin('operation'))}
            >
              <Play size={20} fill="currentColor" />
              {busy ? 'Deploying…' : enrolled ? 'Deploy' : 'Play'}
            </button>
            <button
              className="launcher-play is-coop"
              type="button"
              disabled={busy || lobby === undefined}
              onClick={() => begin('coop')}
            >
              <Users size={22} />
              Co-op
              {!!lobby?.openLobbies && (
                <span className="launcher-play-badge">
                  {lobby.openLobbies} open
                </span>
              )}
            </button>
            {enrolled && (
              <button
                type="button"
                className="launcher-quiet"
                onClick={() => open('operation')}
              >
                Operation settings
              </button>
            )}
          </div>
        )}
        {!active && (
          <div className="launcher-modes">
            <p>
              <strong>{enrolled ? 'Deploy' : 'Play'}</strong> starts a solo
              battle against AI armies right away.
            </p>
            <p>
              <strong>Co-op</strong> opens a lobby where friends join you to
              fight the AI together.
            </p>
            <button
              type="button"
              className="launcher-guide"
              onClick={() => setGuide(true)}
            >
              <BookOpen size={16} /> How to play
            </button>
          </div>
        )}
        {enrolled && (
          <p
            className="launcher-commander"
            style={{ '--culture': faction?.color } as CSSProperties}
          >
            {player!.name} · {faction?.name ?? player!.culture}
          </p>
        )}
        {error && !sheet && (
          <p className="launcher-error" role="alert">
            {error}
          </p>
        )}
        {battle && !active && (
          <p className="launcher-note">
            {battle.status === 'victory'
              ? 'Sector secured. Choose your next battlefield.'
              : 'Operation ended. Assemble a new task force.'}
          </p>
        )}
      </section>

      <nav
        className="launcher-maps"
        aria-label="Battlefield"
        data-disabled={busy || active || undefined}
      >
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={busy || active}
          aria-label="Previous battlefield"
        >
          <ChevronLeft size={22} />
        </button>
        <div className="launcher-map" aria-live="polite">
          <strong>{battlefield.name}</strong>
          <span>
            {capacity.players === 1
              ? 'Solo'
              : `Up to ${capacity.players} commanders`}{' '}
            · {capacity.enemies}{' '}
            {capacity.enemies === 1 ? 'enemy army' : 'enemy armies'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={busy || active}
          aria-label="Next battlefield"
        >
          <ChevronRight size={22} />
        </button>
        <div
          className="launcher-dots"
          role="radiogroup"
          aria-label="Battlefields"
        >
          {mapIds.map((id) => (
            <label key={id} title={BATTLEFIELDS[id].name}>
              <input
                type="radio"
                name="launcher-map"
                checked={id === mapId}
                aria-label={BATTLEFIELDS[id].name}
                disabled={busy || active}
                onChange={() => step(mapIds.indexOf(id) - index)}
              />
            </label>
          ))}
        </div>
      </nav>

      <HowToPlayDialog open={guide} onOpenChange={setGuide} />

      <footer className="launcher-credit">
        <a
          href={sponsorHref('entrance')}
          target="_blank"
          rel="sponsored noopener noreferrer"
          data-sponsor={MAIN_SPONSOR.name}
          data-placement="entrance"
        >
          <Image
            src={MAIN_SPONSOR.icon}
            alt=""
            width={14}
            height={14}
            unoptimized
          />
          Supported by <strong>{MAIN_SPONSOR.name}</strong>
        </a>
        <Link href="/sponsor">Your brand here</Link>
      </footer>

      {sheet && (
        <div className="launcher-scrim">
          <form
            ref={form}
            className={`launcher-sheet is-${sheet}`}
            aria-label={
              sheet === 'commander'
                ? 'Choose your commander'
                : sheet === 'recover'
                  ? 'Returning commander'
                  : sheet === 'coop'
                    ? 'Co-op lobby'
                    : 'Operation'
            }
            onSubmit={submit}
          >
            <header>
              {(sheet === 'operation' || sheet === 'coop') && !enrolled ? (
                <button
                  type="button"
                  className="launcher-icon"
                  onClick={() => open('commander')}
                  aria-label="Back to commander"
                >
                  <ArrowLeft size={18} />
                </button>
              ) : (
                <span />
              )}
              <ol className="launcher-steps" aria-hidden="true">
                {sheet === 'recover' ? (
                  <li className="is-current">Returning commander</li>
                ) : (
                  <>
                    {!enrolled && (
                      <li className={sheet === 'commander' ? 'is-current' : ''}>
                        Commander
                      </li>
                    )}
                    <li
                      className={
                        sheet === 'operation' || sheet === 'coop'
                          ? 'is-current'
                          : ''
                      }
                    >
                      {after === 'coop' ? 'Co-op lobby' : 'Operation'}
                    </li>
                  </>
                )}
              </ol>
              <button
                type="button"
                className="launcher-icon"
                onClick={() => setSheet(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </header>

            {sheet === 'commander' && (
              <div className="launcher-commander-step">
                {missingPlayer && (
                  <p className="launcher-note">
                    Your saved commander is gone. Enrol a new one or use a
                    recovery key.
                  </p>
                )}
                <label className="launcher-field" htmlFor="ruler-name">
                  <span>Callsign</span>
                  <Input
                    id="ruler-name"
                    autoComplete="nickname"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={30}
                    placeholder="Commander name"
                    disabled={busy}
                  />
                </label>
                <fieldset className="launcher-factions" disabled={busy}>
                  <legend>Faction</legend>
                  <div className="launcher-faction-tabs">
                    {cultureKeys.map((c) => (
                      <label
                        key={c}
                        className={culture === c ? 'is-selected' : ''}
                        style={
                          { '--culture': CULTURES[c].color } as CSSProperties
                        }
                      >
                        <input
                          type="radio"
                          name="culture"
                          value={c}
                          checked={culture === c}
                          onChange={() => setCulture(c)}
                        />
                        <CommanderPortrait culture={c} />
                        {CULTURES[c].name}
                      </label>
                    ))}
                  </div>
                  <div
                    className="launcher-faction"
                    style={{ '--culture': chosen.color } as CSSProperties}
                    aria-live="polite"
                  >
                    <div className="launcher-faction-commander">
                      <CommanderPortrait culture={culture} />
                      <div>
                        <span>Your voice on the radio</span>
                        <strong>{commanderFor(culture).name}</strong>
                        <p>{chosen.description}</p>
                      </div>
                    </div>
                    <section className="launcher-doctrine">
                      <header>
                        <strong>{chosen.title}</strong>
                        <span>{chosen.doctrine.name}</span>
                      </header>
                      <ul key={culture}>
                        {chosen.doctrine.perks.map((perk) => (
                          <li key={perk}>
                            <ChevronsUp size={18} aria-hidden="true" />
                            {/* The percentage is the benefit, so it reads first. */}
                            <span>
                              {perk
                                .split(/(\d+%)/)
                                .map((part, i) =>
                                  i % 2 ? <b key={i}>{part}</b> : part,
                                )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                </fieldset>
                {error && (
                  <p className="launcher-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="launcher-primary" type="submit">
                  Continue <ArrowRight size={18} />
                </button>
              </div>
            )}

            {sheet === 'recover' && (
              <div className="launcher-recover-step">
                <label className="launcher-field" htmlFor="recovery-key">
                  <span>Recovery key</span>
                  <Input
                    id="recovery-key"
                    type="password"
                    autoComplete="off"
                    value={recovery}
                    onChange={(e) => setRecovery(e.target.value)}
                    required
                    spellCheck={false}
                    placeholder="Paste your recovery key"
                    disabled={busy}
                  />
                </label>
                <p className="launcher-hint">
                  Your key is in the field manual of the device you played on.
                </p>
                {error && (
                  <p className="launcher-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="launcher-primary"
                  type="submit"
                  disabled={busy || lobby === undefined}
                >
                  {busy ? 'Connecting…' : 'Resume command'}
                  <ArrowRight size={18} />
                </button>
                <button
                  type="button"
                  className="launcher-quiet"
                  onClick={() => open('commander')}
                >
                  Enrol a new commander instead
                </button>
              </div>
            )}

            {sheet === 'operation' && (
              <div className="launcher-operation-step">
                <div className="launcher-operation-map">
                  <span>Battlefield</span>
                  <strong>{battlefield.name}</strong>
                  <em>{battlefield.tagline}</em>
                </div>
                <OperationSettings
                  mapId={mapId}
                  value={difficulty}
                  enemyCount={enemies}
                  onEnemyCountChange={(n) =>
                    setEnemyCount(Math.max(1, Math.min(n, capacity.enemies)))
                  }
                  onChange={setDifficulty}
                  mode={mode}
                  onModeChange={setMode}
                  locked={false}
                  disabled={busy}
                />
                {error && (
                  <p className="launcher-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="launcher-primary"
                  type="submit"
                  disabled={busy || lobby === undefined}
                >
                  {busy ? 'Deploying…' : 'Deploy task force'}
                  <Play size={16} fill="currentColor" />
                </button>
                <button
                  type="button"
                  className="launcher-quiet"
                  onClick={() => open('coop')}
                >
                  <Users size={14} /> Play co-op instead
                </button>
              </div>
            )}

            {sheet === 'coop' && (
              <div className="launcher-coop-step">
                <div className="launcher-operation-map">
                  <span>Co-op · {battlefield.name}</span>
                  <strong>Command together.</strong>
                  <em>
                    Host a lobby and share its code, or join a friend&apos;s.
                    The host picks the map and settings before launch.
                  </em>
                </div>
                <label className="launcher-field" htmlFor="coop-code">
                  <span>Join with a code</span>
                  <div className="launcher-row">
                    <Input
                      id="coop-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={6}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className="launcher-secondary"
                      disabled={busy || code.trim().length !== 6}
                      onClick={() =>
                        void run((key) => join({ token: key, code }))
                      }
                    >
                      Join lobby
                    </button>
                  </div>
                </label>
                {overview && overview.openLobbies.length > 0 && (
                  <div className="launcher-field">
                    <span>Open lobbies</span>
                    <ul className="launcher-lobbies">
                      {overview.openLobbies.map((room) => (
                        <li key={room.id}>
                          <span>
                            <Radio size={13} />
                            <strong>{room.name}</strong>
                            <em>
                              {BATTLEFIELDS[room.mapId]?.name} ·{' '}
                              {DIFFICULTIES[room.difficulty].name} ·{' '}
                              {room.count}/{room.maxPlayers}
                            </em>
                          </span>
                          <button
                            type="button"
                            className="launcher-secondary"
                            disabled={busy}
                            aria-label={`Join ${room.name}`}
                            onClick={() =>
                              void run((key) =>
                                join({ token: key, code: room.code }),
                              )
                            }
                          >
                            Join
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="launcher-field" htmlFor="coop-name">
                  <span>Or host your own</span>
                  <Input
                    id="coop-name"
                    value={lobbyName}
                    onChange={(e) => setLobbyName(e.target.value)}
                    placeholder={`${player?.name || name || 'Commander'}'s lobby`}
                    maxLength={48}
                    disabled={busy}
                  />
                </label>
                {error && (
                  <p className="launcher-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="launcher-primary"
                  type="button"
                  disabled={busy || lobby === undefined}
                  onClick={() => void run(host)}
                >
                  {busy ? 'Opening…' : 'Create lobby'}
                  <ArrowRight size={18} />
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </main>
  );
}
