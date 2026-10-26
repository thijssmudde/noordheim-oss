/**
 * Render quality tiers, best first. The 3D view steps down one tier when a
 * device cannot hold the frame rate and cautiously back up when it can:
 *
 *   0  everything: ambient occlusion, SMAA, tilt-shift, shadows every frame
 *   1  no ambient occlusion, 90% resolution
 *   2  cheaper anti-aliasing, shadows redrawn every second frame, 80% resolution
 *   3  no tilt-shift or anti-aliasing, shadows every third frame, 70% resolution
 *
 * No tier switches shadows or lights off: that would recompile every material
 * (a long freeze) exactly when the device is already struggling.
 */
export const QUALITY_TIERS = [1, 0.85, 0.7, 0.55] as const;

export type RenderTier = {
  /** Multiplier on the render resolution. */
  dpr: number;
  ambientOcclusion: boolean;
  antialias: 'high' | 'low' | 'none';
  tiltShift: boolean;
  /** Redraw the shadow map every n-th frame. */
  shadowEvery: number;
};

const TIERS: RenderTier[] = [
  { dpr: 1, ambientOcclusion: true, antialias: 'high', tiltShift: true, shadowEvery: 1 },
  { dpr: 0.9, ambientOcclusion: false, antialias: 'high', tiltShift: true, shadowEvery: 1 },
  { dpr: 0.8, ambientOcclusion: false, antialias: 'low', tiltShift: true, shadowEvery: 2 },
  { dpr: 0.7, ambientOcclusion: false, antialias: 'none', tiltShift: false, shadowEvery: 3 },
];

/** The tier for a quality value from `FrameBudget` (1 = best). */
export function renderTier(quality: number): RenderTier {
  const index = QUALITY_TIERS.findIndex((q) => quality >= q - 1e-6);
  return TIERS[index < 0 ? TIERS.length - 1 : index];
}

/** Below this average frame rate (over two seconds) the view steps down a tier. */
const DROP_FPS = 45;
/** Above this, time counts towards stepping back up. */
const HEALTHY_FPS = 55;
/** Healthy seconds before trying the next tier up; doubles after a failed try. */
const PATIENCE = 12;

/** Hysteresis avoids repeatedly changing quality around a single slow frame. */
export class FrameBudget {
  private elapsed = 0;
  private frames = 0;
  private healthy = 0;
  private clock = 0;
  private raisedAt = -Infinity;
  private patience = PATIENCE;
  private tier = 0;
  quality: number = QUALITY_TIERS[0];
  sample(seconds: number) {
    if (seconds <= 0 || seconds > 0.5) {
      this.elapsed = this.frames = this.healthy = 0;
      return this.quality;
    }
    this.clock += seconds;
    this.elapsed += seconds;
    this.frames++;
    if (this.elapsed < 2) return this.quality;
    const fps = this.frames / this.elapsed;
    if (fps < DROP_FPS) {
      if (this.tier < QUALITY_TIERS.length - 1) {
        // Dropping right after stepping up: wait longer before the next try.
        if (this.clock - this.raisedAt < 10) this.patience = Math.min(this.patience * 2, 120);
        this.tier++;
      }
      this.healthy = 0;
    } else if (fps > HEALTHY_FPS) {
      this.healthy += this.elapsed;
      if (this.healthy >= this.patience && this.tier > 0) {
        this.tier--;
        this.raisedAt = this.clock;
        this.healthy = 0;
      }
    } else this.healthy = 0;
    this.elapsed = this.frames = 0;
    this.quality = QUALITY_TIERS[this.tier];
    return this.quality;
  }
}
