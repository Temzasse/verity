import './style.css';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { CAPTURE_MESSAGE, type VerityMessage } from '@/utils/messages';
import { scanPage, type ScanResult } from './scan';
import { playScanEffect } from './dither';

const SCAN_EFFECT_MS = 1600;

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
    let busy = false;

    browser.runtime.onMessage.addListener((message: VerityMessage) => {
      if (message?.type !== 'verity:scan' || busy) return;
      busy = true;
      void (async () => {
        try {
          panel ??= await createPanel(ctx, () => (panel = undefined));
          await panel.scan(scanPage);
        } finally {
          busy = false;
        }
      })();
    });
  },
});

type Panel = {
  scan(run: () => Promise<ScanResult>): Promise<void>;
};

async function createPanel(ctx: ContentScriptContext, onClose: () => void): Promise<Panel> {
  let layer!: HTMLElement;
  let body!: HTMLElement;
  let sweep!: HTMLElement;
  let tint!: HTMLElement;
  let canvas!: HTMLCanvasElement;

  const ui = await createShadowRootUi(ctx, {
    name: 'verity-overlay',
    position: 'inline',
    anchor: 'html',
    onMount(container) {
      container.innerHTML = `
        <div class="layer" popover="manual">
          <div class="tint" hidden></div>
          <canvas class="dither"></canvas>
          <div class="sweep" hidden></div>
          <aside class="panel" role="dialog" aria-label="Verity">
            <header>
              <span class="logo" aria-hidden="true"></span>
              <h1>Verity</h1>
              <button class="close" type="button" aria-label="Close">×</button>
            </header>
            <section class="body"></section>
          </aside>
        </div>`;
      layer = container.querySelector('.layer')!;
      body = container.querySelector('.body')!;
      sweep = container.querySelector('.sweep')!;
      tint = container.querySelector('.tint')!;
      canvas = container.querySelector('.dither')!;
      container.querySelector('.close')!.addEventListener('click', () => {
        ui.remove();
      });
    },
    onRemove() {
      onClose();
    },
  });

  ui.mount();

  const hide = () => {
    if (layer.matches(':popover-open')) layer.hidePopover();
  };
  // Brings the overlay to the front of the browser's top layer, above any page z-index
  // (and above page dialogs/popovers opened earlier).
  const raise = () => {
    hide();
    layer.showPopover();
  };

  return {
    async scan(run) {
      // Screenshot the page without our overlay in it, for the dither effect.
      hide();
      await nextFrames(2);
      const screenshot = await browser.runtime
        .sendMessage(CAPTURE_MESSAGE)
        .then((url: unknown) => (typeof url === 'string' ? url : null))
        .catch((err) => {
          console.warn('[Verity] screenshot failed', err);
          return null;
        });

      raise();
      tint.hidden = true;
      body.innerHTML = `<p class="muted">Scanning page…</p>`;

      const color = getComputedStyle(sweep).getPropertyValue('background-color');
      const [result] = await Promise.all([
        run(),
        playScanEffect({ canvas, line: sweep, screenshot, color, durationMs: SCAN_EFFECT_MS }),
      ]);

      // Placeholder visual: tint the page so it is obvious a scan happened.
      tint.hidden = false;
      renderResult(body, result);
    },
  };
}

function renderResult(body: HTMLElement, result: ScanResult) {
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
}

function nextFrames(n: number) {
  return new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}
