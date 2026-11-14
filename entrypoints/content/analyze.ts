import type { AnalysisRequest } from './extract';

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

export type Finding = {
  sentenceId: number;
  category: Category;
  /** 0–1 */
  confidence: number;
  /** Short explanation shown in the tooltip. */
  rationale: string;
  /**
   * Optional exact words within the sentence that triggered the finding (word-level highlight).
   * Omit to highlight the whole sentence.
   */
  quote?: string;
};

/**
 * Placeholder analyzer: picks random sentences and random categories.
 * Replace with a call to the real backend, e.g.
 *   const res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(request) });
 *   return (await res.json()).findings;
 * (do the fetch from the background service worker to avoid page CSP/CORS limits).
 */
export async function analyze(request: AnalysisRequest): Promise<Finding[]> {
  const categories = Object.keys(CATEGORIES) as Category[];
  const pool = [...request.sentences];
  const count = Math.min(pool.length, 4 + Math.floor(Math.random() * 5));
  const picked = Array.from({ length: count }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);

  return picked
    .sort((a, b) => a.id - b.id)
    .map((s) => {
      const category = categories[Math.floor(Math.random() * categories.length)]!;
      const words = s.text.split(' ');
      // Every other finding demonstrates a word-level highlight.
      const quote = Math.random() < 0.5 && words.length > 6 ? words.slice(2, 5).join(' ') : undefined;
      return {
        sentenceId: s.id,
        category,
        confidence: Math.round((0.55 + Math.random() * 0.4) * 100) / 100,
        rationale: `Placeholder: ${CATEGORIES[category].description}`,
        quote,
      };
    });
}
