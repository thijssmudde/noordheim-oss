'use client';
import {
  ConvexProvider,
  ConvexReactClient,
  useMutation,
  useQuery,
} from 'convex/react';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { MapId } from '@/lib/battlefields';
import { GameOver } from './game-over';
import { LobbyPage } from './lobby-page';
import type { FunctionReturnType } from 'convex/server';
import { Mountain } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { JoinGame } from './join-game';
import TacticalCommand from './tactical-command';
import { GameAudioProvider } from './game-audio';
import { BuildHopWidget } from './buildhop-widget';
import { usePlayerSession } from './player-session';
import { ConvexBattleSource, LocalBattleSource } from './battle-source';
import {
  isVictory,
  OperationProvider,
  type Operation,
  type OperationSummary,
} from './operation-source';
import {
  localOperation,
  subscribeLocalOperation,
  type LocalOperation,
} from './local-operation';
import { saveLaunchSettings, useLaunchSettings } from './launch-settings';
const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
export default function Game() {
  return (
    <ConvexProvider client={client}>
      <GameAudioProvider>
        <NorthernCommand />
      </GameAudioProvider>
    </ConvexProvider>
  );
}
function NorthernCommand() {
  const { mapId } = useLaunchSettings();
  const setMapId = (next: MapId) => saveLaunchSettings({ mapId: next });
  const token = usePlayerSession();
  const player = useQuery(api.players.session, token ? { token } : 'skip');
  if (token !== null && (!token || player === null))
    return (
      <>
        <JoinGame
          missingPlayer={Boolean(token)}
          mapId={mapId}
          onMapChange={setMapId}
        />
        <BuildHopWidget />
      </>
    );
  if (!player || !token)
    return (
      <div className="realm-loading">
        <div className="loading-crest">
          <Mountain size={44} />
        </div>
        <h1>NOORDHEIM</h1>
        <p>Raising Northern Command…</p>
        <BuildHopWidget />
      </div>
    );
  return (
    <OperationGate
      key={token}
      player={player}
      token={token}
      mapId={mapId}
      setMapId={setMapId}
    />
  );
}

function OperationGate(props: GateProps) {
  const local = useSyncExternalStore(
    subscribeLocalOperation,
    () => localOperation(props.player._id),
    () => null,
  );
  // A solo operation in this browser needs nothing from Convex until it ends.
  return local ? (
    <LocalGate key={local.id} operation={local} {...props} />
  ) : (
    <ServerGate {...props} />
  );
}

type GateProps = {
  player: NonNullable<FunctionReturnType<typeof api.players.session>>;
  token: string;
  mapId: MapId;
  setMapId: (mapId: MapId) => void;
};

function Contacting() {
  return (
    <div className="realm-loading">
      <Mountain size={40} />
      <p>Contacting Northern Command…</p>
      <BuildHopWidget />
    </div>
  );
}

function ServerGate(props: GateProps) {
  const { token } = props;
  const overview = useQuery(api.operations.overview, { token });
  const leave = useMutation(api.operations.withdraw);
  const battle = overview?.battle;
  const operation = useMemo(
    () =>
      battle
        ? { battle, withdraw: () => leave({ token, sectorId: battle.id }) }
        : null,
    [battle, leave, token],
  );
  if (!overview) return <Contacting />;
  return (
    <OperationScreens
      {...props}
      operation={operation}
      overview={overview}
      source={(hud) => (
        <ConvexBattleSource token={token}>{hud}</ConvexBattleSource>
      )}
    />
  );
}

function LocalGate({
  operation: local,
  ...props
}: GateProps & { operation: LocalOperation }) {
  const battle = useSyncExternalStore(
    local.subscribeSummary,
    () => local.summary,
    () => undefined,
  );
  const operation = useMemo(
    () =>
      battle
        ? {
            battle: battle as OperationSummary,
            withdraw: () => local.withdraw(),
          }
        : null,
    [battle, local],
  );
  if (battle === undefined) return <Contacting />;
  return (
    <OperationScreens
      {...props}
      operation={operation}
      overview={null}
      source={(hud) => (
        <LocalBattleSource operation={local}>{hud}</LocalBattleSource>
      )}
    />
  );
}

/** The debrief, the HUD, the lobby or the launcher, whichever source runs the operation. */
function OperationScreens({
  player,
  token,
  mapId,
  setMapId,
  operation,
  overview,
  source,
}: GateProps & {
  operation: Operation | null;
  overview: FunctionReturnType<typeof api.operations.overview> | null;
  source: (hud: ReactNode) => ReactNode;
}) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // A win holds on the battlefield for its banner before the debrief takes over.
  const [debriefFor, setDebriefFor] = useState<string | null>(null);
  const battle = operation?.battle;
  const lobby = overview?.lobby;
  const won = !!battle && isVictory(battle);
  const over = won ? debriefFor === battle.id : !!battle?.gameOver;
  const live = battle && !over && menuFor !== battle.id && !lobby;
  return (
    <OperationProvider operation={operation}>
      {/* Feedback stays off the battlefield: only the menus get the launcher. */}
      {!live && <BuildHopWidget />}
      {battle && over && !lobby ? (
        <GameOver key={battle.id} />
      ) : live ? (
        source(
          <TacticalCommand
            key={battle.id}
            player={player}
            token={token}
            onOperations={() => setMenuFor(battle.id)}
            onDebrief={() => setDebriefFor(battle.id)}
          />,
        )
      ) : lobby ? (
        <LobbyPage
          key={lobby.id}
          token={token}
          name={player.name}
          viewerId={overview.viewerId}
          lobby={lobby}
        />
      ) : (
        <JoinGame
          mapId={mapId}
          onMapChange={setMapId}
          player={player}
          token={token}
          overview={overview}
          onResume={() => setMenuFor(null)}
        />
      )}
    </OperationProvider>
  );
}
