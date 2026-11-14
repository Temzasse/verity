/**
 * Analysis contract shared by the extension and the server (server/). Keep this file free of
 * DOM and Node APIs so both sides can import it.
 */

/** Finding categories. Keep ids stable: they're used in CSS highlight names and API payloads. */
export const CATEGORIES = {
  propaganda: {
    label: 'Propaganda',
    description: 'Persuasion techniques meant to push an agenda rather than inform.',
    color: '#dc2626',
  },
  misinformation: {
    label: 'Misinformation',
    description: 'Claim that is false or contradicts reliable sources.',
    color: '#ea580c',
  },
  'unsupported-claim': {
    label: 'Unsupported claim',
    description: 'Factual claim stated without evidence or a source.',
    color: '#ca8a04',
  },
  'loaded-language': {
    label: 'Loaded language',
    description: 'Emotionally charged words used to sway the reader.',
    color: '#db2777',
  },
  'logical-fallacy': {
    label: 'Logical fallacy',
    description: 'Flawed reasoning, e.g. straw man, false dilemma, whataboutism.',
    color: '#7c3aed',
  },
  'missing-context': {
    label: 'Missing context',
    description: 'Cherry-picked or misleading framing; true but incomplete.',
    color: '#0891b2',
  },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as [Category, ...Category[]];

export type Finding = {
  sentenceId: number;
  category: Category;
  /** Specific technique within the category, e.g. "Appeal to fear", "Straw man". */
  technique: string;
  /** 0–1 */
  confidence: number;
  /** Short explanation shown in the tooltip. */
  rationale: string;
  /** Exact words within the sentence that triggered the finding. Omitted = whole sentence. */
  quote?: string;
};

/** Sent by the extension to POST /analyze. */
export type AnalysisRequest = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  lang: string;
  excerpt: string | null;
  isArticle: boolean;
  sentences: { id: number; text: string; block: number }[];
};

/** Returned by POST /analyze. */
export type AnalysisResponse = {
  findings: Finding[];
  model: string;
  /** True when served from the server's result cache (no API call, no cost). */
  cached: boolean;
  /** Estimated USD cost of this request (0 when cached). */
  costUsd: number;
};
