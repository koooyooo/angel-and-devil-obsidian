import angelPersona from "./prompts/angel.md";
import devilPersona from "./prompts/devil.md";
import type { CharacterSpec, Lang, SpeakerId } from "./types";
import { renderAngelAvatar, renderDevilAvatar } from "./ui/characters";

export const ANGEL_SPEC: CharacterSpec = {
  id: "angel",
  tier: "free",
  name: { ja: "天使", en: "Angel", "zh-Hans": "天使", "zh-Hant": "天使", fr: "Ange", es: "Ángel", de: "Engel" },
  ttsSpeakerName: "Angel",
  emoji: "😇",
  promptMarkdown: angelPersona,
  defaultVoice: "Leda",
  defaultStyle: "warm, bright, polite, and encouraging",
  theme: {
    primary: "#ffc93c",
    frameBg: "#ffc93c",
    nameColor: "#ffc93c",
    burstColor: "rgba(255, 201, 60, 0.2)",
  },
  renderAvatar: renderAngelAvatar,
};

export const DEVIL_SPEC: CharacterSpec = {
  id: "devil",
  tier: "free",
  name: { ja: "悪魔", en: "Devil", "zh-Hans": "恶魔", "zh-Hant": "惡魔", fr: "Démon", es: "Demonio", de: "Teufel" },
  ttsSpeakerName: "Devil",
  emoji: "😈",
  promptMarkdown: devilPersona,
  defaultVoice: "Puck",
  defaultStyle: "rough, streetwise, teasing, and mischievously cynical",
  theme: {
    primary: "#ff4f9a",
    frameBg: "#d6006f",
    nameColor: "#ff8cc0",
    burstColor: "rgba(255, 79, 154, 0.24)",
  },
  renderAvatar: renderDevilAvatar,
};

export const BUILTIN_CHARACTERS: Readonly<Record<string, CharacterSpec>> = {
  angel: ANGEL_SPEC,
  devil: DEVIL_SPEC,
};

export const DEFAULT_LINEUP: readonly [CharacterSpec, CharacterSpec] = [ANGEL_SPEC, DEVIL_SPEC];

/** Returns the localized display name for a character, falling back to English or the ID. */
export function charName(spec: CharacterSpec, lang: Lang): string {
  return spec.name[lang] ?? spec.name.en ?? spec.id;
}

/**
 * Resolves a two-slot lineup `[lead, counter]` from character IDs.
 * Falls back to `[ANGEL_SPEC, DEVIL_SPEC]` when an ID is unknown or both slots name the same character.
 */
export function resolveLineup(
  lineupIds?: readonly SpeakerId[],
  registry: Readonly<Record<string, CharacterSpec>> = BUILTIN_CHARACTERS,
): [CharacterSpec, CharacterSpec] {
  if (!Array.isArray(lineupIds) || lineupIds.length < 2) return [ANGEL_SPEC, DEVIL_SPEC];
  const lead = registry[lineupIds[0]];
  const counter = registry[lineupIds[1]];
  if (!lead || !counter || lead.id === counter.id) return [ANGEL_SPEC, DEVIL_SPEC];
  return [lead, counter];
}
