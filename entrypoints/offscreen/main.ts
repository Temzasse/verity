import type { QuickReply, QuickRunRequest } from '@/utils/messages';
import { preload, quickAnalyze } from './quick';

// Offscreen document (created by the background) that runs the on-device quick model.
preload();

browser.runtime.onMessage.addListener((message: QuickRunRequest, _sender, sendResponse) => {
  if (message?.type !== 'verity:quick-run') return false;
  quickAnalyze(message.body)
    .then((data): QuickReply => ({ ok: true, data }))
    .catch((err): QuickReply => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
    .then(sendResponse);
  return true;
});
