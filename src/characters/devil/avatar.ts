import { el, renderSymbol, wings } from "../../ui/symbol";

/** Devil: goat-like horns + the same wings in dark + diamond (PRD §12.3). */

const HORN_L = "M78 110 C66 106 58 94 54 82 C50 70 42 60 28 52 C40 64 46 76 46 90 C46 100 54 110 66 114 Z";
const HORN_R = "M122 110 C134 106 142 94 146 82 C150 70 158 60 172 52 C160 64 154 76 154 90 C154 100 146 110 134 114 Z";
const RIDGES = "M56 101 L64 93 M46 84 L55 78 M38 69 L46 63 M144 101 L136 93 M154 84 L145 78 M162 69 L154 63";
const GEM = "M100 130 L110 144 L100 158 L90 144 Z";

function draw(svg: SVGSVGElement): void {
  wings(svg, { shadow: "rgba(0,0,0,0.4)", rim: "#FF8CC0", fill: "#14101F", stroke: "#FF4F9A" });
  const horns = el(svg, "g", { class: "aad-horns" });
  for (const [fill, transform] of [
    ["rgba(0,0,0,0.4)", "translate(6 5)"],
    ["#FF8CC0", "translate(-4 -3)"],
    ["#14101F", ""],
  ]) {
    const g = el(horns, "g", transform ? { fill, transform } : { fill });
    el(g, "path", { d: HORN_L });
    el(g, "path", { d: HORN_R });
  }
  el(horns, "path", { d: RIDGES, fill: "none", stroke: "#FF4F9A", "stroke-width": 2, "stroke-linecap": "round", opacity: 0.85 });
  el(svg, "path", { d: GEM, fill: "#FF4F9A", stroke: "#14101F", "stroke-width": 2, "stroke-linejoin": "round", class: "aad-core aad-glow-pink" });
}

export function renderAvatar(parent: HTMLElement, label: string): SVGSVGElement {
  return renderSymbol(parent, label, draw);
}
