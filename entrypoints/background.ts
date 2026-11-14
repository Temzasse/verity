import {
  SCAN_MESSAGE,
  type CaptureRequest,
  type QuickMessage,
  type QuickReply,
  type QuickRunRequest,
  type ServerReply,
  type ServerRequest,
} from '@/utils/messages';

/** Analysis server (server/). Override with WXT_API_URL in .env when it's deployed elsewhere. */
const API_URL: string = import.meta.env.WXT_API_URL || 'http://localhost:8787';

export default defineBackground(() => {
  // Toolbar button (no popup) → scan the active tab.
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;
    // Start loading the on-device model right away so Quick findings are ready sooner.
    void ensureOffscreen().catch((err) => console.warn('[Verity] offscreen failed', err));
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

  // On-device quick model: forwarded to the offscreen document that runs it.
  browser.runtime.onMessage.addListener((message: QuickMessage, _sender, sendResponse) => {
    if (message?.type !== 'verity:quick') return false;
    runQuick(message.body)
      .catch((err): QuickReply => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
      .then((reply) => {
        console.log('[Verity] quick reply:', reply.ok ? `${reply.data.findings.length} findings in ${reply.data.ms} ms (${reply.data.device})` : reply.error);
        sendResponse(reply);
      });
    return true;
  });

  // Server calls (analysis, fact-checks) go through the background: extension pages aren't subject
  // to the page's CSP or CORS, and the server URL/token stay out of the page.
  browser.runtime.onMessage.addListener((message: ServerRequest, _sender, sendResponse) => {
    if (message?.type !== 'verity:server') return false;
    console.log('[Verity] server request:', message.path);
    callServer(message)
      .catch((err): ServerReply => ({ ok: false, error: `Background error: ${err instanceof Error ? err.message : String(err)}` }))
      .then((reply) => {
        console.log('[Verity] server reply:', message.path, reply.ok ? 'ok' : reply.error);
        sendResponse(reply);
      });
    return true;
  });
});

const OFFSCREEN_URL = '/offscreen.html';
let creatingOffscreen: Promise<void> | undefined;

/** Creates the offscreen document that hosts the on-device model (once). */
async function ensureOffscreen() {
  const url = browser.runtime.getURL(OFFSCREEN_URL);
  const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (contexts.length) return;
  creatingOffscreen ??= browser.offscreen
    .createDocument({ url: OFFSCREEN_URL, reasons: ['WORKERS'], justification: 'Run the on-device text classification model' })
    .finally(() => (creatingOffscreen = undefined));
  await creatingOffscreen;
}

async function runQuick(body: QuickMessage['body']): Promise<QuickReply> {
  await ensureOffscreen();
  const reply = (await browser.runtime.sendMessage({ type: 'verity:quick-run', body } satisfies QuickRunRequest)) as
    | QuickReply
    | undefined;
  return reply ?? { ok: false, error: 'On-device model did not respond' };
}

async function callServer({ path, body }: ServerRequest): Promise<ServerReply> {
  // Research can outlive MV3's idle timeout. Keep only this operation alive,
  // including response-body reading, following Chrome's scoped waitUntil pattern.
  const keepAlive = path === '/fact-check'
    ? setInterval(() => { void browser.runtime.getPlatformInfo().catch(() => {}); }, 25_000)
    : undefined;
  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(import.meta.env.WXT_API_TOKEN ? { 'X-Verity-Token': import.meta.env.WXT_API_TOKEN } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn('[Verity] fetch failed', err);
      return { ok: false, error: `Can't reach the analysis server at ${API_URL}. Start it with \`pnpm server\`.` };
    }
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok || !data || data.error) return { ok: false, error: data?.error ?? `Analysis server error ${res.status}` };
    return { ok: true, data } as ServerReply;
  } finally {
    if (keepAlive !== undefined) clearInterval(keepAlive);
  }
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
