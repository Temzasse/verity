import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalysisRequest, Finding } from '../utils/analysis.ts';

/** File-based result cache + daily spend tracking, so dev restarts don't re-spend credits. */

const DIR = join(import.meta.dirname, '.cache');
const SPEND_FILE = join(DIR, 'spend.json');

export function cacheKey(model: string, promptVersion: string, req: AnalysisRequest): string {
  const h = createHash('sha256');
  h.update(`${model}\n${promptVersion}\n${req.url}\n`);
  for (const s of req.sentences) h.update(`${s.id}\t${s.text}\n`);
  return h.digest('hex').slice(0, 32);
}

export async function getCached(key: string): Promise<Finding[] | null> {
  try {
    return JSON.parse(await readFile(join(DIR, `${key}.json`), 'utf8')) as Finding[];
  } catch {
    return null;
  }
}

export async function putCached(key: string, findings: Finding[]) {
  await mkdir(DIR, { recursive: true });
  await writeFile(join(DIR, `${key}.json`), JSON.stringify(findings, null, 2));
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
