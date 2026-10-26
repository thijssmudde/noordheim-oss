import {
  TACTICAL_TICK_MS,
  cancelResearch,
  cancelTraining,
  commanderEliminated,
  joinBattle,
  migrateTraining,
  newBattle,
  purchase,
  research,
  sellStructure,
  setCategoryRally,
  setRally,
  tickBattle,
  validateOrder,
  type Battle,
  type EntityKind,
  type OrderKind,
  type PendingBattleOrder,
  type ResearchKey,
  type UnitCategory,
} from './tactics';
import { launchSuperweapon } from './tactical-superweapons';
import {
  ELIMINATED,
  ORDER_DISPATCH_MS,
  ORDER_QUEUE_LIMIT,
  coalescedOrder,
  dispatchOrder,
  operationSummary,
  persistedBattle,
  sectorView,
  shiftTimers,
  withdrawCommander,
} from './tactical-sector';
import type { Point } from './tactical-terrain';
import type { Difficulty } from './tactical-difficulty';
import type { MapId } from './battlefields';
import { DEFAULT_SKIRMISH_MODE, type SkirmishMode } from './skirmish-modes';

/**
 * A solo operation simulated in the browser. It mirrors the Convex flow in
 * convex/tactics.ts: every action runs as a transaction against the battle,
 * commands queue as intents (coalesced per squad, four per commander), and
 * each tick routes the oldest queued slice before advancing the battle,
 * ticking faster while orders wait. Time and timers are injected so tests can
 * drive it alongside the Convex functions.
 */

export type SectorClock = {
  now(): number;
  schedule(run: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
};
export type LocalViewer = { id: string; name: string; culture: string };
export type SoloOptions = {
  difficulty: Difficulty;
  mapId: MapId;
  enemyCount: number;
  seed: number;
  /** Skirmish mission; launches and saves from before modes are standard. */
  mode?: SkirmishMode;
};
/** Arguments of each sector action, as the Convex mutations take them minus token and sector. */
export type SectorActions = {
  produce: {
    kind: EntityKind;
    quantity?: number;
    placement?: { position: Point; rotation: number };
  };
  cancelTroops: { orderId: string };
  research: { key: ResearchKey };
  abandonResearch: { key?: ResearchKey };
  sell: { id: string };
  rally: { id: string; point: Point };
  rallyCategory: { category: UnitCategory; point: Point };
  command: {
    ids: string[];
    order: OrderKind;
    point?: Point;
    target?: string;
  };
  launch: { point: Point };
};
export type SectorAction = keyof SectorActions;
/** What each action resolves to: refunds and rally counts, as the mutations return them. */
export type SectorResults = {
  produce: void | null;
  cancelTroops: ReturnType<typeof cancelTraining>;
  research: void | null;
  abandonResearch: ReturnType<typeof cancelResearch>;
  sell: ReturnType<typeof sellStructure>;
  rally: void | null;
  rallyCategory: ReturnType<typeof setCategoryRally>;
  command: void | null;
  launch: void | null;
};
export type QueuedOrder = PendingBattleOrder & {
  selection: string[];
  issuedAt: number;
  /** Insertion order, standing in for Convex's creation time. */
  created: number;
};
/** Everything needed to pick an operation up again. */
export type SectorSave = {
  id: string;
  viewer: LocalViewer;
  battle: Battle;
  orders: QueuedOrder[];
};
export type LocalSectorView = NonNullable<ReturnType<LocalSector['view']>>;
export type LocalOperationSummary = NonNullable<
  ReturnType<LocalSector['summary']>
>;

/** The oldest intent first, as the Convex `by_sector_time` index orders them. */
const byIssue = (a: QueuedOrder, b: QueuedOrder) =>
  a.issuedAt - b.issuedAt || a.created - b.created;

export class LocalSector {
  private timer: { handle: unknown; due: number } | null = null;
  private running = false;
  private created: number;

  constructor(
    readonly id: string,
    readonly viewer: LocalViewer,
    public battle: Battle,
    private readonly clock: SectorClock,
    private readonly onTick: () => void = () => {},
    public orders: QueuedOrder[] = [],
  ) {
    migrateTraining(battle);
    this.created = Math.max(0, ...orders.map((o) => o.created));
  }

  /** A new solo operation, as `operations.solo` launches it. */
  static launch(
    id: string,
    viewer: LocalViewer,
    options: SoloOptions,
    clock: SectorClock,
    onTick?: () => void,
  ) {
    const now = clock.now();
    const { mode = DEFAULT_SKIRMISH_MODE, ...rest } = options;
    const battle = newBattle(now, { ...rest, skirmish: mode, playerSlots: 1 });
    joinBattle(battle, viewer, now);
    return new LocalSector(id, viewer, battle, clock, onTick);
  }

  /** A saved operation; the time it spent closed never counts against it. */
  static restore(save: SectorSave, clock: SectorClock, onTick?: () => void) {
    const sector = new LocalSector(
      save.id,
      save.viewer,
      save.battle,
      clock,
      onTick,
      save.orders,
    );
    if (sector.battle.status === 'active')
      shiftTimers(sector.battle, clock.now());
    return sector;
  }

  get ended() {
    return (
      this.battle.status !== 'active' ||
      commanderEliminated(this.battle, this.viewer.id)
    );
  }

  save(): SectorSave {
    return {
      id: this.id,
      viewer: this.viewer,
      battle: persistedBattle(this.battle),
      orders: this.orders,
    };
  }

  /** Start or resume the tick chain. */
  play() {
    if (this.running) return;
    this.running = true;
    if (this.timer) return;
    if (this.battle.status === 'active') {
      // A brief pause still never counts: timers move with the clock.
      if (this.clock.now() > this.battle.tickAt)
        shiftTimers(this.battle, this.clock.now());
      this.schedule(TACTICAL_TICK_MS);
    }
  }

  pause() {
    this.running = false;
    this.cancel();
  }

  /** One `tactics.tick`: route the oldest queued slice, then advance the battle. */
  tick() {
    this.timer = null;
    const b = this.battle;
    if (b.status !== 'active') return;
    const now = this.clock.now();
    const intent = this.orders.toSorted(byIssue)[0];
    if (intent) {
      if (dispatchOrder(b, intent, now)) intent.issuedAt = now;
      else this.orders = this.orders.filter((o) => o !== intent);
    }
    tickBattle(b, now);
    if (b.status !== 'active') this.orders = [];
    this.battle = persistedBattle(b);
    if (this.battle.status === 'active' && this.running)
      // Yield between routing slices without idling a full tick per squad.
      this.schedule(this.orders.length ? ORDER_DISPATCH_MS : TACTICAL_TICK_MS);
    this.onTick();
  }

  /** What `tactics.state` returns for the commander. */
  view() {
    const b = this.battle;
    if (!b.commanders.some((c) => c.id === this.viewer.id)) return null;
    return {
      ...sectorView(b, this.viewer.id, this.clock.now(), this.pending()),
      id: this.id,
      mode: 'solo' as const,
      openEnrollment: false,
      maxPlayers: 1,
    };
  }

  /** What `operations.overview` returns as its battle. */
  summary() {
    const b = this.battle;
    if (!b.commanders.some((c) => c.id === this.viewer.id)) return null;
    return {
      id: this.id,
      mode: 'solo' as const,
      // Like the Convex overview for standard rules; a mission names itself.
      ...(b.skirmish && { skirmish: b.skirmish }),
      ...operationSummary(b, this.viewer.id),
    };
  }

  /** Run one sector action as the matching Convex mutation would. */
  act<A extends SectorAction>(action: A, args: SectorActions[A]): unknown {
    if (action === 'command')
      return this.command(args as SectorActions['command']);
    return this.transact((b, owner, now) => {
      switch (action) {
        case 'produce': {
          const { kind, placement, quantity } =
            args as SectorActions['produce'];
          return void purchase(b, owner, kind, now, placement, quantity);
        }
        case 'cancelTroops':
          return cancelTraining(
            b,
            owner,
            (args as SectorActions['cancelTroops']).orderId,
            now,
          );
        case 'research':
          research(b, owner, (args as SectorActions['research']).key, now);
          return;
        case 'abandonResearch':
          return cancelResearch(
            b,
            owner,
            (args as SectorActions['abandonResearch']).key,
            now,
          );
        case 'sell':
          return sellStructure(
            b,
            owner,
            (args as SectorActions['sell']).id,
            now,
          );
        case 'rally': {
          const { id, point } = args as SectorActions['rally'];
          setRally(b, owner, id, point);
          return;
        }
        case 'rallyCategory': {
          const { category, point } = args as SectorActions['rallyCategory'];
          return setCategoryRally(b, owner, category, point);
        }
        case 'launch':
          launchSuperweapon(
            b,
            owner,
            (args as SectorActions['launch']).point,
            now,
          );
          return;
      }
      throw new Error(`Unknown sector action: ${String(action)}.`);
    });
  }

  /** `operations.withdraw`: leave the operation; the caller discards the sector. */
  withdraw() {
    if (!this.battle.commanders.some((c) => c.id === this.viewer.id))
      throw new Error('This is not your current operation.');
    if (this.battle.status === 'active') {
      withdrawCommander(this.battle, this.viewer, this.clock.now());
      this.battle = persistedBattle(this.battle);
    }
    this.pause();
  }

  /** Queue an intent; routing happens on the following ticks, never in the input path. */
  private command({ ids, order, point, target }: SectorActions['command']) {
    const b = this.battle,
      owner = this.viewer.id;
    this.guard();
    validateOrder(b, owner, ids, order, point, target);
    const pending = this.pending();
    const previous = coalescedOrder(pending, ids);
    const routingPending = this.orders.length > 0;
    const intent: QueuedOrder = {
      owner,
      ids: [...ids],
      selection: [...ids],
      order,
      point,
      target,
      issuedAt: this.clock.now(),
      created: previous?.created ?? ++this.created,
    };
    this.orders = previous
      ? this.orders.map((o) => (o === previous ? intent : o))
      : [...this.orders, intent];
    // Wake the tick chain once when the queue becomes nonempty.
    if (!routingPending) this.wake(ORDER_DISPATCH_MS);
  }

  /** The commander's own queue in creation order, as `by_sector_owner` reads it. */
  private pending() {
    return this.orders
      .filter((o) => o.owner === this.viewer.id)
      .slice(0, ORDER_QUEUE_LIMIT);
  }

  private guard() {
    if (!this.battle.commanders.some((c) => c.id === this.viewer.id))
      throw new Error('Join this operation before giving orders.');
    if (commanderEliminated(this.battle, this.viewer.id))
      throw new Error(ELIMINATED);
  }

  /** A failed action leaves the battle untouched, like a rolled-back mutation. */
  private transact<T>(fn: (b: Battle, owner: string, now: number) => T): T {
    this.guard();
    const before = structuredClone(this.battle);
    try {
      const result = fn(this.battle, this.viewer.id, this.clock.now());
      this.battle = persistedBattle(this.battle);
      return result;
    } catch (error) {
      this.battle = before;
      throw error;
    }
  }

  private schedule(ms: number) {
    this.cancel();
    this.timer = {
      due: this.clock.now() + ms,
      handle: this.clock.schedule(() => this.tick(), ms),
    };
  }

  /** Bring the next tick forward; an earlier tick already due wins, as the stale Convex callback would no-op. */
  private wake(ms: number) {
    if (!this.running) return;
    if (this.timer && this.timer.due <= this.clock.now() + ms) return;
    this.schedule(ms);
  }

  private cancel() {
    if (this.timer) this.clock.cancel(this.timer.handle);
    this.timer = null;
  }
}
