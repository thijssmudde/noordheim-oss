import {
  isUnit,
  powerFor,
  trainingBlockReason,
  trainingHead,
  type Battle,
  type OrderKind,
} from './tactics';
import { superweaponNotices } from './tactical-superweapons';
export const CUE_RULES = {
  deploy: { priority: 70, cooldown: 12000 },
  select: { priority: 10, cooldown: 4500 },
  move: { priority: 20, cooldown: 1800 },
  attack: { priority: 30, cooldown: 1800 },
  attackMove: { priority: 30, cooldown: 1800 },
  hold: { priority: 20, cooldown: 1800 },
  stop: { priority: 20, cooldown: 1800 },
  queued: { priority: 20, cooldown: 4500 },
  constructionReady: { priority: 50, cooldown: 7000 },
  unitReady: { priority: 45, cooldown: 6000 },
  armorReady: { priority: 50, cooldown: 6000 },
  enemySpotted: { priority: 55, cooldown: 25000 },
  underAttack: { priority: 75, cooldown: 22000 },
  baseUnderAttack: { priority: 90, cooldown: 18000 },
  unitLost: { priority: 65, cooldown: 14000 },
  lowPower: { priority: 80, cooldown: 25000 },
  powerRestored: { priority: 50, cooldown: 20000 },
  insufficient: { priority: 40, cooldown: 8000 },
  queueFull: { priority: 35, cooldown: 8000 },
  objective: { priority: 70, cooldown: 7000 },
  wave: { priority: 80, cooldown: 18000 },
  victory: { priority: 100, cooldown: 60000 },
  defeat: { priority: 100, cooldown: 60000 },
  radioCheck: { priority: 95, cooldown: 2000 },
} as const;
export type VoiceCue = keyof typeof CUE_RULES;
export type MusicMood = 'exploration' | 'combat';
export type RadioChatter = 'adaptive' | 'full' | 'alerts';
export type AudioPreferences = {
  muted: boolean;
  music: number;
  voice: number;
  effects: number;
  chatter: RadioChatter;
};
export const DEFAULT_AUDIO: AudioPreferences = {
  muted: false,
  music: 0.35,
  voice: 0.85,
  effects: 0.65,
  chatter: 'adaptive',
};
export function normalizePreferences(value: unknown): AudioPreferences {
  const p = (
    value && typeof value === 'object' ? value : {}
  ) as Partial<AudioPreferences>;
  const volume = (n: unknown, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n)
      ? Math.max(0, Math.min(1, n))
      : fallback;
  return {
    muted: typeof p.muted === 'boolean' ? p.muted : false,
    music: volume(p.music, 0.35),
    voice: volume(p.voice, 0.85),
    effects: volume(p.effects, 0.65),
    chatter:
      p.chatter === 'full' || p.chatter === 'alerts' ? p.chatter : 'adaptive',
  };
}
export const orderCue = (order: OrderKind): VoiceCue =>
  order === 'harvest' ? 'move' : order;
export function commandFailureCue(reason: string): VoiceCue | null {
  const text = reason.toLowerCase();
  if (text.includes('power')) return 'lowPower';
  if (text.includes('credits')) return 'insufficient';
  if (text.includes('queue') && text.includes('full')) return 'queueFull';
  return null;
}
function needsPower(b: Battle, owner: string) {
  const power = powerFor(b, owner);
  if (power.used > power.capacity) return true;
  return (['infantry', 'vehicle', 'air'] as const).some((category) => {
    const head = trainingHead(b, owner, category);
    return (
      head &&
      head.readyAt <= b.tickAt &&
      trainingBlockReason(b, owner, head.kind) === 'Waiting for grid power'
    );
  });
}
const orderCues = new Set<VoiceCue>([
  'select',
  'move',
  'attack',
  'attackMove',
  'hold',
  'stop',
]);
const routineCues = new Set<VoiceCue>([
  ...orderCues,
  'queued',
  'constructionReady',
  'unitReady',
  'armorReady',
  'powerRestored',
]);
export class RadioQueue {
  private pending: { cue: VoiceCue; at: number }[] = [];
  private last = new Map<VoiceCue, number>();
  private chatter: RadioChatter = 'adaptive';
  private elapsed = 0;
  private lastRoutine = -Infinity;
  private routineCounts = new Map<VoiceCue, number>();
  configure(chatter: RadioChatter, elapsed: number) {
    this.chatter = chatter;
    this.elapsed = Math.max(0, elapsed);
    this.pending = this.pending.filter((p) => this.allows(p.cue));
  }
  allows(cue: VoiceCue) {
    return (
      !routineCues.has(cue) ||
      this.chatter === 'full' ||
      (this.chatter === 'adaptive' && this.elapsed < 5 * 60000)
    );
  }
  enqueue(cue: VoiceCue, now: number) {
    if (!this.allows(cue)) return false;
    if (now - (this.last.get(cue) ?? -Infinity) < CUE_RULES[cue].cooldown)
      return false;
    this.last.set(cue, now);
    if (orderCues.has(cue))
      this.pending = this.pending.filter((p) => !orderCues.has(p.cue));
    if (CUE_RULES[cue].priority === 100) this.pending = [];
    this.pending = this.pending.filter((p) => p.cue !== cue);
    this.pending.push({ cue, at: now });
    this.pending.sort(
      (a, b) =>
        CUE_RULES[b.cue].priority - CUE_RULES[a.cue].priority || a.at - b.at,
    );
    this.pending = this.pending.slice(0, 4);
    return true;
  }
  next(now: number) {
    while (this.pending.length) {
      const p = this.pending.shift()!;
      if (
        !this.allows(p.cue) ||
        now - p.at >= (CUE_RULES[p.cue].priority >= 70 ? 14000 : 5000)
      )
        continue;
      if (routineCues.has(p.cue) && this.chatter === 'adaptive') {
        // One shared budget prevents alternating movement/training lines from
        // bypassing individual cooldowns. Drop stale chatter instead of delaying it.
        const gap = this.elapsed < 2 * 60000 ? 15000 : 30000;
        const count = this.routineCounts.get(p.cue) ?? 0;
        if (now - this.lastRoutine < gap || count >= 3) continue;
        this.lastRoutine = now;
        this.routineCounts.set(p.cue, count + 1);
      }
      return p.cue;
    }
    return null;
  }
  clear() {
    this.pending = [];
  }
  reset() {
    this.clear();
    this.last.clear();
    this.routineCounts.clear();
    this.lastRoutine = -Infinity;
    this.elapsed = 0;
  }
}
export type AudioBattle = Battle & { id: string };
/** Compare authoritative snapshots. Reconnecting never replays old field reports. */
export class BattleAudioDirector {
  private previous: AudioBattle | null = null;
  private combatUntil = 0;
  update(
    b: AudioBattle | null,
    owner: string,
  ): { cues: VoiceCue[]; mood: MusicMood } {
    if (!b || !b.commanders.some((c) => c.id === owner)) {
      this.previous = null;
      this.combatUntil = 0;
      return { cues: [], mood: 'exploration' };
    }
    const old = this.previous;
    if (old?.id === b.id && b.tickAt < old.tickAt)
      return {
        cues: [],
        mood: this.combatUntil > old.tickAt ? 'combat' : 'exploration',
      };
    this.previous = b;
    if (!old || old.id !== b.id || b.tickAt - old.tickAt > 5000) {
      this.combatUntil = 0;
      return { cues: [], mood: 'exploration' };
    }
    const cues: VoiceCue[] = [],
      own = b.entities.filter((e) => e.owner === owner),
      past = old.entities.filter((e) => e.owner === owner);
    const damage = own.filter(
      (e) => e.hp < (past.find((p) => p.id === e.id)?.hp ?? e.hp),
    );
    const firing = b.entities.some(
      (e) => e.firedAt > 0 && e.firedAt >= b.tickAt - 1500,
    );
    if (damage.length || firing) this.combatUntil = b.tickAt + 20000;
    if (b.status !== old.status && b.status !== 'active')
      return { cues: [b.status], mood: 'exploration' };
    if (b.status !== 'active') return { cues: [], mood: 'exploration' };
    // Same split as the HUD alert: any structure hit is the base under attack.
    if (damage.some((e) => !isUnit(e.kind))) cues.push('baseUnderAttack');
    else if (damage.length) cues.push('underAttack');
    if (
      past.some(
        (e) => !e.readyAt && isUnit(e.kind) && !own.some((n) => n.id === e.id),
      )
    )
      cues.push('unitLost');
    const ready = own.filter(
      (e) =>
        !e.readyAt &&
        (past.some((p) => p.id === e.id && p.readyAt > 0) ||
          (isUnit(e.kind) && !past.some((p) => p.id === e.id))),
    );
    if (ready.some((e) => !isUnit(e.kind))) cues.push('constructionReady');
    if (ready.some((e) => e.kind === 'tank' || e.kind === 'lynx'))
      cues.push('armorReady');
    else if (ready.some((e) => isUnit(e.kind))) cues.push('unitReady');
    const lowPower = needsPower(b, owner),
      wasLowPower = needsPower(old, owner);
    if (lowPower && !wasLowPower) cues.push('lowPower');
    if (!lowPower && wasLowPower) cues.push('powerRestored');
    // Tech sites reuse existing lines: taking one is an objective, an enemy
    // taking ours is an attack on the coalition.
    const site = (id: string) => old.sites?.find((s) => s.id === id);
    if (
      b.objectives.some(
        (o, i) => o.progress === 100 && old.objectives[i]?.progress !== 100,
      ) ||
      b.sites?.some((s) => s.team === 'blue' && site(s.id)?.team !== 'blue')
    )
      cues.push('objective');
    if (
      b.sites?.some(
        (s) =>
          site(s.id)?.team === 'blue' &&
          (s.team !== 'blue' ||
            (s.capturing === 'red' && site(s.id)?.capturing !== 'red')),
      )
    )
      cues.push('underAttack');
    if (b.wave > old.wave) cues.push('wave');
    if (
      b.entities.some(
        (e) => e.team === 'red' && !old.entities.some((p) => p.id === e.id),
      )
    )
      cues.push('enemySpotted');
    // Superweapon warnings reach every commander, on existing cues only.
    for (const notice of superweaponNotices(old, b, owner))
      if (notice.cue && !cues.includes(notice.cue)) cues.push(notice.cue);
    return {
      cues,
      mood: this.combatUntil > b.tickAt ? 'combat' : 'exploration',
    };
  }
}
