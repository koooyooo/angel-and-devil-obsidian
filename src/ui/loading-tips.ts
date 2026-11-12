import { getLanguage } from "obsidian";

/**
 * Cards shown on the loading screen while the banter (and its voice) is being prepared —
 * like the tips on a game's loading screen. Add more entries freely; they are shuffled each time.
 */
const TIPS = {
  ja: [
    "天使は、ノートの中の具体的なことを必ず1つ見つけて褒めます。",
    "悪魔は毎ターン、本当に鋭い指摘を1つだけ混ぜてきます。聞き逃さないように。",
    "ノートの一部を選択してから始めると、その部分だけについて掛け合います。",
    "「ノート末尾に保存する」で残した掛け合いには、次回から反応しません。",
    "読み上げの速度は、設定で日本語・英語それぞれ変えられます。",
    "同じ掛け合いをもう一度再生しても、Gemini は呼ばれません（料金もかかりません）。",
    "天使と悪魔の声は、30 種類の中から選べます。",
    "暴飲暴食の日記には、天使はまず全肯定してから、そっとひとつだけ提案します。",
  ],
  en: [
    "The Angel always finds one concrete thing in your note to praise.",
    "Every Devil turn hides exactly one genuinely sharp point. Listen closely.",
    "Select part of a note before starting to banter about just that part.",
    "Banter you saved with “Save to end of note” is ignored next time.",
    "Playback speed can be set separately for Japanese and English.",
    "Replaying the same banter does not call Gemini again (and costs nothing).",
    "You can pick the Angel’s and the Devil’s voices from 30 options.",
    "For a night of junk food, the Angel affirms first, then offers just one gentle nudge.",
  ],
};

export function loadingTips(): string[] {
  let ja = false;
  try {
    ja = getLanguage().toLowerCase().startsWith("ja");
  } catch {
    /* default to English */
  }
  const tips = [...(ja ? TIPS.ja : TIPS.en)];
  for (let i = tips.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tips[i], tips[j]] = [tips[j], tips[i]];
  }
  return tips;
}
