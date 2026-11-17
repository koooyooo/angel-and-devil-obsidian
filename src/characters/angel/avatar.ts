import { el, renderSymbol, wings } from "../../ui/symbol";

/** Angel: halo + white feather wings + star (PRD §12.3). */

const STAR = "M100 128 L104 140 L116 144 L104 148 L100 160 L96 148 L84 144 L96 140 Z";

function draw(svg: SVGSVGElement): void {
  const halo = el(svg, "g", { class: "aad-halo" });
  el(halo, "ellipse", { cx: 104, cy: 69, rx: 52, ry: 14, fill: "none", stroke: "rgba(27,22,51,0.45)", "stroke-width": 9, transform: "rotate(-8 104 69)" });
  el(halo, "ellipse", { cx: 100, cy: 64, rx: 52, ry: 14, fill: "none", stroke: "#1B1633", "stroke-width": 11, transform: "rotate(-8 100 64)" });
  el(halo, "ellipse", { cx: 100, cy: 64, rx: 52, ry: 14, fill: "none", stroke: "#FFFFFF", "stroke-width": 6, transform: "rotate(-8 100 64)", class: "aad-glow-white" });
  wings(svg, { shadow: "rgba(27,22,51,0.45)", rim: "rgba(255,255,255,0)", fill: "#FFFFFF", stroke: "#1B1633" });
  el(svg, "path", { d: STAR, fill: "#FFFFFF", stroke: "#1B1633", "stroke-width": 2, "stroke-linejoin": "round", class: "aad-core aad-glow-white" });
}

export function renderAvatar(parent: HTMLElement, label: string): SVGSVGElement {
  return renderSymbol(parent, label, draw);
}
