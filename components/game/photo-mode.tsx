'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Download, Share2, X } from 'lucide-react';
import { MAIN_SPONSOR } from '@/lib/sponsorship';

const DISPLAY = '"Barlow Condensed", "Arial Narrow", Impact, sans-serif';

/**
 * Copy the battlefield canvas on the frame after the next render. The WebGL
 * drawing buffer is still intact inside a requestAnimationFrame callback that
 * runs after the renderer's own, so no `preserveDrawingBuffer` (and its
 * per-frame cost) is needed. A blank read is retried on the following frames.
 */
function grabFrame(source: HTMLCanvasElement, tries = 6) {
  return new Promise<HTMLCanvasElement | null>((resolve) => {
    const attempt = (left: number) =>
      requestAnimationFrame(() => {
        const out = document.createElement('canvas');
        out.width = source.width;
        out.height = source.height;
        const ctx = out.getContext('2d');
        if (!ctx || !out.width || !out.height) return resolve(null);
        ctx.drawImage(source, 0, 0);
        // Sample a coarse grid: an all-transparent frame means we read a cleared buffer.
        const probe = document.createElement('canvas');
        probe.width = probe.height = 8;
        const p = probe.getContext('2d', { willReadFrequently: true })!;
        p.drawImage(out, 0, 0, 8, 8);
        const data = p.getImageData(0, 0, 8, 8).data;
        let lit = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) lit++;
        if (lit > 8 || left <= 0) resolve(lit > 8 ? out : null);
        else attempt(left - 1);
      });
    attempt(tries);
  });
}

/** The main sponsor's logo for the postcard stamp; same-origin, so the canvas stays exportable. */
function sponsorLogo() {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = MAIN_SPONSOR.icon;
  });
}

/** Stamp the postcard: NOORDHEIM wordmark and URL bottom right, the main sponsor small bottom left. */
function watermark(canvas: HTMLCanvasElement, logo: HTMLImageElement | null) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width,
    h = canvas.height,
    u = h / 1080;
  const shade = ctx.createLinearGradient(0, h * 0.78, 0, h);
  shade.addColorStop(0, '#05080a00');
  shade.addColorStop(1, '#05080a8c');
  ctx.fillStyle = shade;
  ctx.fillRect(0, h * 0.78, w, h * 0.22);
  const pad = 44 * u;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = '#000000a0';
  ctx.shadowBlur = 12 * u;
  // Wordmark.
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${58 * u}px ${DISPLAY}`;
  const word = 'N O O R D H E I M';
  ctx.fillText(word, w - pad, h - pad - 30 * u);
  const width = ctx.measureText(word).width;
  ctx.fillStyle = '#ff8f3a';
  ctx.fillRect(w - pad - width, h - pad - 25 * u, 48 * u, 3 * u);
  ctx.fillStyle = '#e6edf5';
  ctx.font = `600 ${22 * u}px ${DISPLAY}`;
  ctx.fillText('noordheim.com  ·  co-op RTS in your browser', w - pad, h - pad);
  // Main sponsor, small and quiet.
  ctx.textAlign = 'left';
  ctx.fillStyle = '#c9d5e2';
  ctx.font = `600 ${15 * u}px ${DISPLAY}`;
  ctx.fillText('MAIN SPONSOR', pad, h - pad - 22 * u);
  ctx.fillStyle = '#ffc48a';
  ctx.font = `700 ${22 * u}px ${DISPLAY}`;
  // The logo sits beside the name, centred on its capitals.
  const size = 24 * u;
  if (logo) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(logo, pad, h - pad - 8 * u - size / 2, size, size);
  }
  ctx.fillText(MAIN_SPONSOR.name, pad + (logo ? size + 8 * u : 0), h - pad);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type Shot = { blob: Blob; name: string; url: string };

/**
 * Photo mode (P): the HUD steps aside, the camera stays free (drag to pan,
 * Alt/Ctrl-drag or [ ] to orbit, wheel to zoom) and Enter or the shutter
 * saves a watermarked PNG. Render it once inside the battle's `.tactical-game`.
 */
export function PhotoMode() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [flash, setFlash] = useState(0);
  const game = () => anchor.current?.closest<HTMLElement>('.tactical-game');

  useEffect(() => {
    const root = game();
    root?.toggleAttribute('data-photo-mode', on);
    return () => {
      root?.removeAttribute('data-photo-mode');
    };
  }, [on]);

  useEffect(() => {
    if (!shot) return;
    const timer = setTimeout(() => setShot(null), 9000);
    return () => {
      clearTimeout(timer);
      URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  async function capture() {
    const canvas =
      game()?.querySelector<HTMLCanvasElement>('.tac-scene canvas');
    if (!canvas || busy) return;
    setBusy(true);
    try {
      const [frame, logo] = await Promise.all([
        grabFrame(canvas),
        sponsorLogo(),
      ]);
      if (!frame) return;
      watermark(frame, logo);
      const blob = await new Promise<Blob | null>((r) =>
        frame.toBlob(r, 'image/png'),
      );
      if (!blob) return;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      const name = `noordheim-${stamp}.png`;
      download(blob, name);
      setFlash((n) => n + 1);
      setShot({ blob, name, url: URL.createObjectURL(blob) });
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!shot) return;
    const file = new File([shot.blob], shot.name, { type: 'image/png' });
    try {
      await navigator.share({
        files: [file],
        title: 'Noordheim',
        text: 'From the front at noordheim.com',
      });
    } catch {
      // Cancelled or unsupported: the PNG is already downloaded.
    }
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (
      t instanceof HTMLElement &&
      (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
        t.isContentEditable)
    )
      return;
    if (document.querySelector('[data-slot=dialog-content]')) return;
    const k = e.key.toLowerCase();
    if (k === 'p' && !e.repeat) {
      e.preventDefault();
      setOn((v) => !v);
    } else if (on && k === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setOn(false);
    } else if (on && k === 'enter' && !e.repeat) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void capture();
    }
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => onKey(e);
    // Capture phase: photo keys win over the HUD's shortcuts while active.
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  const canShare =
    typeof navigator !== 'undefined' &&
    !!shot &&
    !!navigator.canShare?.({
      files: [new File([shot.blob], shot.name, { type: 'image/png' })],
    });

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOn(true)}
        title="Photo mode (P)"
        aria-label="Photo mode"
        aria-pressed={on}
      >
        <Camera size={17} />
      </button>
      {typeof document !== 'undefined' &&
        (on || shot) &&
        createPortal(
          <div className="photo-mode" data-on={on || undefined}>
            {flash > 0 && <div key={flash} className="photo-flash" />}
            {on && (
              <div className="photo-bar" role="toolbar" aria-label="Photo mode">
                <span className="photo-hint">
                  <strong>PHOTO MODE</strong>
                  Drag to pan · Alt-drag or [ ] to orbit · wheel to zoom
                </span>
                <button
                  className="photo-shutter"
                  onClick={() => void capture()}
                  disabled={busy}
                  aria-label="Take photo (Enter)"
                  title="Take photo (Enter)"
                >
                  <span />
                </button>
                <button
                  className="photo-close"
                  onClick={() => setOn(false)}
                  aria-label="Leave photo mode (Esc)"
                  title="Leave photo mode (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            {shot && (
              <aside className="photo-toast" aria-live="polite">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.url} alt="Your Noordheim battlefield" />
                <div>
                  <strong>Photo saved</strong>
                  <span>{shot.name}</span>
                  <div>
                    <button onClick={() => download(shot.blob, shot.name)}>
                      <Download size={14} /> Again
                    </button>
                    {canShare && (
                      <button onClick={() => void share()}>
                        <Share2 size={14} /> Share
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
