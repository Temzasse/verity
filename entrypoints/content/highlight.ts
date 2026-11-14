import { CATEGORIES, type Category, type Finding } from './analyze';
import type { ArticleSentence } from './extract';

/**
 * On-page highlights via the CSS Custom Highlight API: ranges are painted by the browser
 * without inserting any elements, so the page's DOM (and its React/Vue app) is untouched.
 */

const STYLE_ID = 'verity-highlight-style';
const ACTIVE = 'verity-active';

export type PlacedFinding = Finding & { range: Range; sentence: ArticleSentence };

/** Resolves each finding to a live range (the quoted words if given, else the sentence) and paints them. */
export function applyHighlights(findings: Finding[], sentences: ArticleSentence[]): PlacedFinding[] {
  clearHighlights();
  ensureStyle();

  const placed: PlacedFinding[] = [];
  const byName = new Map<string, Range[]>();
  for (const f of findings) {
    const sentence = sentences[f.sentenceId];
    if (!sentence) continue;
    const range = (f.quote && findQuote(sentence.range, f.quote)) || sentence.range;
    placed.push({ ...f, range, sentence });
    const key = f.source === 'quick' ? quickName(f.category) : name(f.category);
    byName.set(key, [...(byName.get(key) ?? []), range]);
  }
  for (const [key, ranges] of byName) CSS.highlights.set(key, new Highlight(...ranges));
  return placed;
}

/** Emphasizes one finding (stronger fill in its category color). */
export function setActiveHighlight(finding: PlacedFinding | null) {
  CSS.highlights.delete(ACTIVE);
  if (!finding) return;
  const hl = new Highlight(finding.range);
  hl.priority = 1;
  CSS.highlights.set(ACTIVE, hl);
  const style = ensureStyle();
  style.textContent = css(finding.category, hasLightText(finding.range));
}

/**
 * True when the passage is set in light text (dark-mode sites). The selected highlight then uses a
 * deep tint instead of a pastel one, so the text keeps its contrast either way.
 */
function hasLightText(range: Range): boolean {
  const node = range.startContainer;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return false;
  const m = getComputedStyle(el).color.match(/[\d.]+/g);
  if (!m || m.length < 3) return false;
  const [r, g, b] = m.slice(0, 3).map((v) => Number(v) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) > 0.4;
}

export function clearHighlights() {
  for (const id of Object.keys(CATEGORIES)) {
    CSS.highlights.delete(name(id as Category));
    CSS.highlights.delete(quickName(id as Category));
  }
  CSS.highlights.delete(ACTIVE);
  document.getElementById(STYLE_ID)?.remove();
}

const name = (c: Category) => `verity-${c}`;
/** Quick (on-device, unreviewed) findings: lighter fill and dotted underline. */
const quickName = (c: Category) => `verity-quick-${c}`;

function ensureStyle(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css(null);
    (document.head ?? document.documentElement).append(style);
  }
  return style;
}

function css(active: Category | null, lightText = false) {
  const rules = Object.entries(CATEGORIES).flatMap(([id, { color }]) => [
    `::highlight(${name(id as Category)}) {
      background-color: color-mix(in srgb, ${color} 14%, transparent);
      text-decoration: underline 2px color-mix(in srgb, ${color} 75%, transparent);
      text-underline-offset: 3px;
    }`,
    `::highlight(${quickName(id as Category)}) {
      background-color: color-mix(in srgb, ${color} 8%, transparent);
      text-decoration: underline dotted 2px color-mix(in srgb, ${color} 75%, transparent);
      text-underline-offset: 3px;
    }`,
  ]);
  // Pointer cursor while hovering a highlight (toggled from the content script).
  rules.push(`html[data-verity-hover], html[data-verity-hover] * { cursor: pointer !important; }`);
  if (active) {
    const { color } = CATEGORIES[active];
    // Solid tint (not see-through) that keeps the text readable: a light pastel under dark text, a
    // deep shade of the category colour under light text on dark-mode sites.
    const fill = lightText ? `color-mix(in srgb, ${color} 42%, #111)` : `color-mix(in srgb, ${color} 26%, white)`;
    rules.push(
      `::highlight(${ACTIVE}) { background-color: ${fill}; color: inherit; text-decoration: underline 2px ${color}; text-underline-offset: 3px; }`,
    );
  }
  return rules.join('\n');
}

/**
 * Finds `quote` inside `range`, ignoring case and whitespace differences, and returns a
 * sub-range covering it.
 */
function findQuote(range: Range, quote: string): Range | null {
  const root = range.commonAncestorContainer;
  const nodes: { node: Text; from: number; to: number }[] = [];
  if (root.nodeType === Node.TEXT_NODE) {
    nodes.push({ node: root as Text, from: range.startOffset, to: range.endOffset });
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(n)) continue;
      const from = n === range.startContainer ? range.startOffset : 0;
      const to = n === range.endContainer ? range.endOffset : n.length;
      if (to > from) nodes.push({ node: n, from, to });
    }
  }

  // Normalized text plus a map from each normalized char back to (node, offset).
  let norm = '';
  const map: { node: Text; offset: number }[] = [];
  for (const { node, from, to } of nodes) {
    const value = node.nodeValue ?? '';
    for (let i = from; i < to; i++) {
      const ch = /\s/.test(value[i]!) ? ' ' : value[i]!.toLowerCase();
      if (ch === ' ' && norm.endsWith(' ')) continue;
      norm += ch;
      map.push({ node, offset: i });
    }
  }

  const needle = quote.trim().replace(/\s+/g, ' ').toLowerCase();
  const at = norm.indexOf(needle);
  if (at < 0 || !needle) return null;
  const start = map[at]!;
  const last = map[at + needle.length - 1]!;
  const sub = document.createRange();
  sub.setStart(start.node, start.offset);
  sub.setEnd(last.node, last.offset + 1);
  return sub;
}
