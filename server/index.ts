import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  CATEGORY_IDS,
  TECHNIQUES,
  type AnalysisRequest,
  type AnalysisResponse,
  type FactCheckRequest,
  type FactCheckResponse,
  type FeedbackRequest,
  type Finding,
  type StatsResponse,
  type VerifyResponse,
  TECHNIQUE_IDS,
} from '../utils/analysis.ts';
import { AnalysisError, MODEL, analyzeWithClaude } from './claude.ts';
import { extractArticle, type ExtractedArticle } from './extract.ts';
import { FACT_CHECK_PROMPT, factCheckWithClaude } from './factcheck.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { VERIFIER_ENABLED, VERIFIER_VERSION, verifyFindings } from './verify.ts';
import { addSpend, cacheKey, extractKey, factCheckKey, getCached, getStats, putCached, recordAnalysis, recordFeedback, spentToday } from './store.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD ?? 1);
/** Optional shared secret; when set, requests must send it as the X-Verity-Token header. */
const TOKEN = process.env.VERITY_TOKEN;
const MAX_BODY_BYTES = 1_000_000;
/** How long a scraped "Try it" article is reused before the page is fetched again. */
const EXTRACT_CACHE_MS = Number(process.env.EXTRACT_CACHE_HOURS ?? 12) * 3_600_000;
/** Requests per client IP per hour. For analyze/fact-check only paid (uncached) requests count. */
const RATE_LIMITS = {
  analyze: Number(process.env.RATE_ANALYZE_PER_HOUR ?? 30),
  'fact-check': Number(process.env.RATE_FACTCHECK_PER_HOUR ?? 15),
  extract: Number(process.env.RATE_EXTRACT_PER_HOUR ?? 30),
  feedback: Number(process.env.RATE_FEEDBACK_PER_HOUR ?? 120),
  verify: Number(process.env.RATE_VERIFY_PER_HOUR ?? 120),
};
// Changing a prompt invalidates its cached results.
const PROMPT_VERSION = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 8);
const FACT_CHECK_VERSION = createHash('sha256').update(FACT_CHECK_PROMPT).digest('hex').slice(0, 8);

const RequestSchema = z.object({
  url: z.string().max(4000),
  title: z.string().max(1000),
  byline: z.string().max(500).nullable(),
  siteName: z.string().max(500).nullable(),
  publishedTime: z.string().max(100).nullable(),
  lang: z.string().max(35),
  excerpt: z.string().max(5000).nullable(),
  isArticle: z.boolean(),
  sentences: z
    .array(z.object({ id: z.number().int().nonnegative(), text: z.string().max(5000), block: z.number().int() }))
    .max(1500),
}) satisfies z.ZodType<AnalysisRequest>;

const FactCheckSchema = z.object({
  url: z.string().max(4000),
  title: z.string().max(1000),
  publishedTime: z.string().max(100).nullable(),
  claim: z.string().min(1).max(2000),
  context: z.string().max(8000),
}) satisfies z.ZodType<FactCheckRequest>;

const FeedbackSchema = z.object({
  vote: z.enum(['agree', 'disagree']),
  url: z.string().max(4000),
  sentence: z.string().max(5000),
  quote: z.string().max(2000).optional(),
  category: z.enum(CATEGORY_IDS),
  technique: z.string().max(200),
  confidence: z.number().min(0).max(1),
  source: z.enum(['smart', 'quick']),
  client: z.enum(['extension', 'web']),
}) satisfies z.ZodType<FeedbackRequest>;

const ExtractSchema = z.object({ url: z.string().min(1).max(4000) });

const VerifySchema = z.object({
  request: RequestSchema,
  findings: z
    .array(
      z.object({
        sentenceId: z.number().int().nonnegative(),
        category: z.enum(CATEGORY_IDS),
        technique: z.string().max(200),
        techniqueId: z.enum(TECHNIQUE_IDS).optional(),
        confidence: z.number().min(0).max(1),
        rationale: z.string().max(2000),
        quote: z.string().max(2000).optional(),
        source: z.enum(['smart', 'quick']).optional(),
      }),
    )
    .max(30),
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[server] ANTHROPIC_API_KEY is not set. Copy server/.env.example to server/.env and add your key.');
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true, model: MODEL, spentTodayUsd: await spentToday(), dailyBudgetUsd: DAILY_BUDGET_USD });
    }
    if (req.method === 'POST' && req.url === '/analyze') return await handleAnalyze(req, res);
    if (req.method === 'POST' && req.url === '/fact-check') return await handleFactCheck(req, res);
    if (req.method === 'POST' && req.url === '/extract') return await handleExtract(req, res);
    if (req.method === 'POST' && req.url === '/feedback') return await handleFeedback(req, res);
    if (req.method === 'POST' && req.url === '/verify') return await handleVerify(req, res);
    if (req.method === 'GET' && req.url === '/techniques') return json(res, 200, TECHNIQUES);
    if (req.method === 'GET' && req.url === '/stats') return json(res, 200, (await getStats()) satisfies StatsResponse);
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof AnalysisError) return json(res, err.status, { error: err.message });
    console.error('[server]', err);
    json(res, 500, { error: 'Internal server error' });
  }
}).listen(PORT, HOST, () => {
  console.log(
    `[server] Verity analysis server on http://${HOST}:${PORT} (model ${MODEL}, budget $${DAILY_BUDGET_USD}/day, ` +
      `confidence: ${VERIFIER_ENABLED ? VERIFIER_VERSION : 'analysis model'})`,
  );
});

async function handleAnalyze(req: IncomingMessage, res: ServerResponse) {
  if (!checkPost(req, res)) return;
  const parsed = RequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request', details: z.treeifyError(parsed.error) });
  const body = parsed.data;
  if (body.sentences.length === 0) return json(res, 200, { findings: [], model: MODEL, cached: false, costUsd: 0 } satisfies AnalysisResponse);

  // Two cache layers: the analysis model's raw findings, and the same findings after the independent
  // confidence check. Turning the verifier on (or changing it) re-checks cached pages without re-analyzing.
  const key = cacheKey(MODEL, PROMPT_VERSION, body);
  const verifiedKey = `${key}-${createHash('sha256').update(VERIFIER_VERSION).digest('hex').slice(0, 8)}`;
  const cached = await getCached<Finding[]>(verifiedKey);
  if (cached) {
    console.log(`[server] cache hit ${verifiedKey} (${body.url})`);
    await recordAnalysis(body.sentences.length, cached.map((f) => f.category));
    return json(res, 200, { findings: cached, model: MODEL, cached: true, costUsd: 0 } satisfies AnalysisResponse);
  }
  const raw = await getCached<Finding[]>(key);
  if (raw) {
    console.log(`[server] cache hit ${key}, ${VERIFIER_ENABLED ? 'verifying' : 'no verifier'} (${body.url})`);
    const findings = await verifyFindings(raw, body);
    if (findings.every((f) => f.verified) || !VERIFIER_ENABLED) await putCached(verifiedKey, findings);
    await recordAnalysis(body.sentences.length, findings.map((f) => f.category));
    return json(res, 200, { findings, model: MODEL, cached: true, costUsd: 0 } satisfies AnalysisResponse);
  }
  if (rateLimited(req, res, 'analyze') || (await overBudget(res))) return;

  console.log(`[server] analyzing ${body.sentences.length} sentences: ${body.url}`);
  const started = Date.now();
  const { findings: rawFindings, costUsd } = await analyzeWithClaude(body);
  await addSpend(costUsd);
  await putCached(key, rawFindings);
  const findings = await verifyFindings(rawFindings, body);
  // Only cache the checked version when every finding was checked; otherwise retry the check next time.
  if (findings.every((f) => f.verified) || !VERIFIER_ENABLED) await putCached(verifiedKey, findings);
  await recordAnalysis(body.sentences.length, findings.map((f) => f.category));
  console.log(`[server] ${findings.length} findings in ${Date.now() - started} ms, today $${(await spentToday()).toFixed(4)}`);
  json(res, 200, { findings, model: MODEL, cached: false, costUsd } satisfies AnalysisResponse);
}

async function handleFactCheck(req: IncomingMessage, res: ServerResponse) {
  if (!checkPost(req, res)) return;
  const parsed = FactCheckSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request', details: z.treeifyError(parsed.error) });
  const body = parsed.data;

  const key = factCheckKey(MODEL, FACT_CHECK_VERSION, body);
  const cached = await getCached<Omit<FactCheckResponse, 'cached' | 'costUsd'>>(key);
  if (cached) {
    console.log(`[server] fact-check cache hit ${key}`);
    return json(res, 200, { ...cached, cached: true, costUsd: 0 } satisfies FactCheckResponse);
  }
  if (rateLimited(req, res, 'fact-check') || (await overBudget(res))) return;

  console.log(`[server] fact-checking: "${body.claim.slice(0, 100)}"`);
  const started = Date.now();
  const { costUsd, ...result } = await factCheckWithClaude(body);
  await addSpend(costUsd);
  const stored = { ...result, model: MODEL };
  await putCached(key, stored);
  console.log(
    `[server] verdict ${result.verdict} (${result.sources.length} sources, ${result.searches} searches) in ${Date.now() - started} ms, today $${(await spentToday()).toFixed(4)}`,
  );
  json(res, 200, { ...stored, cached: false, costUsd } satisfies FactCheckResponse);
}

/** Fetches an article by URL for the landing page demo (the browser splits it into sentences). */
async function handleExtract(req: IncomingMessage, res: ServerResponse) {
  if (!checkPost(req, res)) return;
  const parsed = ExtractSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request' });

  // Reusing the scrape keeps repeat tries instant and the text identical, so /analyze hits its cache too.
  const key = extractKey(parsed.data.url);
  const cached = await getCached<{ at: number; article: ExtractedArticle }>(key);
  if (cached && Date.now() - cached.at < EXTRACT_CACHE_MS) {
    console.log(`[server] extract cache hit: ${cached.article.url}`);
    return json(res, 200, cached.article);
  }

  if (rateLimited(req, res, 'extract')) return;
  const article = await extractArticle(parsed.data.url);
  await putCached(key, { at: Date.now(), article });
  console.log(`[server] extracted ${article.paragraphs.length} paragraphs: ${article.url}`);
  json(res, 200, article);
}

/** Re-scores the extension's on-device Quick findings with the independent confidence check (cheap, ~0.3 s). */
async function handleVerify(req: IncomingMessage, res: ServerResponse) {
  if (!checkPost(req, res)) return;
  const parsed = VerifySchema.safeParse(await readJson(req));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request' });
  const { request, findings } = parsed.data;
  if (!VERIFIER_ENABLED || findings.length === 0) return json(res, 200, { findings, checked: false } satisfies VerifyResponse);

  const key = createHash('sha256')
    .update(JSON.stringify({ v: VERIFIER_VERSION, url: request.url, sentences: request.sentences, findings }))
    .digest('hex')
    .slice(0, 32);
  const cached = await getCached<Finding[]>(`verify-${key}`);
  if (cached) return json(res, 200, { findings: cached, checked: true } satisfies VerifyResponse);
  if (rateLimited(req, res, 'verify')) return;

  const checked = await verifyFindings(findings, request, 'quick');
  const ok = checked.every((f) => f.verified);
  if (ok) await putCached(`verify-${key}`, checked);
  json(res, 200, { findings: checked, checked: ok } satisfies VerifyResponse);
}

/** A reader's verdict on one finding: the raw vote is logged, the counters feed GET /stats. */
async function handleFeedback(req: IncomingMessage, res: ServerResponse) {
  if (!checkPost(req, res)) return;
  const parsed = FeedbackSchema.safeParse(await readJson(req));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request' });
  if (rateLimited(req, res, 'feedback')) return;
  await recordFeedback(parsed.data);
  console.log(`[server] feedback ${parsed.data.vote} on ${parsed.data.category} (${parsed.data.source}, ${parsed.data.client})`);
  json(res, 200, { ok: true });
}

/** Shared checks for POST endpoints; returns false if a response was already sent. */
function checkPost(req: IncomingMessage, res: ServerResponse): boolean {
  console.log(`[server] POST ${req.url} (${req.headers['content-length'] ?? '?'} bytes)`);
  if (TOKEN && req.headers['x-verity-token'] !== TOKEN) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  // Requiring JSON blocks "simple" cross-site form posts from random web pages to localhost.
  if (!req.headers['content-type']?.startsWith('application/json')) {
    json(res, 415, { error: 'Expected application/json' });
    return false;
  }
  return true;
}

// Fixed one-hour windows per client IP and endpoint, in memory (reset on restart; fine for one VPS).
const windows = new Map<string, { start: number; count: number }>();
function rateLimited(req: IncomingMessage, res: ServerResponse, kind: keyof typeof RATE_LIMITS): boolean {
  // Behind Caddy the client address is the first X-Forwarded-For entry.
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > 3_600_000) {
    windows.set(key, { start: now, count: 1 });
    return false;
  }
  if (w.count >= RATE_LIMITS[kind]) {
    const minutes = Math.ceil((w.start + 3_600_000 - now) / 60_000);
    json(res, 429, { error: `Too many requests from this address. Try again in ${minutes} min.` });
    return true;
  }
  w.count++;
  return false;
}

async function overBudget(res: ServerResponse): Promise<boolean> {
  const spent = await spentToday();
  if (spent < DAILY_BUDGET_USD) return false;
  json(res, 429, {
    error: `Daily budget of $${DAILY_BUDGET_USD} reached ($${spent.toFixed(3)} spent). Raise DAILY_BUDGET_USD in server/.env.`,
  });
  return true;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  try {
    return JSON.parse(text);
  } catch {
    throw new AnalysisError('Invalid JSON', 400);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AnalysisError('Request too large', 413));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
