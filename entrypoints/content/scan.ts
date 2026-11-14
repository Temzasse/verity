import type { AnalysisResponse, QuickResponse } from '@/utils/analysis';
import { analyze, quickAnalyze, verifyQuick } from './analyze';
import { extractPageContent, toAnalysisRequest, type PageContent } from './extract';

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

/** A scan: extract the article, then run the on-device quick model and the smart analysis in parallel. */
export type Scan = {
  content: Outcome<PageContent>;
  /** On-device "Quick findings" (usually back within a second or two). */
  quick: Promise<Outcome<QuickResponse>>;
  /** The same Quick findings re-scored by the server's confidence check; null when it was skipped or failed. */
  quickChecked: Promise<QuickResponse | null>;
  /** Smart analysis on the server (several seconds). */
  smart: Promise<Outcome<AnalysisResponse>>;
};

const settle = <T>(p: Promise<T>): Promise<Outcome<T>> =>
  p.then(
    (data) => ({ ok: true as const, data }),
    (err: unknown) => {
      console.warn('[Verity]', err);
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    },
  );

export function startScan(): Scan {
  let content: PageContent;
  try {
    content = extractPageContent();
  } catch (err) {
    const error = { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    return { content: error, quick: Promise.resolve(error), quickChecked: Promise.resolve(null), smart: Promise.resolve(error) };
  }
  const request = toAnalysisRequest(content);
  console.debug('[Verity] analysis request', request);
  const empty = <T>(data: T) => Promise.resolve({ ok: true as const, data });
  const hasText = content.sentences.length > 0;
  const quick = hasText
    ? settle(quickAnalyze({ sentences: request.sentences.map(({ id, text }) => ({ id, text })) }))
    : empty({ findings: [], ms: 0, device: 'none' });
  // Quick findings are shown right away; their independent confidence check follows a moment later.
  const quickChecked = quick.then(async (q) => {
    if (!q.ok || q.data.findings.length === 0) return null;
    try {
      const res = await verifyQuick({ request, findings: q.data.findings });
      return res.checked ? { ...q.data, findings: res.findings } : null;
    } catch (err) {
      console.warn('[Verity] quick findings check failed', err);
      return null;
    }
  });
  return { content: { ok: true, data: content }, quick, quickChecked, smart: settle(analyze(request)) };
}
