'use client';

import {
  createContext,
  use,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type {
  SectorAction,
  SectorActions,
  SectorResults,
} from '@/lib/local-sector';
import type { LocalOperation } from './local-operation';

/**
 * Where the tactical HUD reads its sector and sends its orders. Convex serves
 * co-op operations, a worker in this browser serves solo ones, and the
 * interface review serves a fixture. All three look the same to the HUD:
 * the projection `api.tactics.state` returns plus the nine sector actions.
 */
export type TacticalState = NonNullable<
  FunctionReturnType<typeof api.tactics.state>
>;
export type BattleActions = {
  [A in SectorAction]: (args: SectorActions[A]) => Promise<SectorResults[A]>;
} & {
  /** Whether per-sector memories (explored fog, control groups) are stored. */
  persistent: boolean;
};

const StateContext = createContext<{
  state: TacticalState | null | undefined;
} | null>(null);
const ActionsContext = createContext<BattleActions | null>(null);

/** The sector as the viewer sees it: undefined while loading, null without one. */
export function useBattleState() {
  const value = use(StateContext);
  if (!value) throw new Error('useBattleState needs a battle source.');
  return value.state;
}
export function useBattleActions() {
  const value = use(ActionsContext);
  if (!value) throw new Error('useBattleActions needs a battle source.');
  return value;
}

function BattleSource({
  state,
  actions,
  children,
}: {
  state: TacticalState | null | undefined;
  actions: BattleActions;
  children: ReactNode;
}) {
  return (
    <ActionsContext value={actions}>
      <StateContext value={{ state }}>{children}</StateContext>
    </ActionsContext>
  );
}

export function ConvexBattleSource({
  token,
  children,
}: {
  token: string;
  children: ReactNode;
}) {
  const state = useQuery(api.tactics.state, { token });
  const produce = useMutation(api.tactics.produce),
    cancelTroops = useMutation(api.tactics.cancelTroops),
    research = useMutation(api.tactics.research),
    abandonResearch = useMutation(api.tactics.abandonResearch),
    sell = useMutation(api.tactics.sell),
    rally = useMutation(api.tactics.rally),
    rallyCategory = useMutation(api.tactics.rallyCategory),
    // Route finding belongs to the simulation (Convex here, the worker for
    // solo play); replaying it on the page blocks the render loop.
    command = useMutation(api.tactics.command),
    launch = useMutation(api.tactics.launch);
  const sectorId = state?.id;
  const actions = useMemo<BattleActions>(() => {
    const scope = { token, sectorId: sectorId as Id<'sectors'> };
    return {
      persistent: true,
      produce: (args) => produce({ ...scope, ...args }),
      cancelTroops: (args) => cancelTroops({ ...scope, ...args }),
      research: (args) => research({ ...scope, ...args }),
      abandonResearch: (args) => abandonResearch({ ...scope, ...args }),
      sell: (args) => sell({ ...scope, ...args }),
      rally: (args) => rally({ ...scope, ...args }),
      rallyCategory: (args) => rallyCategory({ ...scope, ...args }),
      command: (args) => command({ ...scope, ...args }),
      launch: (args) => launch({ ...scope, ...args }),
    };
  }, [
    token,
    sectorId,
    produce,
    cancelTroops,
    research,
    abandonResearch,
    sell,
    rally,
    rallyCategory,
    command,
    launch,
  ]);
  return (
    <BattleSource state={state} actions={actions}>
      {children}
    </BattleSource>
  );
}

export function LocalBattleSource({
  operation,
  children,
}: {
  operation: LocalOperation;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(
    operation.subscribeState,
    () => operation.state,
    () => undefined,
  );
  const actions = useMemo<BattleActions>(
    () => ({
      persistent: true,
      produce: (args) => operation.act('produce', args),
      cancelTroops: (args) => operation.act('cancelTroops', args),
      research: (args) => operation.act('research', args),
      abandonResearch: (args) => operation.act('abandonResearch', args),
      sell: (args) => operation.act('sell', args),
      rally: (args) => operation.act('rally', args),
      rallyCategory: (args) => operation.act('rallyCategory', args),
      command: (args) => operation.act('command', args),
      launch: (args) => operation.act('launch', args),
    }),
    [operation],
  );
  return (
    <BattleSource
      state={state as TacticalState | null | undefined}
      actions={actions}
    >
      {children}
    </BattleSource>
  );
}

const preview = async () => {
  throw new Error(
    'This is the interface preview. Return to the game to issue live orders.',
  );
};
const REVIEW_ACTIONS: BattleActions = {
  persistent: false,
  produce: preview,
  cancelTroops: preview,
  research: preview,
  abandonResearch: preview,
  sell: preview,
  rally: preview,
  rallyCategory: preview,
  command: preview,
  launch: preview,
};
/** The development interface fixture: a fixed sector that refuses every order. */
export function ReviewBattleSource({
  state,
  children,
}: {
  state: TacticalState;
  children: ReactNode;
}) {
  return (
    <BattleSource state={state} actions={REVIEW_ACTIONS}>
      {children}
    </BattleSource>
  );
}
