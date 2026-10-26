/// <reference lib="webworker" />
import {
  LocalSector,
  type LocalViewer,
  type SectorAction,
  type SectorActions,
  type SectorClock,
  type SoloOptions,
} from '../../lib/local-sector';
import { clearSector, loadSector, saveSector } from '../../lib/local-save';

/**
 * Runs one solo operation off the render thread: the simulation, route
 * finding and fog projection all happen here. The page receives the same
 * projection `api.tactics.state` returns after every tick and every action.
 */
export type WorkerRequest =
  | { type: 'launch'; id: string; viewer: LocalViewer; options: SoloOptions }
  | { type: 'resume'; id: string }
  | {
      type: 'act';
      call: number;
      action: SectorAction;
      args: SectorActions[SectorAction];
    }
  | { type: 'withdraw'; call: number }
  | { type: 'visibility'; hidden: boolean }
  | { type: 'save' };
export type TickTiming = {
  /** Order routing and tickBattle, ms. */
  tick: number;
  /** Fog projection, ms. */
  view: number;
  /** Structured clone of the projection into the message, ms. */
  post: number;
  entities: number;
};
export type WorkerMessage =
  | {
      type: 'view';
      state: ReturnType<LocalSector['view']>;
      summary: ReturnType<LocalSector['summary']>;
      timing?: TickTiming;
    }
  | { type: 'result'; call: number; value: unknown }
  | { type: 'failure'; call: number; message: string }
  | { type: 'missing' };

declare const self: DedicatedWorkerGlobalScope;
const SAVE_MS = 2000;
let sector: LocalSector | null = null;
let hidden = false;
let savedAt = 0;
let tickStart = 0;
let timing: TickTiming | undefined;
let writing: Promise<unknown> = Promise.resolve();

const clock: SectorClock = {
  now: () => Date.now(),
  schedule: (run, ms) =>
    setTimeout(() => {
      tickStart = performance.now();
      run();
    }, ms),
  cancel: (handle) => clearTimeout(handle as number),
};
const post = (message: WorkerMessage) => self.postMessage(message);

/** Post the commander's projection; each tick's timings ride on the next view. */
function publish(tick?: number) {
  if (!sector) return;
  const started = performance.now();
  const state = sector.view(),
    summary = sector.summary();
  const projected = performance.now();
  post({ type: 'view', state, summary, timing });
  if (tick !== undefined)
    timing = {
      tick,
      view: projected - started,
      post: performance.now() - projected,
      entities: sector.battle.entities.length,
    };
}
function onTick() {
  publish(performance.now() - tickStart);
  persist(false);
}

/** Write the operation every few seconds, or now; an ended operation leaves no save. */
function persist(now: boolean) {
  if (!sector) return;
  const current = sector;
  if (current.ended) {
    writing = writing.then(() => clearSector(current.id)).catch(report);
    return;
  }
  if (!now && Date.now() - savedAt < SAVE_MS) return;
  savedAt = Date.now();
  const save = current.save();
  writing = writing.then(() => saveSector(save)).catch(report);
}
function report(error: unknown) {
  console.warn('Local operation could not be saved.', error);
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  switch (data.type) {
    case 'launch':
      sector = LocalSector.launch(
        data.id,
        data.viewer,
        data.options,
        clock,
        onTick,
      );
      persist(true);
      if (!hidden) sector.play();
      publish();
      return;
    case 'resume': {
      const save = await loadSector(data.id).catch(() => undefined);
      if (!save) return post({ type: 'missing' });
      sector = LocalSector.restore(save, clock, onTick);
      if (!hidden) sector.play();
      publish();
      return;
    }
    case 'act':
      try {
        if (!sector) throw new Error('Sector unavailable.');
        const value = sector.act(data.action, data.args);
        post({ type: 'result', call: data.call, value });
        publish();
        persist(true);
      } catch (error) {
        post({
          type: 'failure',
          call: data.call,
          message: (error as Error).message,
        });
      }
      return;
    case 'withdraw':
      try {
        if (!sector) throw new Error('This is not your current operation.');
        sector.withdraw();
        const id = sector.id;
        writing = writing.then(() => clearSector(id)).catch(report);
        await writing;
        post({ type: 'result', call: data.call, value: null });
      } catch (error) {
        post({
          type: 'failure',
          call: data.call,
          message: (error as Error).message,
        });
      }
      return;
    case 'visibility':
      hidden = data.hidden;
      if (hidden) {
        sector?.pause();
        persist(true);
      } else sector?.play();
      return;
    case 'save':
      persist(true);
      return;
  }
};
