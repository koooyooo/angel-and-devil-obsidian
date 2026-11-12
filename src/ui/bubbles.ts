import type { RevealSpeed } from "../types";

const SPEED_FACTOR: Record<RevealSpeed, number> = { slow: 1.5, normal: 1.0, fast: 0.6 };

/** Wait before the next bubble (design doc §5.7): clamp(600 + 35/char, 1200, 5000) × speed factor. */
export function revealDelay(chars: number, speed: RevealSpeed): number {
  const base = Math.min(5000, Math.max(1200, 600 + chars * 35));
  return Math.round(base * SPEED_FACTOR[speed]);
}

export interface RevealGeometry {
  scrollTop: number;
  viewHeight: number;
  /** Item edges in the scroll content's coordinates. */
  itemTop: number;
  itemBottom: number;
  paddingTop: number;
  paddingBottom: number;
}

/** The scrollTop that brings an item and the padding around it into view, moving as little as possible. */
export function scrollTopToReveal(g: RevealGeometry): number {
  const alignedBottom = g.itemBottom + g.paddingBottom - g.viewHeight;
  if (g.scrollTop < alignedBottom) return alignedBottom;
  const alignedTop = g.itemTop - g.paddingTop;
  if (g.scrollTop > alignedTop) return Math.max(0, alignedTop);
  return g.scrollTop;
}
