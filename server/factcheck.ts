import type Anthropic from '@anthropic-ai/sdk';
import { VERDICTS } from '../utils/analysis.ts';
import type { FactCheckRequest, FactCheckSource, Verdict } from '../utils/analysis.ts';
import { AnalysisError, MODEL, PRICE, getClient, toAnalysisError } from './claude.ts';

const MAX_SEARCHES = 3;
const SEARCH_PRICE_USD = 0.01; // $10 per 1,000 searches

// Byte-stable (no per-request data) so it can be prompt-cached.
export const FACT_CHECK_PROMPT = `You are a careful, neutral fact-checker. You receive one claim from a news article or blog post, with surrounding context. Verify the factual content of the claim using the web_search tool.

How to work:
- Search for primary or reliable sources: official statistics and government publications, court records, scientific bodies, established news agencies, and recognised fact-checkers (e.g. Full Fact, Reuters Fact Check, AP Fact Check).
- Use at most ${MAX_SEARCHES} searches. Prefer specific queries (names, numbers, dates).
- Consider the article's publication date: a claim can have been accurate when published.
- Judge only the verifiable facts, not opinions or predictions. If the claim is pure opinion, the verdict is unverifiable.

Answer format:
- A short summary for a general reader (at most 60 words): what the sources say and how that compares with the claim. Base it only on what you found.
- Then, on its own final line, exactly one verdict tag:
<verdict>supported</verdict> - reliable sources confirm the claim.
<verdict>contradicted</verdict> - reliable sources show the claim is false.
<verdict>disputed</verdict> - partly true, misleading, missing important context, or sources disagree.
<verdict>unverifiable</verdict> - not enough reliable information, or not a factual claim.`;

export async function factCheckWithClaude(req: FactCheckRequest) {
  const client = getClient();
  const published = req.publishedTime ? `\nPublished: ${req.publishedTime}` : '';
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `<article>\nTitle: ${req.title}\nURL: ${req.url}${published}\n</article>\n\n<context>\n${req.context}\n</context>\n\n<claim>\n${req.claim}\n</claim>\n\nFact-check the claim.`,
    },
  ];

  const content: Anthropic.ContentBlock[] = [];
  let costUsd = 0;
  let searches = 0;
  let response: Anthropic.Message | undefined;

  // The server may pause a long search turn (pause_turn); resend to let it continue.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        system: [{ type: 'text', text: FACT_CHECK_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
        messages,
      });
    } catch (err) {
      throw toAnalysisError(err);
    }
    const u = response.usage;
    const n = u.server_tool_use?.web_search_requests ?? 0;
    const cost =
      u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite +
      n * SEARCH_PRICE_USD;
    searches += n;
    costUsd += cost;
    content.push(...response.content);
    console.log(
      `[fact-check] in=${u.input_tokens} out=${u.output_tokens} searches=${n} stop=${response.stop_reason} cost=$${cost.toFixed(4)}`,
    );

    if (response.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: response.content });
  }

  if (response?.stop_reason === 'refusal') throw new AnalysisError('This claim could not be fact-checked.', 422);
  if (response?.stop_reason === 'max_tokens') throw new AnalysisError('The fact-check was cut off. Try again.', 502);

  // Text is split into several blocks around citations; join it back together.
  const text = content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const match = /<verdict>\s*([a-z]+)\s*<\/verdict>/i.exec(text);
  const raw = match?.[1]?.toLowerCase();
  const verdict: Verdict = raw && raw in VERDICTS ? (raw as Verdict) : 'unverifiable';
  const summary = text
    .replace(/<verdict>[\s\S]*?<\/verdict>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { verdict, summary, sources: collectSources(content), costUsd, searches };
}

/** Sources Claude actually cited first; otherwise the search results it saw. */
function collectSources(content: Anthropic.ContentBlock[]): FactCheckSource[] {
  const cited = new Map<string, FactCheckSource>();
  const seen = new Map<string, FactCheckSource>();
  for (const block of content) {
    if (block.type === 'text') {
      for (const c of block.citations ?? []) {
        if (c.type === 'web_search_result_location' && !cited.has(c.url)) {
          cited.set(c.url, { url: c.url, title: c.title ?? c.url, citedText: c.cited_text });
        }
      }
    } else if (block.type === 'web_search_tool_result') {
      if (Array.isArray(block.content)) {
        for (const r of block.content) if (!seen.has(r.url)) seen.set(r.url, { url: r.url, title: r.title });
      } else {
        console.warn('[fact-check] web search error:', block.content.error_code);
      }
    }
  }
  return [...(cited.size ? cited : seen).values()].slice(0, 5);
}
