/**
 * Shared building blocks for the symbol-style avatars (PRD §12.3).
 * Each character draws its own avatar in `src/characters/<id>/avatar.ts` with these helpers.
 * Built with DOM APIs (no innerHTML). Swap `renderAvatar` on CharacterSpec when illustrations arrive (F-4.10).
 */

const NS = "http://www.w3.org/2000/svg";

export type Attrs = Record<string, string | number>;

/** Creates an SVG element with the given attributes and appends it to `parent`. */
export function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Attrs = {}): SVGElementTagNameMap[K] {
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

export interface WingStyle {
  shadow: string;
  rim: string;
  fill: string;
  stroke: string;
}

/** Feather wings on both sides (`.aad-wing` flaps while speaking). */
export function wings(svg: SVGSVGElement, style: WingStyle): void {
  for (const [paths, wrap, side] of [
    [WING_L, WRAP_L, "l"],
    [WING_R, WRAP_R, "r"],
  ] as const) {
    const outer = el(svg, "g", { transform: wrap });
    const flap = el(outer, "g", { class: `aad-wing aad-wing-${side}` });
    const layers: Attrs[] = [
      { fill: style.shadow, transform: "translate(6 5)" },
      { fill: style.rim, transform: "translate(-3 -2)" },
      { fill: style.fill, stroke: style.stroke, "stroke-width": 2, "stroke-linejoin": "round" },
    ];
    for (const attrs of layers) {
      const g = el(flap, "g", attrs);
      for (const d of paths) el(g, "path", { d });
    }
  }
}

/** Root `<svg>` for an avatar (200×240 view box, labelled for screen readers). */
export function createSvgRoot(label: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 240");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.classList.add("aad-symbol");
  return svg;
}

/** Builds an avatar with `draw` and appends it to `parent`. */
export function renderSymbol(parent: HTMLElement, label: string, draw: (svg: SVGSVGElement) => void): SVGSVGElement {
  const svg = createSvgRoot(label);
  draw(svg);
  parent.appendChild(svg);
  return svg;
}
