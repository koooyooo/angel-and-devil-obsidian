import type { Lang } from "./types";

// Same rule as the CLI skill's speak.py (is_japanese_turns): any kana or CJK ideograph => Japanese.
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;

export function detectLanguage(text: string): Lang {
  return JAPANESE.test(text) ? "ja" : "en";
}
