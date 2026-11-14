import type { AnalysisRequest, AnalysisResponse } from './analysis';

/** Background → content script. */
export type VerityMessage = { type: 'verity:scan' };

/** Content script → background. Response: PNG data URL of the visible tab. */
export type CaptureRequest = { type: 'verity:capture' };

/** Content script → background → analysis server. */
export type AnalyzeRequest = { type: 'verity:analyze'; request: AnalysisRequest };
export type AnalyzeReply = { ok: true; data: AnalysisResponse } | { ok: false; error: string };

export const SCAN_MESSAGE: VerityMessage = { type: 'verity:scan' };
export const CAPTURE_MESSAGE: CaptureRequest = { type: 'verity:capture' };
