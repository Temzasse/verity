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
    label: 'Claim to check',
    description: 'A factual assertion worth checking against external evidence; no judgment of falsity.',
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

/**
 * Fixed technique list. Each technique belongs to exactly one category, so a finding's category always
 * follows from its technique. Based on the SemEval-2020 Task 11 propaganda techniques, plus claim and
 * context techniques for the other categories. Keep ids stable: they're stored in cached results.
 */
export const TECHNIQUES = {
  // Propaganda
  'name-calling': {
    label: 'Name calling',
    category: 'propaganda',
    definition: 'Labelling a person or group with a loaded term instead of engaging with what they say or do.',
  },
  'appeal-to-fear': {
    label: 'Appeal to fear',
    category: 'propaganda',
    definition: 'Stirring up fear of harm, loss or danger to push a conclusion instead of giving evidence.',
  },
  'flag-waving': {
    label: 'Flag-waving',
    category: 'propaganda',
    definition: 'Appealing to national, group or "ordinary people" identity to justify a position.',
  },
  'casting-doubt': {
    label: 'Casting doubt',
    category: 'propaganda',
    definition: "Undermining someone's credibility or motives without evidence.",
  },
  bandwagon: {
    label: 'Bandwagon',
    category: 'propaganda',
    definition: 'Claiming that everyone already believes or does something, so the reader should too.',
  },
  exaggeration: {
    label: 'Exaggeration',
    category: 'propaganda',
    definition: 'Making something seem much bigger, worse or smaller than the facts support.',
  },
  slogans: {
    label: 'Slogans and clichés',
    category: 'propaganda',
    definition: 'Short catchy phrases or stock lines that replace argument and discourage further thought.',
  },
  // Loaded language
  'loaded-language': {
    label: 'Loaded language',
    category: 'loaded-language',
    definition: 'Emotionally charged words about events or actions where neutral wording was available.',
  },
  // Logical fallacies
  whataboutism: {
    label: 'Whataboutism',
    category: 'logical-fallacy',
    definition: "Deflecting criticism by pointing to someone else's wrongdoing instead of answering it.",
  },
  'straw-man': {
    label: 'Straw man',
    category: 'logical-fallacy',
    definition: "Misrepresenting an opponent's position as something weaker or more extreme, then attacking that.",
  },
  'false-dilemma': {
    label: 'False dilemma',
    category: 'logical-fallacy',
    definition: 'Presenting only two options when more exist.',
  },
  'causal-oversimplification': {
    label: 'Causal oversimplification',
    category: 'logical-fallacy',
    definition: 'Blaming a complex outcome on a single cause.',
  },
  'slippery-slope': {
    label: 'Slippery slope',
    category: 'logical-fallacy',
    definition: 'Claiming one step will inevitably lead to an extreme outcome, without showing why.',
  },
  'red-herring': {
    label: 'Red herring',
    category: 'logical-fallacy',
    definition: 'Bringing in an irrelevant point to distract from the issue.',
  },
  // Unsupported claims
  'unnamed-authority': {
    label: 'Unnamed authority',
    category: 'unsupported-claim',
    definition: 'Leaning on vague sources such as "experts say" or "studies show" without naming them.',
  },
  'unsourced-claim': {
    label: 'Unsourced claim',
    category: 'unsupported-claim',
    definition: 'A specific fact, number, event or cause stated as true with no source or evidence.',
  },
  // Missing context
  'cherry-picking': {
    label: 'Cherry-picking',
    category: 'missing-context',
    definition: 'Choosing only the facts or figures that support a point and leaving out ones that do not.',
  },
  'misleading-framing': {
    label: 'Misleading framing',
    category: 'missing-context',
    definition: 'Technically true, but presented without the baseline, comparison or context needed to judge it.',
  },
  // Misinformation
  'false-claim': {
    // Retain the stored id for compatibility; the initial scan does not establish falsity.
    label: 'Claim to check',
    category: 'misinformation',
    definition: 'A specific factual assertion that warrants verification against external sources. This flag does not establish that it is false.',
  },
} as const satisfies Record<string, { label: string; category: Category; definition: string }>;

export type TechniqueId = keyof typeof TECHNIQUES;
export const TECHNIQUE_IDS = Object.keys(TECHNIQUES) as [TechniqueId, ...TechniqueId[]];

export type Finding = {
  sentenceId: number;
  category: Category;
  /** Display name of the technique, e.g. "Appeal to fear". */
  technique: string;
  /** Id in TECHNIQUES (absent on results cached before the fixed list existed). */
  techniqueId?: TechniqueId;
  /** 0–1 */
  confidence: number;
  /** Short explanation shown in the tooltip. */
  rationale: string;
  /** Exact words within the sentence that triggered the finding. Omitted = whole sentence. */
  quote?: string;
  /** Who produced it: the smart (server AI) analysis, the default, or the on-device quick model. */
  source?: 'smart' | 'quick';
  /** True when `confidence` comes from the independent verifier instead of the analysis model. */
  verified?: boolean;
  /** The analysis model's own confidence, kept when the verifier replaced it. */
  aiConfidence?: number;
  /** Individual verifier scores (0–1), e.g. combined, fair, strict, manipulative, category. */
  checks?: Record<string, number>;
};

/** Sent to the on-device quick model (offscreen document). */
export type QuickRequest = { sentences: { id: number; text: string }[] };
export type QuickResponse = { findings: Finding[]; ms: number; device: string };

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

/** Sent to POST /fact-check for one claim. */
export type FactCheckRequest = {
  /** Version 2 returns per-claim results; omitted by older installed extensions. */
  version?: 2;
  url: string;
  title: string;
  publishedTime: string | null;
  /** The sentence (or quoted words) to verify. */
  claim: string;
  /** Surrounding sentences, so the claim can be understood. */
  context: string;
};

export const VERDICTS = {
  supported: { label: 'Supported by sources', color: '#16a34a' },
  contradicted: { label: 'Contradicted by sources', color: '#dc2626' },
  disputed: { label: 'Needs context', color: '#d97706' },
  mixed: { label: 'Mixed evidence', color: '#d97706' },
  unverifiable: { label: "Couldn't verify", color: '#64748b' },
} as const;

export type Verdict = keyof typeof VERDICTS;

export type FactCheckSource = { url: string; title: string; citedText?: string };

export type PublishedClaimReview = {
  id: string;
  claim: string;
  claimant?: string;
  claimDate?: string;
  publisher: string;
  url: string;
  title: string;
  reviewDate?: string;
  rating: string;
  status: 'used' | 'related' | 'unavailable';
  explanation: string;
};

export type ClaimAssessment = {
  claim: string;
  verdict: Verdict;
  summary: string;
  sources: FactCheckSource[];
  reviews: PublishedClaimReview[];
  reviewSearchStatus: 'complete' | 'unavailable' | 'not-configured';
};

/** Returned by POST /fact-check. */
export type FactCheckResponse = {
  claims: ClaimAssessment[];
  model: string;
  cached: boolean;
  costUsd: number;
  searches: number;
};

/** Sent to POST /verify: on-device Quick findings to re-score with the independent confidence check. */
export type VerifyRequest = { request: AnalysisRequest; findings: Finding[] };
/** Returned by POST /verify. `checked` is false when the check is off or failed (findings unchanged). */
export type VerifyResponse = { findings: Finding[]; checked: boolean };

/** Answer to "Is this finding relevant?". */
export type Vote = 'yes' | 'no' | 'unsure';
export type VoteTally = Record<Vote, number>;

/** Sent to POST /feedback when a reader answers "Is this finding relevant?" (sending again changes the vote). */
export type FeedbackRequest = {
  vote: Vote;
  /** Random id kept by the reader's browser: one vote per reader per finding. */
  voterId: string;
  url: string;
  sentence: string;
  quote?: string;
  category: Category;
  technique: string;
  confidence: number;
  source: 'smart' | 'quick';
  client: 'extension' | 'web';
};

/** Returned by POST /feedback: everyone's answers for this finding, including this reader's. */
export type FeedbackResponse = { tally: VoteTally };

/** Returned by GET /stats: usage and reader feedback since the server's stats started. */
export type StatsResponse = {
  analyses: number;
  sentences: number;
  findings: number;
  findingsByCategory: Record<string, number>;
  /** One vote per reader per finding. */
  feedback: VoteTally & { byCategory: Record<string, VoteTally> };
  since: string;
};
