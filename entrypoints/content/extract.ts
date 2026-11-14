import { Readability } from '@mozilla/readability';
import type { AnalysisRequest } from '@/utils/analysis';

/**
 * Extracts the main article text from the live page, split into sentences, keeping each
 * sentence's position in the live DOM so it can be highlighted and scrolled to.
 *
 * How it works:
 * 1. Clone the document and tag every cloned element with its index (`data-verity-id`),
 *    keeping a parallel list of the matching live elements.
 * 2. Run Readability (Firefox Reader View's engine) on the clone. It strips nav, ads,
 *    comments, related links etc. and keeps the article body (with our ids).
 * 3. A live text node belongs to the article if its parent element's id survived.
 * 4. Text is grouped per block element (p, h2, li…) and split into sentences with
 *    Intl.Segmenter; sentence offsets map back to DOM Ranges.
 */

export type ArticleSentence = {
  id: number;
  /** Whitespace-normalized sentence text (what gets sent for analysis). */
  text: string;
  /** Live DOM range covering the sentence. */
  range: Range;
  /** Index of the block (paragraph, heading, list item…) the sentence belongs to. */
  block: number;
};

export type PageContent = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  lang: string;
  excerpt: string | null;
  /** True when Readability found an article; false means we fell back to the whole body. */
  isArticle: boolean;
  sentences: ArticleSentence[];
};


const ID_ATTR = 'data-verity-id';
const MIN_WORDS = 4;
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
]);
// Never prose: code, footnote markers, scripts, form controls.
const SKIP = 'pre, sup, script, style, noscript, template, svg, button, select, textarea, verity-overlay';
const FALLBACK_SKIP = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [aria-hidden="true"]';
// Footnotes, reference lists, citations and captions: not part of the article's claims.
const NOT_PROSE =
  '.references, .reflist, .mw-references-wrap, .footnotes, .citation, cite, figcaption, [role="doc-endnotes"], [role="doc-bibliography"], [role="doc-biblioentry"]';

export function extractPageContent(): PageContent {
  const live: Element[] = [];
  const clone = document.cloneNode(true) as Document;

  // Tag clone elements and record their live counterparts (identical tree structure).
  const liveWalker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  const cloneWalker = clone.createTreeWalker(clone.documentElement, NodeFilter.SHOW_ELEMENT);
  for (let l: Node | null = liveWalker.currentNode, c: Node | null = cloneWalker.currentNode; l && c; ) {
    (c as Element).setAttribute(ID_ATTR, String(live.length));
    live.push(l as Element);
    l = liveWalker.nextNode();
    c = cloneWalker.nextNode();
  }

  const article = new Readability(clone, { keepClasses: true }).parse();

  let keep: (el: Element) => boolean;
  if (article?.content) {
    const kept = new Set<Element>();
    const parsed = new DOMParser().parseFromString(article.content, 'text/html');
    for (const el of parsed.querySelectorAll(`[${ID_ATTR}]`)) {
      const liveEl = live[Number(el.getAttribute(ID_ATTR))];
      if (liveEl) kept.add(liveEl);
    }
    keep = (el) => kept.has(el);
  } else {
    keep = (el) => !el.closest(FALLBACK_SKIP);
  }

  return {
    url: location.href,
    title: article?.title || document.title,
    byline: article?.byline ?? null,
    siteName: article?.siteName ?? null,
    publishedTime: article?.publishedTime ?? null,
    lang: article?.lang || document.documentElement.lang || navigator.language,
    excerpt: article?.excerpt ?? null,
    isArticle: !!article?.content,
    sentences: splitSentences(collectBlocks(keep), article?.lang || document.documentElement.lang),
  };
}

export function toAnalysisRequest(content: PageContent): AnalysisRequest {
  return {
    ...content,
    sentences: content.sentences.map(({ id, text, block }) => ({ id, text, block })),
  };
}

type Piece = { node: Text; start: number; end: number };
type Block = { text: string; pieces: Piece[] };

/** Groups the article's live text nodes by their nearest block-level ancestor. */
function collectBlocks(keep: (el: Element) => boolean): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let currentBlockEl: Element | null = null;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIP) || parent.closest(NOT_PROSE)) return NodeFilter.FILTER_REJECT;
      return keep(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const blockEl = nearestBlock(node);
    if (blockEl !== currentBlockEl || !current) {
      current = { text: '', pieces: [] };
      blocks.push(current);
      currentBlockEl = blockEl;
    }
    const value = node.nodeValue!;
    current.pieces.push({ node, start: current.text.length, end: current.text.length + value.length });
    current.text += value;
  }
  return blocks;
}

function nearestBlock(node: Node): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCK_TAGS.has(el.tagName.toUpperCase())) return el;
  }
  return null;
}

function splitSentences(blocks: Block[], lang?: string): ArticleSentence[] {
  const segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
  const sentences: ArticleSentence[] = [];

  blocks.forEach((block, blockIndex) => {
    for (const seg of segmenter.segment(block.text)) {
      // Trim surrounding whitespace so the range hugs the visible text.
      const lead = seg.segment.length - seg.segment.trimStart().length;
      const trimmed = seg.segment.trim();
      if (!trimmed) continue;
      const text = trimmed.replace(/\s+/g, ' ');
      if (text.split(' ').length < MIN_WORDS) continue;

      const start = seg.index + lead;
      const range = rangeFromOffsets(block, start, start + trimmed.length);
      if (range) sentences.push({ id: sentences.length, text, range, block: blockIndex });
    }
  });
  return sentences;
}

/** Converts [start, end) offsets within a block's concatenated text into a live DOM Range. */
function rangeFromOffsets(block: Block, start: number, end: number): Range | null {
  const a = locate(block, start, false);
  const b = locate(block, end, true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}

function locate(block: Block, offset: number, isEnd: boolean) {
  for (const p of block.pieces) {
    if (isEnd ? offset > p.start && offset <= p.end : offset >= p.start && offset < p.end) {
      return { node: p.node, offset: offset - p.start };
    }
  }
  return null;
}
