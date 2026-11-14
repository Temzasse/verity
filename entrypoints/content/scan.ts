import type { AnalysisResponse, QuickResponse } from '@/utils/analysis';
import { analyze, quickAnalyze } from './analyze';
import { extractPageContent, toAnalysisRequest, type PageContent } from './extract';

export type Outcome<T> = { ok: true; data: T } | { ok: false; error: string };

/** A scan: extract the article, then run the on-device quick model and the smart analysis in parallel. */
export type Scan = {
  content: Outcome<PageContent>;
  /** On-device "Quick findings" (usually back within a second or two). */
  quick: Promise<Outcome<QuickResponse>>;
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
    return { content: error, quick: Promise.resolve(error), smart: Promise.resolve(error) };
  }
  const request = toAnalysisRequest(content);
  console.debug('[Verity] analysis request', request);
  const empty = <T>(data: T) => Promise.resolve({ ok: true as const, data });
  const hasText = content.sentences.length > 0;
  return {
    content: { ok: true, data: content },
    quick: hasText
      ? settle(quickAnalyze({ sentences: request.sentences.map(({ id, text }) => ({ id, text })) }))
      : empty({ findings: [], ms: 0, device: 'none' }),
    smart: settle(analyze(request)),
  };
}
