import { CATEGORIES, CATEGORY_IDS, TECHNIQUES, type AnalysisRequest, type Category, type Finding } from '../utils/analysis.ts';

/**
 * Independent confidence for Smart analysis findings, from TypeSafe's Jev decision model
 * (https://docs.typesafe.ai). Target meaning: "how likely is it that a careful media-literacy reviewer
 * would agree this flag is correct". The whole article is the shared state; per finding we ask:
 *
 *  - fair:     yes/no, "would an expert agree this passage is a fair example of the technique?"
 *  - manip:    yes/no, "does the passage use any manipulation technique in the author's own voice?"
 *  - category: multiple choice over our six categories (Jev returns a probability per option)
 *  - strict:   the first version's yes/no question ("clear instance only", several exclusions), kept for comparison
 *
 * combined = P(manip) × P(category = the finding's category). JEV_SCORE picks which one becomes the
 * finding's confidence (default: fair); all are logged side by side and stored in `checks`.
 * Note: our categories overlap (name calling is both propaganda and loaded language), so the category
 * choice can split or misplace its probability and drag "combined" down for a correct flag.
 *
 * Config (server/.env): TYPESAFE_API_KEY enables it; VERIFIER=none turns it off; JEV_MODEL pins the model.
 * Any failure keeps the analysis model's own confidence, so scans never fail because of it.
 */
const API_KEY = process.env.TYPESAFE_API_KEY;
const MODEL = process.env.JEV_MODEL || 'jev-1.14.0';
const SCORES = ['combined', 'fair', 'strict'] as const;
type ScoreName = (typeof SCORES)[number];
const SCORE: ScoreName = (SCORES as readonly string[]).includes(process.env.JEV_SCORE ?? '') ? (process.env.JEV_SCORE as ScoreName) : 'fair';
const TIMEOUT_MS = 15_000;
/** Findings per request: keeps each request well under Jev's 64k-token limit with the article as state. */
const CHUNK = 10;
/** Article text sent as context (~8k tokens). */
const MAX_ARTICLE_CHARS = 32_000;

export const VERIFIER_ENABLED = !!API_KEY && process.env.VERIFIER !== 'none';
/** Part of the analysis cache key, so results checked with a different setup aren't reused. */
export const VERIFIER_VERSION = VERIFIER_ENABLED ? `jev:${MODEL}:q3:${SCORE}` : 'none';

type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
type SystemOneResponse = { model: string; answers: Record<string, Answer>; usage?: { input_tokens: number } };
type Question =
  | { type: 'noul'; instructions: Record<string, string> }
  | { type: 'choice'; instructions: Record<string, string>; criteria: Record<string, string> };

/** Choice option name (sent to the model) → category id. */
const OPTION_TO_CATEGORY = new Map<string, Category>(CATEGORY_IDS.map((id) => [CATEGORIES[id].label, id]));
const CATEGORY_CRITERIA = Object.fromEntries(CATEGORY_IDS.map((id) => [CATEGORIES[id].label, CATEGORIES[id].description]));
const QUOTING_RULE =
  "Quoting or reporting someone else's words does not count unless the article itself adopts or amplifies them.";

export async function verifyFindings(findings: Finding[], req: AnalysisRequest, label = 'smart'): Promise<Finding[]> {
  if (!VERIFIER_ENABLED || findings.length === 0) return findings;
  const started = Date.now();
  const state = articleState(req);
  const chunks: Finding[][] = [];
  for (let i = 0; i < findings.length; i += CHUNK) chunks.push(findings.slice(i, i + CHUNK));

  let results: Finding[][];
  try {
    results = await Promise.all(chunks.map((chunk) => verifyChunk(chunk, req, state, label)));
  } catch (err) {
    console.warn(`[jev] verification failed, keeping the analysis model's confidence: ${err instanceof Error ? err.message : err}`);
    return findings;
  }
  console.log(`[jev] checked ${findings.length} ${label} findings in ${Date.now() - started} ms; showing "${SCORE}" as confidence`);
  return results.flat();
}

async function verifyChunk(findings: Finding[], req: AnalysisRequest, state: unknown, label: string): Promise<Finding[]> {
  const byId = new Map(req.sentences.map((s) => [s.id, s]));
  const questions: Record<string, Question> = {};
  findings.forEach((f, i) => {
    const sentence = byId.get(f.sentenceId);
    if (!sentence) return;
    const category = CATEGORIES[f.category];
    // Fixed-list techniques have their own definition; older cached findings fall back to the category's.
    const definition = f.techniqueId ? TECHNIQUES[f.techniqueId].definition : category.description;
    const passage = {
      passage: sentence.text,
      ...(f.quote ? { flaggedWords: f.quote } : {}),
      surroundingText: req.sentences
        .filter((s) => s.block === sentence.block && Math.abs(s.id - f.sentenceId) <= 2)
        .map((s) => s.text)
        .join(' '),
    };
    questions[`fair${i}`] = {
      type: 'noul',
      instructions: {
        question:
          `Would a careful media-literacy expert agree that this passage from the article is a fair example of ` +
          `the technique "${f.technique}" (${definition})? ${QUOTING_RULE}`,
        ...passage,
      },
    };
    questions[`manip${i}`] = {
      type: 'noul',
      instructions: {
        question:
          'Does this passage from the article use any manipulation technique in the article\'s own voice: ' +
          'emotionally loaded wording, propaganda techniques, logical fallacies, factual claims without a source, ' +
          `misleading framing or missing context, or false claims? ${QUOTING_RULE}`,
        ...passage,
      },
    };
    questions[`cat${i}`] = {
      type: 'choice',
      instructions: {
        question: 'Which category best describes the manipulation technique used in this passage from the article?',
        ...passage,
      },
      criteria: CATEGORY_CRITERIA,
    };
    questions[`strict${i}`] = {
      type: 'noul',
      instructions: {
        question:
          `Does the sentence below use the manipulation technique "${f.technique}" (category: ${category.label}) ` +
          `in the article's own voice? Answer yes only for a clear instance. Answer no if the wording is neutral ` +
          `or fair, if the claim is properly attributed or sourced, or if the article is only quoting or reporting ` +
          `someone else's words without adopting them.`,
        techniqueDefinition: definition,
        sentence: sentence.text,
        ...(f.quote ? { flaggedWords: f.quote } : {}),
        surroundingText: passage.surroundingText,
      },
    };
  });

  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  const data = (await res.json().catch(() => null)) as (SystemOneResponse & { error?: unknown; message?: string }) | null;
  if (!res.ok || !data?.answers) throw new Error(`HTTP ${res.status} ${JSON.stringify(data?.error ?? data?.message ?? '')}`);
  console.log(`[jev] ${data.model}: ${findings.length} ${label} findings, ${data.usage?.input_tokens ?? '?'} input tokens`);

  return findings.map((f, i) => {
    const noul = (id: string) => {
      const a = data.answers[id];
      return a?.type === 'noul' && Number.isFinite(a.noul) ? clamp(a.noul) : null;
    };
    const fair = noul(`fair${i}`);
    const manip = noul(`manip${i}`);
    const strict = noul(`strict${i}`);
    const cat = data.answers[`cat${i}`];
    const pCategory = cat?.type === 'choice' ? clamp(cat.probabilities[CATEGORIES[f.category].label] ?? 0) : null;
    const topCategory = cat?.type === 'choice' ? (OPTION_TO_CATEGORY.get(cat.choice) ?? cat.choice) : null;
    const combined = manip !== null && pCategory !== null ? manip * pCategory : null;
    const scores: Record<ScoreName, number | null> = { combined, fair, strict };
    const shown = scores[SCORE];

    const n = (v: number | null) => (v === null ? ' -- ' : v.toFixed(2));
    console.log(
      `[jev]   ${SCORE}=${n(shown)} | strict ${n(strict)} | fair ${n(fair)} | manip ${n(manip)} × cat ${n(pCategory)}` +
        `${topCategory && topCategory !== f.category ? ` (top: ${topCategory})` : ''} | ai ${f.confidence.toFixed(2)} | ` +
        `${f.category} / ${f.technique}: "${(f.quote ?? byId.get(f.sentenceId)?.text ?? '').slice(0, 60)}"`,
    );
    if (shown === null) return f;
    const checks: Record<string, number> = {};
    for (const [k, v] of Object.entries({ combined, fair, strict, manipulative: manip, category: pCategory })) {
      if (v !== null) checks[k] = Math.round(v * 1000) / 1000;
    }
    return { ...f, aiConfidence: f.confidence, confidence: shown, verified: true, checks };
  });
}

/** The article as Jev's shared state, paragraph by paragraph, capped in length. */
function articleState(req: AnalysisRequest) {
  const paragraphs: string[] = [];
  let block: number | null = null;
  let length = 0;
  for (const s of req.sentences) {
    if (length > MAX_ARTICLE_CHARS) break;
    if (s.block !== block) paragraphs.push(s.text);
    else paragraphs[paragraphs.length - 1] += ` ${s.text}`;
    block = s.block;
    length += s.text.length + 1;
  }
  return { title: req.title, site: req.siteName ?? '', article: paragraphs };
}

const clamp = (v: number) => Math.min(1, Math.max(0, v));
