import type { CharacterSpec, Lang, SpeakerId } from "../types";
import { CHARACTER_SPECS } from "./generated";

/**
 * Every built-in character, keyed by ID. Each one lives in `src/characters/<id>/` (spec.ts, persona.md,
 * avatar.ts) and is registered by `scripts/gen-characters.mjs`, which writes `generated.ts`.
 */
export const BUILTIN_CHARACTERS: Readonly<Record<string, CharacterSpec>> = Object.freeze(
  Object.fromEntries(CHARACTER_SPECS.map((spec) => [spec.id, spec])),
);

/** All built-in characters in directory order (for settings dropdowns and defaults). */
export const ALL_CHARACTERS: readonly CharacterSpec[] = CHARACTER_SPECS;

function builtin(id: SpeakerId): CharacterSpec {
  const spec = BUILTIN_CHARACTERS[id];
  if (!spec) throw new Error(`Built-in character "${id}" is missing from src/characters/`);
  return spec;
}

export const ANGEL_SPEC: CharacterSpec = builtin("angel");
export const DEVIL_SPEC: CharacterSpec = builtin("devil");

/** The lineup used when settings name no valid pair: `[lead, counter]`. */
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
