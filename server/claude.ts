import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORY_IDS } from '../utils/analysis.ts';
import type { AnalysisRequest, Finding } from '../utils/analysis.ts';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.ts';

export const MODEL = 'claude-haiku-5-5';

// Claude Haiku 5.5 rates (USD per token) for prompts up to 100K tokens.
export const PRICE = { input: 0.1e-6, output: 0.5e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6 };

const FindingsSchema = z.object({
  findings: z.array(
    z.object({
      sentence_id: z.number().int(),
      category: z.enum(CATEGORY_IDS),
      technique: z.string(),
      quote: z.string(),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
});

// Uses only ANTHROPIC_API_KEY from server/.env (loaded by `pnpm server`), never other credentials
// that may exist on the machine, so the hackathon key is the one that gets billed.
let client: Anthropic | undefined;
export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnalysisError('ANTHROPIC_API_KEY is not set. Add it to server/.env and restart `pnpm server`.', 500);
  client ??= new Anthropic({ apiKey });
  return client;
}

export class AnalysisError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function analyzeWithClaude(req: AnalysisRequest): Promise<{ findings: Finding[]; costUsd: number }> {
  let response;
  try {
    response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(FindingsSchema) },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildUserMessage(req) }],
    });
  } catch (err) {
    throw toAnalysisError(err);
  }

  const u = response.usage;
  const costUsd =
    u.input_tokens * PRICE.input +
    u.output_tokens * PRICE.output +
    (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
    (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite;
  console.log(
    `[claude] in=${u.input_tokens} out=${u.output_tokens} cacheRead=${u.cache_read_input_tokens ?? 0} ` +
      `cacheWrite=${u.cache_creation_input_tokens ?? 0} stop=${response.stop_reason} cost=$${costUsd.toFixed(4)}`,
  );

  if (response.stop_reason === 'refusal') throw new AnalysisError('Claude declined to analyze this page', 422);
  if (response.stop_reason === 'max_tokens') throw new AnalysisError('Analysis was cut off (max_tokens)', 502);
  if (!response.parsed_output) throw new AnalysisError('Claude returned output that did not match the schema', 502);

  return { findings: validateFindings(response.parsed_output.findings, req), costUsd };
}

/** Maps SDK errors to messages the extension can show. */
export function toAnalysisError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) return new AnalysisError('Invalid ANTHROPIC_API_KEY (check server/.env)', 500);
  if (err instanceof Anthropic.RateLimitError) return new AnalysisError('Claude API rate limit hit, retry in a moment', 429);
  if (err instanceof Anthropic.BadRequestError) return new AnalysisError(`Claude API rejected the request: ${err.message}`, 502);
  if (err instanceof Anthropic.APIError) return new AnalysisError(`Claude API error ${err.status}: ${err.message}`, 502);
  return err;
}

/** Drops findings that point at unknown sentences or quote words that aren't in the sentence. */
function validateFindings(raw: z.infer<typeof FindingsSchema>['findings'], req: AnalysisRequest): Finding[] {
  const byId = new Map(req.sentences.map((s) => [s.id, s.text]));
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const f of raw) {
    const sentence = byId.get(f.sentence_id);
    if (sentence == null) continue;
    const quote = f.quote.trim();
    if (quote && !norm(sentence).includes(norm(quote))) {
      console.warn(`[claude] dropped finding: quote not in sentence ${f.sentence_id}: "${quote}"`);
      continue;
    }
    const key = `${f.sentence_id}:${f.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sentenceId: f.sentence_id,
      category: f.category,
      technique: f.technique.trim(),
      confidence: Math.min(1, Math.max(0, f.confidence)),
      rationale: f.rationale.trim(),
      quote: quote || undefined,
    });
  }
  return out.slice(0, 15).sort((a, b) => a.sentenceId - b.sentenceId);
}
