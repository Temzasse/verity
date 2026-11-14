import './style.css';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { CAPTURE_MESSAGE, type VerityMessage } from '@/utils/messages';
import { scanPage, type ScanResult } from './scan';
import { playScanEffect } from './dither';
import { CATEGORIES } from './analyze';
import { applyHighlights, clearHighlights, setActiveHighlight, type PlacedFinding } from './highlight';

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
  let canvas!: HTMLCanvasElement;
  let tooltip!: HTMLElement;
  let active: PlacedFinding | null = null;

  const ui = await createShadowRootUi(ctx, {
    name: 'verity-overlay',
    position: 'inline',
    anchor: 'html',
    onMount(container) {
      container.innerHTML = `
        <div class="layer" popover="manual">
          <canvas class="dither"></canvas>
          <div class="tooltip" role="tooltip" hidden></div>
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
      tooltip = container.querySelector('.tooltip')!;
      canvas = container.querySelector('.dither')!;
      container.querySelector('.close')!.addEventListener('click', () => {
        ui.remove();
      });
    },
    onRemove() {
      showFinding(null);
      clearHighlights();
      window.removeEventListener('scroll', positionTooltip, true);
      window.removeEventListener('resize', positionTooltip);
      document.removeEventListener('pointerdown', onPagePointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      onClose();
    },
  });

  ui.mount();

  // Tooltip follows its range while the page scrolls (including nested scroll containers).
  function positionTooltip() {
    if (!active) return;
    const rects = active.range.getClientRects();
    const rect = rects[0] ?? active.range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    const below = rect.top - th - 10 < 8;
    const left = Math.min(Math.max(8, rect.left + Math.min(rect.width, 240) / 2 - tw / 2), window.innerWidth - tw - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${below ? rect.bottom + 10 : rect.top - th - 10}px`;
    tooltip.classList.toggle('below', below);
    tooltip.style.setProperty('--arrow-x', `${Math.min(Math.max(12, rect.left + 12 - left), tw - 12)}px`);
  }

  function showFinding(finding: PlacedFinding | null) {
    active = finding;
    setActiveHighlight(finding);
    body.querySelectorAll('.finding').forEach((el) =>
      el.classList.toggle('active', !!finding && el.getAttribute('data-sentence') === String(finding.sentenceId)),
    );
    if (!finding) {
      tooltip.hidden = true;
      return;
    }
    const meta = CATEGORIES[finding.category];
    tooltip.replaceChildren(
      el('div', 'tooltip-head', [
        chip(finding.category),
        el('span', 'confidence', `${Math.round(finding.confidence * 100)}% confidence`),
      ]),
      el('p', 'rationale', finding.rationale),
    );
    tooltip.style.setProperty('--cat', meta.color);
    tooltip.hidden = false;
    // Center the passage in the viewport; the tooltip tracks it during the smooth scroll.
    const rect = finding.range.getBoundingClientRect();
    window.scrollBy({ top: rect.top - window.innerHeight * 0.4, behavior: 'smooth' });
    positionTooltip();
  }

  function onPagePointerDown(e: PointerEvent) {
    if (active && !e.composedPath().includes(ui.shadowHost)) showFinding(null);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && active) showFinding(null);
  }
  window.addEventListener('scroll', positionTooltip, { capture: true, passive: true });
  window.addEventListener('resize', positionTooltip);
  document.addEventListener('pointerdown', onPagePointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);

  function renderResult({ content, findings }: ScanResult) {
    const placed = applyHighlights(findings, content.sentences);
    const list = el('ol', 'findings');
    for (const f of placed) {
      const button = el('button', 'finding', [
        el('div', 'finding-head', [chip(f.category), el('span', 'confidence', `${Math.round(f.confidence * 100)}%`)]),
        el('p', 'excerpt', truncate(f.sentence.text, 140)),
      ]);
      button.type = 'button';
      button.setAttribute('data-sentence', String(f.sentenceId));
      button.addEventListener('click', () => showFinding(f));
      list.append(el('li', null, [button]));
    }

    const summary = content.sentences.length
      ? `${placed.length} flagged of ${content.sentences.length} sentences`
      : 'No article text found on this page.';
    body.replaceChildren(
      el('p', 'label', content.isArticle ? 'Article' : 'Page'),
      el('p', 'title', content.title || location.hostname),
      el('p', 'muted', summary),
      ...(placed.length ? [list] : []),
      el('p', 'muted note', 'Placeholder results: sentences and categories are random.'),
    );
  }

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

      showFinding(null);
      clearHighlights();
      raise();
      body.innerHTML = `<p class="muted">Scanning page…</p>`;

      const color = getComputedStyle(sweep).getPropertyValue('background-color');
      const [result] = await Promise.all([
        run(),
        playScanEffect({ canvas, line: sweep, screenshot, color, durationMs: SCAN_EFFECT_MS }),
      ]);

      renderResult(result);
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string | null,
  children?: string | Node[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof children === 'string') node.textContent = children; // page text: never innerHTML
  else if (children) node.append(...children);
  return node;
}

function chip(category: keyof typeof CATEGORIES) {
  const node = el('span', 'chip', CATEGORIES[category].label);
  node.style.setProperty('--cat', CATEGORIES[category].color);
  return node;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function nextFrames(n: number) {
  return new Promise<void>((resolve) => {
    const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}
