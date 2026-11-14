import type { AnalysisRequest, AnalysisResponse } from '@/utils/analysis';
import type { AnalyzeReply, AnalyzeRequest } from '@/utils/messages';

export { CATEGORIES, type Category, type Finding } from '@/utils/analysis';

/** Sends the article to the analysis server (via the background service worker). */
export async function analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
  const reply = (await browser.runtime.sendMessage({ type: 'verity:analyze', request } satisfies AnalyzeRequest)) as
    | AnalyzeReply
    | undefined;
  if (!reply) {
    throw new Error(
      'No response from the extension background. Reload this page and try again; if it persists, check the service worker console (chrome://extensions → Verity → service worker).',
    );
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
