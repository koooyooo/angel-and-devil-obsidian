import type { Turn } from "../types";

/**
 * Maps playback position to the turn being spoken (design doc §5.10): the total duration is split
 * by each turn's share of characters. An approximation — Gemini returns one clip without timings.
 */
export class TurnTimeline {
  private readonly ends: number[];

  constructor(turns: Turn[]) {
    const weights = turns.map((t) => Math.max(1, t.text.length));
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = 0;
    this.ends = weights.map((w) => (acc += w) / total);
  }

  /** Index of the turn at `currentTime` (seconds) in a clip of `duration` seconds. */
  indexAt(currentTime: number, duration: number): number {
    if (!(duration > 0)) return 0;
    const p = Math.min(1, Math.max(0, currentTime / duration));
    const i = this.ends.findIndex((end) => p < end);
    return i === -1 ? this.ends.length - 1 : i;
  }
}

/** Root-mean-square level (0–1) of 8-bit time-domain samples from an AnalyserNode. */
export function rmsLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  // Speech rarely exceeds ~0.35 RMS; scale so normal speech uses most of the range.
  return Math.min(1, Math.sqrt(sum / samples.length) * 2.8);
}
