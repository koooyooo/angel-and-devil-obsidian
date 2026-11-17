import type { CharacterSpec } from "../../types";
import { renderAvatar } from "./avatar";
import persona from "./persona.md";

const spec: CharacterSpec = {
  id: "angel",
  tier: "free",
  name: { ja: "天使", en: "Angel", "zh-Hans": "天使", "zh-Hant": "天使", fr: "Ange", es: "Ángel", de: "Engel" },
  ttsSpeakerName: "Angel",
  emoji: "😇",
  promptMarkdown: persona,
  defaultVoice: "Leda",
  defaultStyle: "warm, bright, polite, and encouraging",
  theme: {
    primary: "#ffc93c",
    frameBg: "#ffc93c",
    nameColor: "#ffc93c",
    burstColor: "rgba(255, 201, 60, 0.2)",
  },
  renderAvatar,
};

export default spec;
