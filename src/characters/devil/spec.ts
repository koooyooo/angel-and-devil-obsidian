import type { CharacterSpec } from "../../types";
import { renderAvatar } from "./avatar";
import persona from "./persona.md";

const spec: CharacterSpec = {
  id: "devil",
  tier: "free",
  name: { ja: "悪魔", en: "Devil", "zh-Hans": "恶魔", "zh-Hant": "惡魔", fr: "Démon", es: "Demonio", de: "Teufel" },
  ttsSpeakerName: "Devil",
  emoji: "😈",
  promptMarkdown: persona,
  defaultVoice: "Puck",
  defaultStyle: "rough, streetwise, teasing, and mischievously cynical",
  theme: {
    primary: "#ff4f9a",
    frameBg: "#d6006f",
    nameColor: "#ff8cc0",
    burstColor: "rgba(255, 79, 154, 0.24)",
  },
  renderAvatar,
};

export default spec;
