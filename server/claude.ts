import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { TECHNIQUES, TECHNIQUE_IDS } from '../utils/analysis.ts';
import type { AnalysisRequest, Finding } from '../utils/analysis.ts';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.ts';

/** Override with VERITY_MODEL, e.g. when a router names models differently. */
export const MODEL = process.env.VERITY_MODEL || 'claude-haiku-5-5';

// Claude Haiku 5.5 rates (USD per token) for prompts up to 100K tokens.
export const PRICE = { input: 0.1e-6, output: 0.5e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6 };

const FindingsSchema = z.object({
  findings: z.array(
    z.object({
      sentence_id: z.number().int(),
      technique: z.enum(TECHNIQUE_IDS),
      quote: z.string(),
      confidence: z.number(),
      rationale: z.string(),
    }),
  ),
});

// Uses only ANTHROPIC_API_KEY from server/.env (loaded by `pnpm server`), never other credentials
// that may exist on the machine, so the hackathon key is the one that gets billed.
// ANTHROPIC_BASE_URL optionally points the SDK at an Anthropic-compatible router (e.g. Hostinger AI Router).
let client: Anthropic | undefined;
export function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[claude] ANTHROPIC_API_KEY is not set. Add it to server/.env and restart `pnpm server`.');
    throw new AnalysisError('The analysis server is missing its API key (server/.env).', 500);
  }
  client ??= new Anthropic({ apiKey, ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}) });
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

  if (response.stop_reason === 'refusal') throw new AnalysisError('The smart analysis could not analyze this page.', 422);
  if (response.stop_reason === 'max_tokens') throw new AnalysisError('The smart analysis was cut off. Try again.', 502);
  if (!response.parsed_output) throw new AnalysisError('The smart analysis returned an unexpected result. Try again.', 502);

  return { findings: validateFindings(response.parsed_output.findings, req), costUsd };
}

/**
 * Maps SDK errors to messages the extension can show. End users see neutral wording; the
 * specifics (which provider, status, message) go to the server log.
 */
export function toAnalysisError(err: unknown): unknown {
  if (!(err instanceof Anthropic.APIError)) return err;
  console.error(`[claude] API error ${err.status}: ${err.message}`);
  if (err instanceof Anthropic.AuthenticationError) {
    return new AnalysisError('The analysis server is misconfigured (invalid API key in server/.env).', 500);
  }
  if (err instanceof Anthropic.RateLimitError) return new AnalysisError('The analysis service is busy. Try again in a moment.', 429);
  if (err instanceof Anthropic.BadRequestError) {
    // Includes running out of API credit.
    return new AnalysisError('The analysis service rejected the request. See the server log for details.', 502);
  }
  return new AnalysisError('The analysis service is unavailable right now. Try again later.', 502);
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
    const technique = TECHNIQUES[f.technique];
    if (!technique) continue;
    const key = `${f.sentence_id}:${technique.category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sentenceId: f.sentence_id,
      category: technique.category,
      technique: technique.label,
      techniqueId: f.technique,
      confidence: Math.min(1, Math.max(0, f.confidence)),
      rationale: f.rationale.trim(),
      quote: quote || undefined,
    });
  }
  return out.slice(0, 15).sort((a, b) => a.sentenceId - b.sentenceId);
}
