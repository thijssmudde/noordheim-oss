'use client';
import { useCallback, useState } from 'react';
import { budgetedDpr, BATTLEFIELD_PIXEL_BUDGET } from '@/lib/render-budget';

/** Pass the budget to Canvas itself: changing only the R3F store is overwritten
 * when Canvas configures its root again. HTML HUD text stays at native resolution.
 */
export function useRenderResolution(
  pixels = BATTLEFIELD_PIXEL_BUDGET,
  maxDpr = 1.6,
) {
  const [dpr, setDpr] = useState(1);
  const ref = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const update = () =>
        setDpr(
          budgetedDpr(
            canvas.clientWidth,
            canvas.clientHeight,
            window.devicePixelRatio,
            pixels,
            maxDpr,
          ),
        );
      update();
      const observer = new ResizeObserver(update);
      observer.observe(canvas);
      window.addEventListener('resize', update);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', update);
      };
    },
    [pixels, maxDpr],
  );
  return { dpr, ref };
}
