import type { Speaker } from "../types";

/**
 * Symbol-style characters (PRD §12.3): Angel = halo + feather wings + star,
 * Devil = goat-like horns + the same wings in dark + diamond.
 * Built with DOM APIs (no innerHTML). Swap `renderAvatar` on CharacterSpec when illustrations arrive (F-4.10).
 */

const NS = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number>;

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent.appendChild(node);
  return node;
}

const WING_L = [
  "M90 128 C70 96 40 78 8 74 C30 92 50 112 66 138 Z",
  "M90 134 C66 118 38 112 14 116 C36 128 54 140 70 152 Z",
  "M90 140 C70 138 48 144 28 156 C48 160 62 164 76 166 Z",
  "M92 146 C78 154 66 168 58 186 C72 178 84 170 94 160 Z",
];
const WING_R = [
  "M110 128 C130 96 160 78 192 74 C170 92 150 112 134 138 Z",
  "M110 134 C134 118 162 112 186 116 C164 128 146 140 130 152 Z",
  "M110 140 C130 138 152 144 172 156 C152 160 138 164 124 166 Z",
  "M108 146 C122 154 134 168 142 186 C128 178 116 170 106 160 Z",
];
const WRAP_L = "translate(-20 8) translate(92 140) scale(0.85) translate(-92 -140)";
const WRAP_R = "translate(20 8) translate(108 140) scale(0.85) translate(-108 -140)";

const HORN_L = "M78 110 C66 106 58 94 54 82 C50 70 42 60 28 52 C40 64 46 76 46 90 C46 100 54 110 66 114 Z";
const HORN_R = "M122 110 C134 106 142 94 146 82 C150 70 158 60 172 52 C160 64 154 76 154 90 C154 100 146 110 134 114 Z";
const RIDGES = "M56 101 L64 93 M46 84 L55 78 M38 69 L46 63 M144 101 L136 93 M154 84 L145 78 M162 69 L154 63";
const STAR = "M100 128 L104 140 L116 144 L104 148 L100 160 L96 148 L84 144 L96 140 Z";
const GEM = "M100 130 L110 144 L100 158 L90 144 Z";

interface WingStyle {
  shadow: string;
  rim: string;
  fill: string;
  stroke: string;
}

function wings(svg: SVGSVGElement, style: WingStyle): void {
  for (const [paths, wrap, side] of [
    [WING_L, WRAP_L, "l"],
    [WING_R, WRAP_R, "r"],
  ] as const) {
    const outer = el(svg, "g", { transform: wrap });
    const flap = el(outer, "g", { class: `aad-wing aad-wing-${side}` });
    const layers: Array<[Attrs, string]> = [
      [{ fill: style.shadow, transform: "translate(6 5)" }, "shadow"],
      [{ fill: style.rim, transform: "translate(-3 -2)" }, "rim"],
      [{ fill: style.fill, stroke: style.stroke, "stroke-width": 2, "stroke-linejoin": "round" }, "body"],
    ];
    for (const [attrs] of layers) {
      const g = el(flap, "g", attrs);
      for (const d of paths) el(g, "path", { d });
    }
  }
}

function angel(svg: SVGSVGElement): void {
  const halo = el(svg, "g", { class: "aad-halo" });
  el(halo, "ellipse", { cx: 104, cy: 69, rx: 52, ry: 14, fill: "none", stroke: "rgba(27,22,51,0.45)", "stroke-width": 9, transform: "rotate(-8 104 69)" });
  el(halo, "ellipse", { cx: 100, cy: 64, rx: 52, ry: 14, fill: "none", stroke: "#1B1633", "stroke-width": 11, transform: "rotate(-8 100 64)" });
  el(halo, "ellipse", { cx: 100, cy: 64, rx: 52, ry: 14, fill: "none", stroke: "#FFFFFF", "stroke-width": 6, transform: "rotate(-8 100 64)", class: "aad-glow-white" });
  wings(svg, { shadow: "rgba(27,22,51,0.45)", rim: "rgba(255,255,255,0)", fill: "#FFFFFF", stroke: "#1B1633" });
  el(svg, "path", { d: STAR, fill: "#FFFFFF", stroke: "#1B1633", "stroke-width": 2, "stroke-linejoin": "round", class: "aad-core aad-glow-white" });
}

function devil(svg: SVGSVGElement): void {
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

function createSvgRoot(label: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 240");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.classList.add("aad-symbol");
  return svg;
}

export function renderAngelAvatar(parent: HTMLElement, label: string): SVGSVGElement {
  const svg = createSvgRoot(label);
  angel(svg);
  parent.appendChild(svg);
  return svg;
}

export function renderDevilAvatar(parent: HTMLElement, label: string): SVGSVGElement {
  const svg = createSvgRoot(label);
  devil(svg);
  parent.appendChild(svg);
  return svg;
}

export function buildCharacter(parent: HTMLElement, speaker: Speaker, label: string): SVGSVGElement {
  return speaker === "angel" ? renderAngelAvatar(parent, label) : renderDevilAvatar(parent, label);
}
