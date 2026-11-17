/**
 * Characters (design doc §3.1). One directory per character:
 *
 *   src/characters/<id>/spec.ts     CharacterSpec (default export): names, emoji, theme, TTS defaults, tier
 *   src/characters/<id>/persona.md  persona prompt (copied from ../dot-agent-angel-and-devil by `make sync-prompts`)
 *   src/characters/<id>/avatar.ts   renderAvatar (built with src/ui/symbol.ts)
 *
 * Adding a directory adds a character: `scripts/gen-characters.mjs` (run before build / test) registers it
 * in `generated.ts`. The directory name must equal `spec.id` (checked in test/characters.test.ts).
 */
export { ALL_CHARACTERS, ANGEL_SPEC, BUILTIN_CHARACTERS, DEFAULT_LINEUP, DEVIL_SPEC, charName, resolveLineup } from "./registry";
