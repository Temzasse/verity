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
} from './analysis';

/** Background → content script. */
export type VerityMessage = { type: 'verity:scan' };

/** Content script → background. Response: PNG data URL of the visible tab. */
export type CaptureRequest = { type: 'verity:capture' };

/** Analysis server endpoints the content script can call (through the background). */
export type ServerEndpoints = {
  '/analyze': { request: AnalysisRequest; response: AnalysisResponse };
  '/fact-check': { request: FactCheckRequest; response: FactCheckResponse };
  '/feedback': { request: FeedbackRequest; response: FeedbackResponse };
  '/verify': { request: VerifyRequest; response: VerifyResponse };
};
export type ServerPath = keyof ServerEndpoints;

/** Content script → background → analysis server. */
export type ServerRequest<P extends ServerPath = ServerPath> = {
  type: 'verity:server';
  path: P;
  body: ServerEndpoints[P]['request'];
};
export type ServerReply<P extends ServerPath = ServerPath> =
  | { ok: true; data: ServerEndpoints[P]['response'] }
  | { ok: false; error: string };

/** Content script → background (on-device quick model). */
export type QuickMessage = { type: 'verity:quick'; body: QuickRequest };
/** Background → offscreen document, which runs the model. */
export type QuickRunRequest = { type: 'verity:quick-run'; body: QuickRequest };
export type QuickReply = { ok: true; data: QuickResponse } | { ok: false; error: string };

export const SCAN_MESSAGE: VerityMessage = { type: 'verity:scan' };
export const CAPTURE_MESSAGE: CaptureRequest = { type: 'verity:capture' };
