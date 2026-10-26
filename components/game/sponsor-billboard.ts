'use client';

/**
 * Sponsor billboards: weathered Nordic advertising hoardings painted on a 2D
 * canvas and handed to the renderer as a `THREE.CanvasTexture`.
 *
 * Renderer usage (track B), per `design.billboards[i]`:
 *
 *   const texture = useBillboardTexture(i, { width: 1024, height: 512, style: b.size });
 *   <mesh><planeGeometry args={[8, 4]} /><meshStandardMaterial map={texture} /></mesh>
 *
 * or, without the hook, `sponsorBillboardTexture(useBillboardSponsors(), { index: i, ... })`.
 * Textures are cached and shared between billboards: never dispose them.
 */
import * as THREE from 'three';
import { useEffect, useMemo, useState } from 'react';
import { useConvex } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { countSponsorView, useSponsorStats } from './sponsor-stats';
import {
  BILLBOARD_ROTATION_MS,
  billboardRotation,
  billboardSponsors,
  formatUsd,
  nextBillboardChange,
  type BillboardSponsor,
  type PaidSponsor,
} from '@/lib/sponsorship';

export {
  billboardRotation,
  billboardSponsors,
  nextBillboardChange,
  BILLBOARD_ROTATION_MS,
  type BillboardSponsor,
} from '@/lib/sponsorship';

/** Matches `BillboardDesign['size']` in lib/maps/types.ts. */
export type BillboardStyle = 'hoarding' | 'tower' | 'banner';
export type BillboardOptions = {
  width?: number;
  height?: number;
  style?: BillboardStyle;
  /** Which billboard on the map (drives the rotation when a list is passed). */
  index?: number;
  /** Clock for the rotation; defaults to `Date.now()`. */
  now?: number;
};

const DEFAULT_SIZE: Record<BillboardStyle, [number, number]> = {
  hoarding: [1024, 512],
  tower: [512, 1024],
  banner: [1024, 256],
};

const DISPLAY = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';
const BODY = 'Barlow, "Helvetica Neue", Arial, sans-serif';

/** Diorama palette: red timber, slate, spruce, signal orange, fjord blue. */
const BANDS = ['#8e2f25', '#3b4450', '#2f4a3a', '#1f4a66', '#6b3f5c'];
const PAPER = '#efe4cc';
const INK = '#1d232b';

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function bandColor(sponsor: BillboardSponsor) {
  if (sponsor.kind === 'main') return '#d9692a';
  if (sponsor.kind === 'open') return PAPER;
  return BANDS[hash(sponsor.name) % BANDS.length];
}

/** Largest font size (px) at which `text` fits the box on one line. */
function fit(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxHeight: number,
  weight = 700,
) {
  ctx.font = `${weight} 100px ${DISPLAY}`;
  const width = ctx.measureText(text).width || 1;
  return Math.max(8, Math.min(maxHeight, (100 * maxWidth) / width));
}

/** Split a long name into two balanced lines for tall posters. */
function lines(text: string, max: number) {
  const words = text.split(/\s+/);
  if (words.length < 2 || text.length <= max) return [text];
  let best = [text],
    score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '),
      b = words.slice(i).join(' ');
    const s = Math.max(a.length, b.length);
    if (s < score) {
      score = s;
      best = [a, b];
    }
  }
  return best;
}

function mountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - size, y + size * 0.55);
  ctx.lineTo(x - size * 0.25, y - size * 0.5);
  ctx.lineTo(x + size * 0.1, y);
  ctx.lineTo(x + size * 0.45, y - size * 0.3);
  ctx.lineTo(x + size, y + size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function plate(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  fill: string,
  ink: string,
  align: 'left' | 'center' = 'left',
) {
  ctx.save();
  ctx.font = `700 ${size}px ${DISPLAY}`;
  const spaced = text.split('').join(' ');
  const w = ctx.measureText(spaced).width + size * 1.2;
  const left = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = fill;
  ctx.fillRect(left, y, w, size * 1.55);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(spaced, left + size * 0.6, y + size * 0.8);
  ctx.restore();
  return w;
}

/** Sun rays fanning out from a point: the propaganda poster's signature. */
function rays(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  count = 18,
) {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const b = a + Math.PI / count;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(cx + Math.cos(b) * radius, cy + Math.sin(b) * radius);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Paper grain, pasted-sheet seams, flaking paint, rain streaks, a torn corner and grime. */
function weather(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  cloth: boolean,
) {
  const r = rng(seed);
  ctx.save();
  // Grain.
  for (let i = 0; i < (w * h) / 180; i++) {
    ctx.fillStyle = r() < 0.5 ? '#ffffff' : '#000000';
    ctx.globalAlpha = 0.025 + r() * 0.035;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  if (cloth) {
    // Weave and a sag shadow.
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    const sag = ctx.createLinearGradient(0, 0, 0, h);
    sag.addColorStop(0, '#0000');
    sag.addColorStop(0.5, '#0003');
    sag.addColorStop(1, '#0000');
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = sag;
    ctx.fillRect(0, 0, w, h);
  } else {
    // Seams between pasted sheets.
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = Math.max(1, w / 700);
    const sheets = w > h ? 3 : 2;
    for (let i = 1; i < sheets; i++) {
      const x = (w * i) / sheets + (r() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (r() - 0.5) * 4, h);
      ctx.stroke();
    }
    // Flaking paint showing the paper beneath.
    ctx.fillStyle = PAPER;
    for (let i = 0; i < 26; i++) {
      ctx.globalAlpha = 0.25 + r() * 0.4;
      const x = r() * w,
        y = r() < 0.6 ? r() * h * 0.25 : h - r() * h * 0.2;
      ctx.beginPath();
      const s = 3 + r() * (w / 90);
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++)
        ctx.lineTo(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 1.4);
      ctx.closePath();
      ctx.fill();
    }
    // Torn corner exposing the timber hoarding behind.
    const tear = Math.min(w, h) * (0.08 + r() * 0.06);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#5a4030';
    ctx.beginPath();
    ctx.moveTo(w, h);
    ctx.lineTo(w - tear * 1.4, h);
    ctx.lineTo(w - tear * 0.7, h - tear * 0.45);
    ctx.lineTo(w - tear * 0.9, h - tear * 0.9);
    ctx.lineTo(w, h - tear * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0000001f';
    for (let y = h - tear * 1.2; y < h; y += 6)
      ctx.fillRect(w - tear * 1.4, y, tear * 1.4, 1);
  }
  // Rain streaks from the top edge.
  ctx.globalAlpha = 1;
  for (let i = 0; i < 14; i++) {
    const x = r() * w,
      len = h * (0.15 + r() * 0.5),
      g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, '#2a1d1238');
    g.addColorStop(1, '#2a1d1200');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 1 + r() * 3, len);
  }
  // Grime pooling at the bottom and a soft vignette.
  const grime = ctx.createLinearGradient(0, h * 0.7, 0, h);
  grime.addColorStop(0, '#2a1d1200');
  grime.addColorStop(1, '#2a1d1240');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, w, h);
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.35,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.75,
  );
  v.addColorStop(0, '#0000');
  v.addColorStop(1, '#0000003a');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function frame(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const b = Math.max(4, Math.min(w, h) * 0.022);
  ctx.save();
  ctx.strokeStyle = '#2b2118';
  ctx.lineWidth = b;
  ctx.strokeRect(b / 2, b / 2, w - b, h - b);
  ctx.fillStyle = '#8c8f93';
  const rivet = b * 0.55;
  for (const [x, y] of [
    [b * 1.8, b * 1.8],
    [w - b * 1.8, b * 1.8],
    [b * 1.8, h - b * 1.8],
    [w - b * 1.8, h - b * 1.8],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, rivet, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function hazard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const t = Math.min(w, h) * 0.07;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(t, t, w - 2 * t, h - 2 * t);
  ctx.clip('evenodd');
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff8f3a';
  for (let x = -h; x < w + h; x += t * 2) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + t, 0);
    ctx.lineTo(x + t + h, h);
    ctx.lineTo(x + h, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The outbid price tag: a signal-orange card pinned to the poster's corner,
 * telling every player what this spot costs to take. Paid posters say
 * "OUTBID ME" and the next price; the open slot says what it costs to start.
 */
function priceTag(
  ctx: CanvasRenderingContext2D,
  sponsor: BillboardSponsor,
  w: number,
  h: number,
  style: BillboardStyle,
) {
  if (!sponsor.nextBid || style === 'banner') return;
  const open = sponsor.kind === 'open';
  const tall = style === 'tower';
  const size = Math.min(w, h) * (tall ? 0.4 : 0.38);
  const cx = tall ? w * 0.74 : w - size * 0.62,
    cy = tall ? h * (sponsor.kind === 'open' ? 0.77 : 0.7) : size * 0.58;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tall ? -0.08 : 0.1);
  const tw = size * 1.08,
    th = size * 0.86;
  ctx.fillStyle = '#00000055';
  ctx.fillRect(-tw / 2 + size * 0.04, -th / 2 + size * 0.05, tw, th);
  ctx.fillStyle = '#ff8f3a';
  ctx.fillRect(-tw / 2, -th / 2, tw, th);
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.035;
  ctx.strokeRect(-tw / 2 + size * 0.05, -th / 2 + size * 0.05, tw - size * 0.1, th - size * 0.1);
  // The pin holding it on.
  ctx.fillStyle = '#8c8f93';
  ctx.beginPath();
  ctx.arc(0, -th / 2 + size * 0.1, size * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = open ? 'THIS SPOT' : 'OUTBID ME';
  ctx.font = `700 ${fit(ctx, label, tw * 0.7, size * 0.17)}px ${DISPLAY}`;
  ctx.fillText(label, 0, -th / 2 + size * 0.3);
  const price = formatUsd(sponsor.nextBid);
  ctx.font = `700 ${fit(ctx, price, tw * 0.8, size * 0.44)}px ${DISPLAY}`;
  ctx.fillText(price, 0, size * 0.2);
  const where = sponsor.slot ? `SLOT ${sponsor.slot} · NOORDHEIM.COM` : 'NOORDHEIM.COM';
  ctx.font = `600 ${fit(ctx, where, tw * 0.8, size * 0.1, 600)}px ${DISPLAY}`;
  ctx.fillText(where, 0, th / 2 - size * 0.12);
  ctx.restore();
}

const icons = new Map<string, HTMLImageElement>();
function load(src: string) {
  let img = icons.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    icons.set(src, img);
  }
  return img;
}
function icon(src: string | undefined, onLoad?: () => void) {
  if (!src || typeof Image === 'undefined') return null;
  const img = load(src);
  if (!img.complete && onLoad)
    img.addEventListener('load', onLoad, { once: true });
  return img.complete && img.naturalWidth ? img : null;
}

/**
 * Start fetching every poster's logo now, so a board that rotates to a new
 * sponsor paints it with its logo instead of popping it in a moment later.
 */
export function preloadSponsorIcons(sponsors: readonly BillboardSponsor[]) {
  if (typeof Image === 'undefined') return;
  for (const s of sponsors) if (s.icon) load(s.icon);
}

/**
 * The poster's round emblem: the sponsor's logo on a paper disc, or the
 * mountain while it loads (and for sponsors without one). `disc` is false
 * where the caller has already painted the disc.
 */
function emblem(
  ctx: CanvasRenderingContext2D,
  sponsor: BillboardSponsor,
  x: number,
  y: number,
  radius: number,
  ink: string,
  onChange?: () => void,
  disc = true,
) {
  const logo = icon(sponsor.icon, onChange);
  if (!logo) {
    mountain(ctx, x, y + radius * 0.08, radius * 0.62, disc ? PAPER : ink);
    return;
  }
  ctx.save();
  if (disc) {
    ctx.fillStyle = '#00000024';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // Favicons are often small; smooth the upscale and keep them inside the disc.
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.94, 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const s = radius * 1.18;
  ctx.drawImage(logo, x - s / 2, y - s / 2, s, s);
  ctx.restore();
}

/**
 * Paint one poster onto a canvas. Shared by the in-world texture and the DOM
 * previews on the home screen and the sponsor page. `onChange` fires when a
 * late-loading font or logo means the canvas should be repainted.
 */
export function paintSponsorBillboard(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  sponsor: BillboardSponsor,
  style: BillboardStyle = 'hoarding',
  onChange?: () => void,
) {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return;
  const w = canvas.width,
    h = canvas.height,
    u = Math.min(w, h) / 100;
  const seed = hash(`${sponsor.id}:${style}`);
  const open = sponsor.kind === 'open';
  const band = bandColor(sponsor);
  const name = sponsor.name.toUpperCase();
  const cloth = style === 'banner';
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  if (open) {
    hazard(ctx, w, h);
    const inset = Math.min(w, h) * 0.07;
    if (style === 'tower') {
      plate(
        ctx,
        'SPONSOR SLOT OPEN',
        w / 2,
        inset + u * 8,
        u * 5.5,
        INK,
        '#ff8f3a',
        'center',
      );
      mountain(ctx, w / 2, h * 0.25, u * 14, '#3b4450');
      const rows = ['YOUR', 'BRAND', 'HERE'];
      const size = fit(ctx, 'BRAND', w - inset * 4, h * 0.12);
      ctx.fillStyle = INK;
      ctx.font = `700 ${size}px ${DISPLAY}`;
      rows.forEach((row, i) =>
        ctx.fillText(row, w / 2, h * 0.43 + i * size * 0.95),
      );
      ctx.fillStyle = '#c4541a';
      ctx.font = `600 ${u * 6}px ${BODY}`;
      ctx.fillText(sponsor.domain, w / 2, h - inset - u * 8);
    } else {
      // Leave the right-hand corner to the price tag.
      const tag = cloth ? 0 : Math.min(w, h) * 0.44;
      const cx = (w - tag) / 2 + inset * 0.5;
      const headline = sponsor.nextBid
        ? `YOUR BRAND HERE FOR ${formatUsd(sponsor.nextBid)}`
        : 'YOUR BRAND HERE';
      const size = fit(
        ctx,
        headline,
        w - tag - inset * 4,
        (h - inset * 2) * 0.46,
      );
      plate(
        ctx,
        cloth ? 'SPONSOR SLOT OPEN' : 'SPONSOR SLOT · OPEN',
        cx,
        inset + u * (cloth ? 2 : 7),
        u * (cloth ? 9 : 6),
        INK,
        '#ff8f3a',
        'center',
      );
      ctx.fillStyle = INK;
      ctx.font = `700 ${size}px ${DISPLAY}`;
      ctx.fillText(
        headline,
        cx,
        h / 2 + size * (cloth ? 0.42 : 0.3),
      );
      if (!cloth) {
        ctx.fillStyle = '#c4541a';
        ctx.font = `600 ${u * 7}px ${BODY}`;
        ctx.fillText(sponsor.domain, cx, h - inset - u * 7);
      }
    }
  } else if (style === 'tower') {
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h * 0.78);
    rays(ctx, w / 2, h * 0.3, h, '#ffffff14', 16);
    emblem(ctx, sponsor, w / 2, h * 0.23, u * 20, band, onChange);
    const rows = lines(name, 9);
    const size = Math.min(
      ...rows.map((row) => fit(ctx, row, w * 0.84, h * 0.16)),
    );
    ctx.fillStyle = PAPER;
    ctx.font = `700 ${size}px ${DISPLAY}`;
    const top = h * 0.5 - ((rows.length - 1) * size * 0.9) / 2 + size * 0.3;
    rows.forEach((row, i) => ctx.fillText(row, w / 2, top + i * size * 0.9));
    plate(ctx, 'SPONSOR', w / 2, u * 8, u * 5.5, PAPER, band, 'center');
    ctx.fillStyle = INK;
    const domain = fit(ctx, sponsor.domain, w * 0.8, u * 9, 600);
    ctx.font = `600 ${domain}px ${DISPLAY}`;
    ctx.fillText(sponsor.domain, w / 2, h * 0.9);
  } else if (cloth) {
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, h * 0.1, w, h * 0.04);
    ctx.fillRect(0, h * 0.86, w, h * 0.04);
    // A sponsor named after its domain would read twice; say it once.
    const domain = sponsor.domain.toUpperCase();
    const label = name === domain ? name : `${name}  ·  ${domain}`;
    // Keep the logo discs fully on the cloth and the name clear of them.
    const r = h * 0.24,
      ex = h * 0.12 + r * 1.12;
    const size = fit(ctx, label, w - (ex + r * 1.12 + h * 0.1) * 2, h * 0.46);
    ctx.font = `700 ${size}px ${DISPLAY}`;
    ctx.fillText(label, w / 2, h / 2 + size * 0.35);
    emblem(ctx, sponsor, ex, h / 2, r, band, onChange);
    emblem(ctx, sponsor, w - ex, h / 2, r, band, onChange);
  } else {
    // Hoarding: sun-ray field on the left, name set big on the right.
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, w, h * 0.8);
    rays(ctx, w * 0.16, h * 0.42, w, '#ffffff12', 22);
    ctx.fillStyle = '#00000024';
    ctx.beginPath();
    ctx.arc(w * 0.16, h * 0.42, h * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(w * 0.16, h * 0.42, h * 0.24, 0, Math.PI * 2);
    ctx.fill();
    emblem(ctx, sponsor, w * 0.16, h * 0.42, h * 0.24, band, onChange, false);
    const left = w * 0.33,
      right = sponsor.nextBid ? w * 0.76 : w * 0.94;
    plate(
      ctx,
      sponsor.kind === 'main' ? 'MAIN SPONSOR' : 'SPONSOR',
      left,
      h * 0.1,
      u * 6,
      PAPER,
      band,
    );
    const rows = lines(name, 14);
    const size = Math.min(
      ...rows.map((row) =>
        fit(ctx, row, right - left, h * (rows.length > 1 ? 0.25 : 0.4)),
      ),
    );
    ctx.fillStyle = PAPER;
    ctx.textAlign = 'left';
    ctx.font = `700 ${size}px ${DISPLAY}`;
    const base = h * 0.5 + size * 0.36 - ((rows.length - 1) * size * 0.9) / 2;
    rows.forEach((row, i) => ctx.fillText(row, left, base + i * size * 0.9));
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    const domain = fit(ctx, sponsor.domain, w * 0.6, h * 0.12, 600);
    ctx.font = `600 ${domain}px ${DISPLAY}`;
    ctx.fillText(sponsor.domain, w / 2, h * 0.935);
  }
  weather(ctx, w, h, seed, cloth);
  // Pinned on after the weathering: a fresh tag on an old hoarding.
  priceTag(ctx, sponsor, w, h, style);
  if (!cloth) frame(ctx, w, h);
  ctx.restore();

  // Barlow Condensed arrives from Google Fonts; repaint once it has.
  if (typeof document !== 'undefined' && document.fonts && onChange) {
    const face = `700 64px "Barlow Condensed"`;
    if (!document.fonts.check(face))
      void document.fonts.load(face).then(() => {
        if (document.fonts.check(face)) onChange();
      });
  }
}

const cache = new Map<string, THREE.CanvasTexture>();

/**
 * A poster texture. Pass one sponsor, or the rotation list plus the
 * billboard's `index` (and optionally `now`) to get whichever poster that
 * board shows right now. Cached per sponsor, style and size; shared, so
 * never dispose it.
 */
export function sponsorBillboardTexture(
  sponsors: BillboardSponsor | readonly BillboardSponsor[],
  options: BillboardOptions = {},
): THREE.CanvasTexture {
  const style = options.style ?? 'hoarding';
  const [dw, dh] = DEFAULT_SIZE[style];
  const width = options.width ?? dw,
    height = options.height ?? dh;
  const list = Array.isArray(sponsors)
    ? (sponsors as readonly BillboardSponsor[])
    : [sponsors as BillboardSponsor];
  const sponsor = billboardRotation(
    list.length ? list : billboardSponsors(),
    options.index ?? 0,
    options.now ?? Date.now(),
  );
  const key = `${sponsor.id}|${sponsor.name}|${sponsor.domain}|${sponsor.icon ?? ''}|${sponsor.nextBid ?? ''}|${style}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = `sponsor-billboard:${sponsor.id}`;
  const paint = () => {
    paintSponsorBillboard(canvas, sponsor, style, repaint);
    texture.needsUpdate = true;
  };
  let repaints = 0;
  // Late fonts or logos repaint a bounded number of times.
  const repaint = () => {
    if (repaints++ < 3) paint();
  };
  paint();
  cache.set(key, texture);
  return texture;
}

/**
 * The posters in rotation: the main sponsor, active paid sponsors, and the
 * open-slot advert while a slot is free. Works outside a ConvexProvider (art
 * review, attract mode without a client) by showing the main sponsor and the
 * open slot only.
 */
let preview: PaidSponsor[] | null = null;
/** Dev review pages (no Convex) show these paid sponsors on the billboards. */
export function previewPaidSponsors(list: PaidSponsor[]) {
  preview = list;
}
export const previewSponsors = () => preview;

export function useBillboardSponsors(): BillboardSponsor[] {
  const convex = useConvex();
  useSponsorStats();
  const [paid, setPaid] = useState<PaidSponsor[]>(() => preview ?? []);
  useEffect(() => {
    if (!convex || preview) return;
    const watch = convex.watchQuery(api.sponsors.active, {});
    const update = () => {
      try {
        setPaid(watch.localQueryResult() ?? []);
      } catch {
        setPaid([]);
      }
    };
    update();
    return watch.onUpdate(update);
  }, [convex]);
  return useMemo(() => {
    const list = billboardSponsors(paid);
    preloadSponsorIcons(list);
    return list;
  }, [paid]);
}

/** The rotation step, updated exactly when the posters change (every 20 s). */
export function useBillboardClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(
      () => setNow(Date.now()),
      nextBillboardChange(now) - Date.now() + 50,
    );
    return () => clearTimeout(timer);
  }, [now]);
  return now;
}

/** Everything a billboard mesh needs: the current poster texture for billboard `index`. */
export function useBillboardTexture(
  index: number,
  options: Omit<BillboardOptions, 'index' | 'now'> = {},
) {
  const sponsors = useBillboardSponsors();
  const now = useBillboardClock();
  const poster = billboardRotation(sponsors, index, now);
  const step = Math.floor(now / BILLBOARD_ROTATION_MS);
  // One view per sponsor per rotation step, however many boards show it.
  useEffect(() => {
    if (poster.kind === 'paid') countSponsorView(poster.id, `board:${step}`);
  }, [poster, step]);
  const { style, width, height } = options;
  return useMemo(
    () => sponsorBillboardTexture(poster, { style, width, height }),
    [poster, style, width, height],
  );
}
