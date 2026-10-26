'use client';

import type {
  LocalViewer,
  SectorAction,
  SectorActions,
  SectorResults,
  SoloOptions,
} from '@/lib/local-sector';
import type {
  TickTiming,
  WorkerMessage,
  WorkerRequest,
} from './local-sector.worker';
// Vite's worker import, not `new URL(…, import.meta.url)`: vinext rewrites
// import.meta.url to a file:// URL in client modules, which a page cannot load.
// eslint-disable-next-line import/default -- Vite supplies the default export.
import SectorWorker from './local-sector.worker?worker';

/**
 * The browser's solo operation: a worker runs the simulation and this store
 * holds its latest projection and summary for React. A small pointer in
 * localStorage says which operation to resume; the battle itself lives in
 * IndexedDB, written by the worker.
 */
const POINTER = 'noordheim-local-operation';
const TIMINGS = 1200;

type View = Extract<WorkerMessage, { type: 'view' }>;
type Pointer = { id: string; owner: string };

export class LocalOperation {
  /** Undefined until the worker reports; null once the commander has left. */
  state: View['state'] | undefined;
  summary: View['summary'] | undefined;
  /** Recent worker tick timings with the page's cost to take each view in, newest last. */
  readonly timings: (TickTiming & { receive: number; render: number })[] = [];
  private readonly worker: Worker;
  private readonly calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private serial = 0;
  private readonly stateListeners = new Set<() => void>();
  private readonly summaryListeners = new Set<() => void>();

  constructor(
    readonly id: string,
    readonly owner: string,
    start: Extract<WorkerRequest, { type: 'launch' | 'resume' }>,
  ) {
    this.worker = new SectorWorker({ name: 'noordheim-sector' });
    this.worker.onmessage = this.receive;
    this.send({ type: 'visibility', hidden: document.hidden });
    this.send(start);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    // Development probes (headless measurements) read timings and state here.
    if (process.env.NODE_ENV !== 'production')
      (window as unknown as { __localSector?: object }).__localSector = this;
  }

  subscribeState = (listener: () => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };
  subscribeSummary = (listener: () => void) => {
    this.summaryListeners.add(listener);
    return () => this.summaryListeners.delete(listener);
  };

  act<A extends SectorAction>(action: A, args: SectorActions[A]) {
    return this.call({ type: 'act', action, args }) as Promise<
      SectorResults[A]
    >;
  }

  /** Leave the operation; the save goes with it. */
  async withdraw() {
    await this.call({ type: 'withdraw' });
    this.dispose();
  }

  private call(
    request:
      | Omit<Extract<WorkerRequest, { type: 'act' }>, 'call'>
      | Omit<Extract<WorkerRequest, { type: 'withdraw' }>, 'call'>,
  ) {
    const call = ++this.serial;
    return new Promise<unknown>((resolve, reject) => {
      this.calls.set(call, { resolve, reject });
      this.send({ ...request, call } as WorkerRequest);
    });
  }

  private send(request: WorkerRequest) {
    this.worker.postMessage(request);
  }

  private receive = (event: MessageEvent<WorkerMessage>) => {
    // Reading `data` deserialises the clone, so it counts as page cost.
    const started = performance.now();
    const data = event.data;
    switch (data.type) {
      case 'view': {
        this.state = data.state;
        for (const listener of this.stateListeners) listener();
        if (changed(this.summary, data.summary)) {
          this.summary = data.summary;
          for (const listener of this.summaryListeners) listener();
        }
        // An ended operation keeps its debrief on screen but is not resumed.
        if (
          data.summary &&
          (data.summary.status !== 'active' || data.summary.gameOver)
        )
          forget(this.id);
        if (data.timing) {
          const timing = {
            ...data.timing,
            receive: performance.now() - started,
            render: 0,
          };
          // React flushes the store update in a microtask queued before this one.
          queueMicrotask(() => (timing.render = performance.now() - started));
          this.timings.push(timing);
          if (this.timings.length > TIMINGS) this.timings.shift();
        }
        return;
      }
      case 'result':
      case 'failure': {
        const pending = this.calls.get(data.call);
        this.calls.delete(data.call);
        if (data.type === 'result') pending?.resolve(data.value);
        else pending?.reject(new Error(data.message));
        return;
      }
      case 'missing':
        this.dispose();
        return;
    }
  };

  private onVisibility = () =>
    this.send({ type: 'visibility', hidden: document.hidden });
  private onPageHide = () => this.send({ type: 'save' });

  /** Stop the worker without touching the save. */
  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    this.worker.terminate();
    for (const { reject } of this.calls.values())
      reject(new Error('The operation has closed.'));
    this.calls.clear();
    forget(this.id);
    if (current === this) {
      current = null;
      notify();
    }
  }
}

/** The summary changes every tick only through `endedAt`; the gate needs it once the operation is over. */
function changed(previous: View['summary'] | undefined, next: View['summary']) {
  if (!previous || !next) return previous !== next;
  return (Object.keys(next) as (keyof typeof next)[]).some(
    (key) =>
      previous[key] !== next[key] && (key !== 'endedAt' || !!next.gameOver),
  );
}

let current: LocalOperation | null = null;
let probed = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

function readPointer(): Pointer | null {
  try {
    const raw = localStorage.getItem(POINTER);
    return raw ? (JSON.parse(raw) as Pointer) : null;
  } catch {
    return null;
  }
}
function forget(id: string) {
  try {
    if (readPointer()?.id === id) localStorage.removeItem(POINTER);
  } catch {
    // Without storage the operation simply cannot be resumed after a reload.
  }
}

export function subscribeLocalOperation(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The commander's local operation, resuming a saved one on first use. */
export function localOperation(owner: string) {
  if (!probed && typeof window !== 'undefined') {
    probed = true;
    const pointer = readPointer();
    if (pointer?.owner === owner)
      current = new LocalOperation(pointer.id, owner, {
        type: 'resume',
        id: pointer.id,
      });
  }
  return current?.owner === owner ? current : null;
}

/** Start a new solo skirmish in this browser. */
export function launchLocalOperation(
  viewer: LocalViewer,
  options: SoloOptions,
) {
  probed = true;
  // A finished operation may still show its debrief; a new one replaces it.
  current?.dispose();
  const id = `local-${crypto.randomUUID()}`;
  try {
    localStorage.setItem(POINTER, JSON.stringify({ id, owner: viewer.id }));
  } catch {
    // Private browsing: the operation runs but will not survive a reload.
  }
  current = new LocalOperation(id, viewer.id, {
    type: 'launch',
    id,
    viewer,
    options,
  });
  notify();
  return current;
}
