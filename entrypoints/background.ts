import { SCAN_MESSAGE, type AnalyzeReply, type AnalyzeRequest, type CaptureRequest } from '@/utils/messages';
import type { AnalysisResponse } from '@/utils/analysis';

/** Analysis server (server/). Override with WXT_API_URL in .env when it's deployed elsewhere. */
const API_URL: string = import.meta.env.WXT_API_URL || 'http://localhost:8787';

export default defineBackground(() => {
  // Toolbar button (no popup) → scan the active tab.
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;
    try {
      await sendScan(tab.id);
    } catch (err) {
      console.warn('[Verity] cannot scan this page', tab.url, err);
      await flashBadge(tab.id, '!');
    }
  });

  // Screenshot of the visible viewport, used by the content script for the scan dither effect.
  // Uses sendResponse + `return true` (the classic async-reply pattern) rather than returning a
  // Promise, which isn't honored in every Chrome setup and silently replies `undefined`.
  browser.runtime.onMessage.addListener((message: CaptureRequest, sender, sendResponse) => {
    if (message?.type !== 'verity:capture' || sender.tab?.windowId == null) return false;
    browser.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then(sendResponse, (err) => {
        console.warn('[Verity] capture failed', err);
        sendResponse(null);
      });
    return true;
  });

  // Page analysis goes through the background: extension pages aren't subject to the page's CSP
  // or CORS, and the server URL/token stay out of the page.
  browser.runtime.onMessage.addListener((message: AnalyzeRequest, _sender, sendResponse) => {
    if (message?.type !== 'verity:analyze') return false;
    console.log('[Verity] analyze request:', message.request.sentences.length, 'sentences', message.request.url);
    analyzeOnServer(message)
      .catch((err): AnalyzeReply => ({ ok: false, error: `Background error: ${err instanceof Error ? err.message : String(err)}` }))
      .then((reply) => {
        console.log('[Verity] analyze reply:', reply.ok ? `${reply.data.findings.length} findings` : reply.error);
        sendResponse(reply);
      });
    return true;
  });
});

async function analyzeOnServer({ request }: AnalyzeRequest): Promise<AnalyzeReply> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(import.meta.env.WXT_API_TOKEN ? { 'X-Verity-Token': import.meta.env.WXT_API_TOKEN } : {}),
      },
      body: JSON.stringify(request),
    });
  } catch (err) {
    console.warn('[Verity] fetch failed', err);
    return { ok: false, error: `Can't reach the analysis server at ${API_URL}. Start it with \`pnpm server\`.` };
  }
  const body = (await res.json().catch(() => null)) as (AnalysisResponse & { error?: string }) | null;
  if (!res.ok || !body) return { ok: false, error: body?.error ?? `Analysis server error ${res.status}` };
  return { ok: true, data: body };
}

async function sendScan(tabId: number) {
  try {
    await browser.tabs.sendMessage(tabId, SCAN_MESSAGE);
  } catch {
    // Content script not injected yet: inject it on demand (activeTab grants access), then retry.
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
    await browser.tabs.sendMessage(tabId, SCAN_MESSAGE);
  }
}

async function flashBadge(tabId: number, text: string) {
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
  await browser.action.setBadgeText({ tabId, text });
  setTimeout(() => browser.action.setBadgeText({ tabId, text: '' }), 2000);
}
