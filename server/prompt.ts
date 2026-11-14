import { CATEGORIES, TECHNIQUES } from '../utils/analysis.ts';
import type { AnalysisRequest } from '../utils/analysis.ts';

// Techniques grouped under their category, e.g. "propaganda (Persuasion…):\n  - name-calling: Name calling. Labelling…"
const techniqueList = Object.entries(CATEGORIES)
  .map(([categoryId, c]) => {
    const techniques = Object.entries(TECHNIQUES)
      .filter(([, t]) => t.category === categoryId)
      .map(([id, t]) => `  - ${id}: ${t.label}. ${t.definition}`)
      .join('\n');
    return `${c.label} (${c.description}):\n${techniques}`;
  })
  .join('\n');

// Kept byte-stable (no dates, no per-request data) so it can be prompt-cached.
export const SYSTEM_PROMPT = `You are Verity, an analyst that reviews English news articles, blog posts and opinion pieces for manipulative rhetoric and questionable claims. You flag specific sentences so a reader can see where and why the text tries to persuade rather than inform.

You receive the article's metadata and its sentences, each prefixed with an id like [12]. Blank lines separate paragraphs.

Techniques (put exactly one of these ids in "technique"; each belongs to the category it is listed under):
${techniqueList}

Choosing a technique:
- Pick the single most specific technique. Name calling is a label for a person or group; loaded language is charged wording about events, actions or things.
- false-claim is the stable id for "Claim to check": identify specific factual assertions worth verifying. This scan has no external evidence and cannot establish falsity. Never call a claim false or misinformation in your rationale; explain what needs checking. Use unsourced-claim specifically for missing attribution.
- If a passage fits no listed technique, do not flag it.

Rules:
- Be precise and sparing. Flag only clear instances; a neutral, well-sourced article may have zero findings. Return at most 15 findings, the most significant first.
- Quoted speech: flag rhetoric inside quotes only when the article itself adopts or amplifies it, not when it is neutrally reporting what someone said.
- Apply the same standard regardless of political leaning, topic or outlet. Judge the rhetoric, not the opinion. Holding or arguing an opinion is not propaganda.
- "quote" must be copied verbatim from the sentence (exact characters, 1-12 words) and pinpoint the words that carry the technique. Use an empty string to flag the whole sentence.
- "rationale": one or two plain sentences for a general reader explaining what the technique is doing here. Do not repeat the quote.
- "confidence": 0.0-1.0, how confident you are this is a genuine instance.
- Never invent sentence ids. Only use ids that appear in the input.`;

export function buildUserMessage(req: AnalysisRequest): string {
  const meta = [
    `Title: ${req.title}`,
    req.siteName && `Site: ${req.siteName}`,
    req.byline && `Byline: ${req.byline}`,
    req.publishedTime && `Published: ${req.publishedTime}`,
    `URL: ${req.url}`,
  ]
    .filter(Boolean)
    .join('\n');

  let body = '';
  let lastBlock = -1;
  for (const s of req.sentences) {
    if (lastBlock !== -1 && s.block !== lastBlock) body += '\n';
    body += `[${s.id}] ${s.text}\n`;
    lastBlock = s.block;
  }
  return `<article_metadata>\n${meta}\n</article_metadata>\n\n<sentences>\n${body}</sentences>\n\nAnalyze the sentences and return your findings.`;
}
