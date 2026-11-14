import type { AnalysisRequest, AnalysisResponse, FactCheckRequest, FactCheckResponse } from '@/utils/analysis';
import type { ServerEndpoints, ServerPath, ServerReply, ServerRequest } from '@/utils/messages';

export { CATEGORIES, VERDICTS, type Category, type Finding } from '@/utils/analysis';

/** Calls the analysis server through the background service worker. */
async function callServer<P extends ServerPath>(path: P, body: ServerEndpoints[P]['request']): Promise<ServerEndpoints[P]['response']> {
  const reply = (await browser.runtime.sendMessage({ type: 'verity:server', path, body } satisfies ServerRequest<P>)) as
    | ServerReply<P>
    | undefined;
  if (!reply) {
    throw new Error(
      'No response from the extension background. Reload this page and try again; if it persists, check the service worker console (chrome://extensions → Verity → service worker).',
    );
  }
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Sends the article to the analysis server. */
export function analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
  return callServer('/analyze', request);
}

/** Verifies one claim with web search. */
export function factCheck(request: FactCheckRequest): Promise<FactCheckResponse> {
  return callServer('/fact-check', request);
}
