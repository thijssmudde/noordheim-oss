/**
 * The structure under the pointer. It lives outside React state so a pointer
 * crossing the battlefield re-renders only the hover card, never the command
 * screen; the card's position is written straight to the DOM.
 */
export class HoveredStructure {
  id: string | null = null;
  x = 0;
  y = 0;
  /** The battlefield's on-screen box; the card stays inside it, clear of the HUD columns. */
  bounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly movers = new Set<() => void>();
  set(id: string | null) {
    if (this.id === id) return;
    this.id = id;
    for (const l of this.listeners) l();
  }
  /** Clears only while this structure still holds the hover; a nearer one may have taken it. */
  release(id: string) {
    if (this.id === id) this.set(null);
  }
  point(x: number, y: number, bounds: HoveredStructure['bounds']) {
    this.x = x;
    this.y = y;
    this.bounds = bounds;
    for (const m of this.movers) m();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  subscribeMove = (listener: () => void) => {
    this.movers.add(listener);
    return () => void this.movers.delete(listener);
  };
  get = () => this.id;
}
