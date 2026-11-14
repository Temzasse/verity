import { SCAN_MESSAGE } from '@/utils/messages';

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
});

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
