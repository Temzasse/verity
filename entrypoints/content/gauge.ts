/**
 * Semicircular confidence gauge: three arc segments (low → medium → high) in the accent blue,
 * from faded to vivid, with a needle pointing at the confidence value.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 48;
const H = 28;
const CX = W / 2;
const CY = 24;
const R = 18;
const STROKE = 6;
const DISPLAY_SCALE = 0.75;

// Angles in degrees, 180 = far left (0%), 0 = far right (100%); small gaps between segments.
const SEGMENTS: { from: number; to: number; strength: number }[] = [
  { from: 180, to: 123, strength: 28 },
  { from: 117, to: 63, strength: 58 },
  { from: 57, to: 0, strength: 100 },
];

export function confidenceLevel(confidence: number): 'Low' | 'Medium' | 'High' {
  return confidence < 0.5 ? 'Low' : confidence < 0.75 ? 'Medium' : 'High';
}

/** `detail` is appended to the hover text (e.g. where the confidence came from). */
export function confidenceGauge(confidence: number, detail?: string): HTMLElement {
  const c = Math.min(1, Math.max(0, confidence));
  const level = confidenceLevel(c);
  const wrap = document.createElement('span');
  wrap.className = 'gauge';
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${level} confidence (${Math.round(c * 100)}%)`);
  wrap.title = `${level} confidence (${Math.round(c * 100)}%)${detail ? `\n${detail}` : ''}`;

  // Drawn in a 48×28 coordinate space, displayed smaller.
  const svg = svgEl('svg', { width: W * DISPLAY_SCALE, height: H * DISPLAY_SCALE, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  for (const s of SEGMENTS) {
    svg.append(
      svgEl('path', {
        d: arc(s.from, s.to),
        fill: 'none',
        stroke: `color-mix(in srgb, var(--v-accent) ${s.strength}%, transparent)`,
        'stroke-width': STROKE,
        'stroke-linecap': 'round',
      }),
    );
  }

  // Needle: a tapered wedge from the hub towards the value.
  const angle = 180 - c * 180;
  const tip = point(angle, R - 2);
  const side1 = point(angle + 90, 2.6);
  const side2 = point(angle - 90, 2.6);
  svg.append(
    svgEl('polygon', { points: `${tip.x},${tip.y} ${side1.x},${side1.y} ${side2.x},${side2.y}`, fill: 'var(--v-fg)' }),
    svgEl('circle', { cx: CX, cy: CY, r: 3.6, fill: 'var(--v-fg)' }),
    svgEl('circle', { cx: CX, cy: CY, r: 1.4, fill: 'var(--v-bg)' }),
  );

  // No visible label: the level and percentage are in the hover title and the accessible name.
  wrap.append(svg);
  return wrap;
}

function point(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: round(CX + radius * Math.cos(a)), y: round(CY - radius * Math.sin(a)) };
}

function arc(fromDeg: number, toDeg: number) {
  const a = point(fromDeg, R);
  const b = point(toDeg, R);
  return `M ${a.x} ${a.y} A ${R} ${R} 0 0 1 ${b.x} ${b.y}`;
}

function svgEl(tag: string, attrs: Record<string, string | number>) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const round = (n: number) => Math.round(n * 100) / 100;
