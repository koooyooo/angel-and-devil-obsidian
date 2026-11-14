import type { Strings } from "../i18n";

/**
 * Cards shown on the loading screen while the banter (and its voice) is being prepared —
 * like the tips on a game's loading screen. The texts live in each locale (`loadingTips`);
 * add more entries freely there. They are shuffled each time.
 */
export function loadingTips(strings: Strings): string[] {
  const tips = [...strings.loadingTips];
  for (let i = tips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tips[i], tips[j]] = [tips[j], tips[i]];
  }
  return tips;
}
