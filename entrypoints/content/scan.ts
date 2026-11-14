import type { AnalysisResponse } from '@/utils/analysis';
import { analyze } from './analyze';
import { extractPageContent, toAnalysisRequest, type PageContent } from './extract';

export type ScanResult =
  | { ok: true; content: PageContent; analysis: AnalysisResponse }
  | { ok: false; content: PageContent | null; error: string };

export async function scanPage(): Promise<ScanResult> {
  let content: PageContent | null = null;
  try {
    content = extractPageContent();
    const request = toAnalysisRequest(content);
    console.debug('[Verity] analysis request', request);
    const analysis = await analyze(request);
    console.debug('[Verity] analysis response', analysis);
    return { ok: true, content, analysis };
  } catch (err) {
    console.warn('[Verity] scan failed', err);
    return { ok: false, content, error: err instanceof Error ? err.message : String(err) };
  }
}
