import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalysisRequest, FactCheckRequest } from '../utils/analysis.ts';

/** File-based result cache + daily spend tracking, so dev restarts don't re-spend credits. */

const DIR = join(import.meta.dirname, '.cache');
const SPEND_FILE = join(DIR, 'spend.json');

export function cacheKey(model: string, promptVersion: string, req: AnalysisRequest): string {
  const h = createHash('sha256');
  h.update(`${model}\n${promptVersion}\n${req.url}\n`);
  for (const s of req.sentences) h.update(`${s.id}\t${s.text}\n`);
  return h.digest('hex').slice(0, 32);
}

export function factCheckKey(model: string, promptVersion: string, req: FactCheckRequest): string {
  return createHash('sha256')
    .update(`fact-check\n${model}\n${promptVersion}\n${req.url}\n${req.claim}\n${req.context}`)
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

// ---------- Usage stats and reader votes (shown on the landing page) ----------

/** Answers to "Is this finding relevant?". */
export type Vote = 'yes' | 'no' | 'unsure';
export type Tally = Record<Vote, number>;

export type Stats = {
  /** Scans served (cached or not). */
  analyses: number;
  sentences: number;
  findings: number;
  findingsByCategory: Record<string, number>;
  /** Totals over all findings, one vote per reader per finding (computed from votes.json). */
  feedback: Tally & { byCategory: Record<string, Tally> };
  since: string;
};

type StoredStats = Omit<Stats, 'feedback'>;
/** Per finding: its category and each reader's current vote (a reader can change it). */
type VoteBook = Record<string, { category: string; voters: Record<string, Vote> }>;

const STATS_FILE = join(DIR, 'stats.json');
const VOTES_FILE = join(DIR, 'votes.json');
const FEEDBACK_FILE = join(DIR, 'feedback.jsonl');
let stats: StoredStats | null = null;
let votes: VoteBook | null = null;
let writes: Promise<void> = Promise.resolve();

const emptyTally = (): Tally => ({ yes: 0, no: 0, unsure: 0 });

async function loadStats(): Promise<StoredStats> {
  if (stats) return stats;
  try {
    const { feedback: _old, ...rest } = JSON.parse(await readFile(STATS_FILE, 'utf8')) as Stats;
    stats = rest;
  } catch {
    stats = { analyses: 0, sentences: 0, findings: 0, findingsByCategory: {}, since: new Date().toISOString() };
  }
  return stats;
}

async function loadVotes(): Promise<VoteBook> {
  if (votes) return votes;
  try {
    votes = JSON.parse(await readFile(VOTES_FILE, 'utf8')) as VoteBook;
  } catch {
    votes = {};
  }
  return votes;
}

// State lives in memory and is written sequentially, so concurrent requests can't lose updates.
function save(file: string, value: unknown) {
  writes = writes
    .then(async () => {
      await mkdir(DIR, { recursive: true });
      await writeFile(file, JSON.stringify(value, null, 2));
    })
    .catch((err) => console.error(`[server] saving ${file} failed`, err));
}

function tallyOf(voters: Record<string, Vote>): Tally {
  const t = emptyTally();
  for (const v of Object.values(voters)) t[v]++;
  return t;
}

export async function getStats(): Promise<Stats> {
  const [s, book] = [await loadStats(), await loadVotes()];
  const feedback: Stats['feedback'] = { ...emptyTally(), byCategory: {} };
  for (const { category, voters } of Object.values(book)) {
    const t = tallyOf(voters);
    const cat = (feedback.byCategory[category] ??= emptyTally());
    for (const k of ['yes', 'no', 'unsure'] as const) {
      feedback[k] += t[k];
      cat[k] += t[k];
    }
  }
  return { ...s, feedback };
}

export async function recordAnalysis(sentences: number, categories: string[]) {
  const s = await loadStats();
  s.analyses++;
  s.sentences += sentences;
  s.findings += categories.length;
  for (const c of categories) s.findingsByCategory[c] = (s.findingsByCategory[c] ?? 0) + 1;
  save(STATS_FILE, s);
}

/** Same finding for every reader: page, sentence and technique. */
export function findingVoteKey(url: string, sentence: string, technique: string): string {
  return createHash('sha256').update(`${url}\n${sentence.replace(/\s+/g, ' ').trim()}\n${technique}`).digest('hex').slice(0, 24);
}

/**
 * Records (or changes) one reader's vote on a finding and returns the finding's tally.
 * The raw vote is also appended to feedback.jsonl for later review.
 */
export async function recordVote(
  key: string,
  voterId: string,
  vote: Vote,
  category: string,
  raw: Record<string, unknown>,
): Promise<Tally> {
  await mkdir(DIR, { recursive: true });
  await appendFile(FEEDBACK_FILE, `${JSON.stringify({ ...raw, key, at: new Date().toISOString() })}\n`);
  const book = await loadVotes();
  const entry = (book[key] ??= { category, voters: {} });
  entry.voters[voterId] = vote;
  save(VOTES_FILE, book);
  return tallyOf(entry.voters);
}
