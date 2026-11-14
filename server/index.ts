import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import type { AnalysisRequest, AnalysisResponse } from '../utils/analysis.ts';
import { AnalysisError, MODEL, analyzeWithClaude } from './claude.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { addSpend, cacheKey, getCached, putCached, spentToday } from './store.ts';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DAILY_BUDGET_USD = Number(process.env.DAILY_BUDGET_USD ?? 1);
/** Optional shared secret; when set, requests must send it as the X-Verity-Token header. */
const TOKEN = process.env.VERITY_TOKEN;
const MAX_BODY_BYTES = 1_000_000;
// Changing the prompt invalidates cached results.
const PROMPT_VERSION = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 8);

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

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[server] ANTHROPIC_API_KEY is not set. Copy server/.env.example to server/.env and add your key.');
}

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true, model: MODEL, spentTodayUsd: await spentToday(), dailyBudgetUsd: DAILY_BUDGET_USD });
    }
    if (req.method === 'POST' && req.url === '/analyze') return await handleAnalyze(req, res);
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    if (err instanceof AnalysisError) return json(res, err.status, { error: err.message });
    console.error('[server]', err);
    json(res, 500, { error: 'Internal server error' });
  }
}).listen(PORT, HOST, () => {
  console.log(`[server] Verity analysis server on http://${HOST}:${PORT} (model ${MODEL}, budget $${DAILY_BUDGET_USD}/day)`);
});

async function handleAnalyze(req: IncomingMessage, res: ServerResponse) {
  console.log(`[server] POST /analyze (${req.headers['content-length'] ?? '?'} bytes)`);
  if (TOKEN && req.headers['x-verity-token'] !== TOKEN) return json(res, 401, { error: 'Unauthorized' });
  // Requiring JSON blocks "simple" cross-site form posts from random web pages to localhost.
  if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected application/json' });

  const parsed = RequestSchema.safeParse(JSON.parse(await readBody(req)));
  if (!parsed.success) return json(res, 400, { error: 'Invalid request', details: z.treeifyError(parsed.error) });
  const body = parsed.data;
  if (body.sentences.length === 0) return json(res, 200, { findings: [], model: MODEL, cached: false, costUsd: 0 } satisfies AnalysisResponse);

  const key = cacheKey(MODEL, PROMPT_VERSION, body);
  const cached = await getCached(key);
  if (cached) {
    console.log(`[server] cache hit ${key} (${body.url})`);
    return json(res, 200, { findings: cached, model: MODEL, cached: true, costUsd: 0 } satisfies AnalysisResponse);
  }

  const spent = await spentToday();
  if (spent >= DAILY_BUDGET_USD) {
    return json(res, 429, { error: `Daily budget of $${DAILY_BUDGET_USD} reached ($${spent.toFixed(3)} spent). Raise DAILY_BUDGET_USD in server/.env.` });
  }

  console.log(`[server] analyzing ${body.sentences.length} sentences: ${body.url}`);
  const started = Date.now();
  const { findings, costUsd } = await analyzeWithClaude(body);
  await addSpend(costUsd);
  await putCached(key, findings);
  console.log(`[server] ${findings.length} findings in ${Date.now() - started} ms, today $${(spent + costUsd).toFixed(4)}`);
  json(res, 200, { findings, model: MODEL, cached: false, costUsd } satisfies AnalysisResponse);
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
