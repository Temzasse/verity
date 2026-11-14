/** Background → content script. */
export type VerityMessage = { type: 'verity:scan' };

/** Content script → background. Response: PNG data URL of the visible tab. */
export type CaptureRequest = { type: 'verity:capture' };

export const SCAN_MESSAGE: VerityMessage = { type: 'verity:scan' };
export const CAPTURE_MESSAGE: CaptureRequest = { type: 'verity:capture' };
