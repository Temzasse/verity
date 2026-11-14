import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalysisRequest, FactCheckRequest } from '../utils/analysis.ts';

/** File-based result cache + daily spend tracking, so dev restarts don't re-spend credits. */

const DIR = process.env.VERITY_CACHE_DIR || join(import.meta.dirname, '.cache');
const SPEND_FILE = join(DIR, 'spend.json');

export function cacheKey(model: string, promptVersion: string, req: AnalysisRequest): string {
  const h = createHash('sha256');
  h.update(`${model}\n${promptVersion}\n${req.url}\n`);
  for (const s of req.sentences) h.update(`${s.id}\t${s.text}\n`);
  return h.digest('hex').slice(0, 32);
}

export function factCheckKey(model: string, promptVersion: string, req: FactCheckRequest): string {
  return createHash('sha256')
    .update(`fact-check\n${model}\n${promptVersion}\n${JSON.stringify(req)}`)
    .digest('hex')
    .slice(0, 32);
}

/** Scraped article by URL (fragment and surrounding whitespace ignored). */
export function extractKey(url: string): string {
  return createHash('sha256').update(`extract\n${url.trim().split('#')[0]}`).digest('hex').slice(0, 32);
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(DIR, `${key}.json`), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function putCached(key: string, value: unknown) {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${key}.json`), JSON.stringify(value, null, 2));
}

const today = () => new Date().toISOString().slice(0, 10);

async function readSpend(): Promise<Record<string, number>> {
  try {
    return JSON.parse(await readFile(SPEND_FILE, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

export async function spentToday(): Promise<number> {
  return (await readSpend())[today()] ?? 0;
}

export async function addSpend(usd: number) {
  const spend = await readSpend();
  spend[today()] = (spend[today()] ?? 0) + usd;
  await mkdir(DIR, { recursive: true });
  await writeFile(SPEND_FILE, JSON.stringify(spend, null, 2));
}

// ---------- Usage stats and reader feedback (shown on the landing page) ----------

export type Vote = 'agree' | 'disagree';

export type Stats = {
  /** Scans served (cached or not). */
  analyses: number;
  sentences: number;
  findings: number;
  findingsByCategory: Record<string, number>;
  feedback: { agree: number; disagree: number; byCategory: Record<string, { agree: number; disagree: number }> };
  since: string;
};

const STATS_FILE = join(DIR, 'stats.json');
const FEEDBACK_FILE = join(DIR, 'feedback.jsonl');
let stats: Stats | null = null;
let statsWrite: Promise<void> = Promise.resolve();

async function loadStats(): Promise<Stats> {
  if (stats) return stats;
  try {
    stats = JSON.parse(await readFile(STATS_FILE, 'utf8')) as Stats;
  } catch {
    stats = {
      analyses: 0,
      sentences: 0,
      findings: 0,
      findingsByCategory: {},
      feedback: { agree: 0, disagree: 0, byCategory: {} },
      since: new Date().toISOString(),
    };
  }
  return stats;
}

// Stats live in memory and are written sequentially, so concurrent requests can't lose updates.
function saveStats() {
  statsWrite = statsWrite
    .then(async () => {
      await mkdir(DIR, { recursive: true });
      await writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
    })
    .catch((err) => console.error('[server] saving stats failed', err));
}

export async function getStats(): Promise<Stats> {
  return loadStats();
}

export async function recordAnalysis(sentences: number, categories: string[]) {
  const s = await loadStats();
  s.analyses++;
  s.sentences += sentences;
  s.findings += categories.length;
  for (const c of categories) s.findingsByCategory[c] = (s.findingsByCategory[c] ?? 0) + 1;
  saveStats();
}

/** Appends one vote to feedback.jsonl (the raw record, for later review) and updates the counters. */
export async function recordFeedback(entry: { vote: Vote; category: string } & Record<string, unknown>) {
  await mkdir(DIR, { recursive: true });
  await appendFile(FEEDBACK_FILE, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`);
  const s = await loadStats();
  s.feedback[entry.vote]++;
  const cat = (s.feedback.byCategory[entry.category] ??= { agree: 0, disagree: 0 });
  cat[entry.vote]++;
  saveStats();
}
