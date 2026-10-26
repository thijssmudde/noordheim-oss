'use client';

/**
 * Sponsor views and clicks, counted in the browser and sent in small batches
 * (`sponsors.record`), so a battle full of billboards costs one write every
 * few seconds rather than one per poster.
 *
 * A view is one poster actually on screen for a player: once per mount of a
 * wall or credits roll, and once per 20-second billboard step per battle
 * (however many boards show the same sponsor in that step).
 */
import { useEffect } from 'react';
import { useConvex } from 'convex/react';
import type { ConvexReactClient } from 'convex/react';
import { api } from '@/convex/_generated/api';

const FLUSH_MS = 15_000;
const views = new Map<string, number>();
const clicks = new Map<string, number>();
const seen = new Set<string>();
let client: ConvexReactClient | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!client || (!views.size && !clicks.size)) return;
  const batch = {
    views: [...views].map(([id, n]) => ({ id, n })),
    clicks: [...clicks].map(([id, n]) => ({ id, n })),
  };
  views.clear();
  clicks.clear();
  // Stats are best-effort; a lost batch never interrupts play.
  void client.mutation(api.sponsors.record, batch).catch(() => {});
}

const schedule = () => {
  timer ??= setTimeout(flush, FLUSH_MS);
};

/**
 * Count a view of a paid sponsor. `once` dedupes: the same id and key count
 * once (a billboard step shown on four boards is one view).
 */
export function countSponsorView(id: string, once?: string) {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible')
    return;
  if (once) {
    const key = `${id}|${once}`;
    if (seen.has(key)) return;
    if (seen.size > 2000) seen.clear();
    seen.add(key);
  }
  views.set(id, (views.get(id) ?? 0) + 1);
  schedule();
}

export function countSponsorClick(id: string) {
  clicks.set(id, (clicks.get(id) ?? 0) + 1);
  flush();
}

/**
 * Connects the counters to Convex and sends what is left when the tab hides.
 * Mount wherever sponsors render; outside a ConvexProvider (art review) it
 * does nothing and counts are dropped.
 */
export function useSponsorStats() {
  const convex = useConvex();
  useEffect(() => {
    if (!convex) return;
    client = convex;
    const hide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [convex]);
}
