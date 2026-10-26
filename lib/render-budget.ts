/** Keep HDR/depth/MSAA attachments bounded even on Retina and ultrawide screens. */
export const BATTLEFIELD_PIXEL_BUDGET = 2_400_000;
export const COMMAND_POST_PIXEL_BUDGET = 900_000;

export function budgetedDpr(
  width: number,
  height: number,
  deviceDpr: number,
  pixels = BATTLEFIELD_PIXEL_BUDGET,
  maxDpr = 1.6,
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return 1;
  const preferred = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  // DPR may fall below 1: a CSS pixel minimum would defeat the budget at 4K.
  return Math.min(preferred, maxDpr, Math.sqrt(pixels / (width * height)));
}
