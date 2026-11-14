import type {
  AnalysisRequest,
  AnalysisResponse,
  FactCheckRequest,
  FactCheckResponse,
  FeedbackRequest,
  FeedbackResponse,
  QuickRequest,
  QuickResponse,
  VerifyRequest,
  VerifyResponse,
} from '@/utils/analysis';
import type { QuickMessage, QuickReply, ServerEndpoints, ServerPath, ServerReply, ServerRequest } from '@/utils/messages';

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

/** Runs the on-device quick model (offscreen document, via the background). */
export async function quickAnalyze(request: QuickRequest): Promise<QuickResponse> {
  const reply = (await browser.runtime.sendMessage({ type: 'verity:quick', body: request } satisfies QuickMessage)) as
    | QuickReply
    | undefined;
  if (!reply) throw new Error('No response from the extension background.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

/** Verifies one claim with web search. */
export function factCheck(request: FactCheckRequest): Promise<FactCheckResponse> {
  return callServer('/fact-check', request);
}

/** Records (or changes) the reader's answer to "Is this finding relevant?"; returns everyone's answers. */
export async function sendFeedback(request: Omit<FeedbackRequest, 'voterId'>): Promise<FeedbackResponse> {
  return callServer('/feedback', { ...request, voterId: await voterId() });
}

/** Random id for this browser, so each reader has one (changeable) vote per finding. Not linked to anything else. */
async function voterId(): Promise<string> {
  const stored = (await browser.storage.local.get('voterId')).voterId;
  if (typeof stored === 'string' && stored) return stored;
  const id = crypto.randomUUID();
  await browser.storage.local.set({ voterId: id });
  return id;
}

/** Re-scores on-device Quick findings with the server's independent confidence check. */
export function verifyQuick(request: VerifyRequest): Promise<VerifyResponse> {
  return callServer('/verify', request);
}
