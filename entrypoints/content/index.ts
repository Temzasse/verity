import './style.css';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { VerityMessage } from '@/utils/messages';
import { scanPage, type ScanResult } from './scan';

declare global {
  interface Window {
    __verityLoaded?: boolean;
  }
}

export default defineContentScript({
  // Not injected on every page: the background injects it when the toolbar button is clicked.
  registration: 'runtime',
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    // executeScript can run this file more than once per page; keep a single instance.
    if (window.__verityLoaded) return;
    window.__verityLoaded = true;

    let panel: Panel | undefined;

    browser.runtime.onMessage.addListener((message: VerityMessage) => {
      if (message?.type !== 'verity:scan') return;
      void (async () => {
        panel ??= await createPanel(ctx, () => (panel = undefined));
        panel.setScanning();
        panel.setResult(await scanPage());
      })();
    });
  },
});

type Panel = {
  setScanning(): void;
  setResult(result: ScanResult): void;
};

async function createPanel(ctx: ContentScriptContext, onClose: () => void): Promise<Panel> {
  let body!: HTMLElement;
  let sweep!: HTMLElement;
  let tint!: HTMLElement;

  const ui = await createShadowRootUi(ctx, {
    name: 'verity-overlay',
    position: 'overlay',
    zIndex: 2147483647,
    anchor: 'body',
    onMount(container) {
      container.innerHTML = `
        <div class="tint" hidden></div>
        <div class="sweep" hidden></div>
        <aside class="panel" role="dialog" aria-label="Verity">
          <header>
            <span class="logo" aria-hidden="true"></span>
            <h1>Verity</h1>
            <button class="close" type="button" aria-label="Close">×</button>
          </header>
          <section class="body"></section>
        </aside>`;
      body = container.querySelector('.body')!;
      sweep = container.querySelector('.sweep')!;
      tint = container.querySelector('.tint')!;
      container.querySelector('.close')!.addEventListener('click', () => {
        ui.remove();
      });
    },
    onRemove() {
      onClose();
    },
  });

  ui.mount();

  return {
    setScanning() {
      body.innerHTML = `<p class="muted">Scanning page…</p>`;
      tint.hidden = true;
      sweep.hidden = false;
      sweep.style.animation = 'none';
      void sweep.offsetWidth; // restart the animation
      sweep.style.animation = '';
    },
    setResult(result) {
      sweep.hidden = true;
      // Placeholder visual: tint the page so it is obvious a scan happened.
      tint.hidden = false;
      body.innerHTML = `
        <p class="label">Page</p>
        <p class="title"></p>
        <dl>
          <div><dt>Words</dt><dd>${result.wordCount.toLocaleString()}</dd></div>
          <div><dt>Links</dt><dd>${result.linkCount}</dd></div>
          <div><dt>Images</dt><dd>${result.imageCount}</dd></div>
        </dl>
        <p class="muted">Placeholder results. Real analysis coming soon.</p>`;
      body.querySelector('.title')!.textContent = result.title || location.hostname;
    },
  };
}

