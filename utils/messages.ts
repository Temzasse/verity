/** Messages sent from the background service worker to the content script. */
export type VerityMessage = { type: 'verity:scan' };

export const SCAN_MESSAGE: VerityMessage = { type: 'verity:scan' };
