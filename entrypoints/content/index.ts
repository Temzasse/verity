import './style.css';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { CAPTURE_MESSAGE, type VerityMessage } from '@/utils/messages';
import { startScan, type Outcome } from './scan';
import { playScanEffect } from './dither';
import type { AnalysisResponse, Category, FactCheckResponse, QuickResponse } from '@/utils/analysis';
import { CATEGORIES, VERDICTS, factCheck } from './analyze';
import { confidenceGauge } from './gauge';
import type { PageContent } from './extract';
import { applyHighlights, clearHighlights, setActiveHighlight, type PlacedFinding } from './highlight';

/** Categories whose findings get a "Check this claim" button (factual claims, not rhetoric). */
const CHECKABLE = new Set<Category>(['unsupported-claim', 'misinformation', 'missing-context']);

/** null = still running. */
type ViewState = {
  content: PageContent;
  quick: Outcome<QuickResponse> | null;
  smart: Outcome<AnalysisResponse> | null;
};

type FactCheckState =
  | { status: 'loading' }
  | { status: 'done'; data: FactCheckResponse }
  | { status: 'error'; error: string };

/** One scan-line pass; passes repeat until the analysis returns. */
const SCAN_EFFECT_MS = 2600;

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
          await panel.scan();
        } finally {
          busy = false;
        }
      })();
    });
  },
});

type Panel = {
  scan(): Promise<void>;
};

async function createPanel(ctx: ContentScriptContext, onClose: () => void): Promise<Panel> {
  let layer!: HTMLElement;
  let body!: HTMLElement;
  let sweep!: HTMLElement;
  let canvas!: HTMLCanvasElement;
  let tooltip!: HTMLElement;
  let focus!: HTMLElement;
  let active: PlacedFinding | null = null;
  let placed: PlacedFinding[] = [];
  let article: PageContent | null = null;
  const factChecks = new Map<string, FactCheckState>();

  const ui = await createShadowRootUi(ctx, {
    name: 'verity-overlay',
    position: 'inline',
    anchor: 'html',
    onMount(container) {
      container.innerHTML = `
        <div class="layer" popover="manual">
          <canvas class="dither"></canvas>
          <div class="focus" hidden></div>
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
      focus = container.querySelector('.focus')!;
      canvas = container.querySelector('.dither')!;
      container.querySelector('.close')!.addEventListener('click', () => {
        ui.remove();
      });
    },
    onRemove() {
      showFinding(null);
      clearHighlights();
      window.removeEventListener('scroll', positionTooltip, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onPagePointerDown, true);
      document.removeEventListener('pointermove', onPagePointerMove, true);
      document.removeEventListener('keydown', onKeyDown, true);
      setHoverCursor(false);
      onClose();
    },
  });

  ui.mount();

  /** Paragraph-level element (p, li, blockquote, heading…) that contains a finding's text. */
  function paragraphOf(range: Range): Element | null {
    const node = range.commonAncestorContainer;
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return el?.closest('p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, figcaption, td, th, pre') ?? null;
  }

  // The spotlight appears (with a fade) only once the page has finished scrolling to the finding.
  let focusReady = false;
  let focusKey: string | null = null;
  let focusToken = 0;

  function revealFocus(token: number) {
    if (token !== focusToken || !active) return;
    focusReady = true;
    focus.classList.remove('reveal');
    void focus.offsetWidth; // restart the fade-in animation
    focus.classList.add('reveal');
    positionFocus();
  }

  /** Hides the spotlight and shows it again once the scroll to the finding has settled. */
  function scheduleFocus(willScroll: boolean) {
    focusReady = false;
    focus.hidden = true;
    const token = ++focusToken;
    if (!willScroll) {
      requestAnimationFrame(() => revealFocus(token));
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', finish);
      revealFocus(token);
    };
    window.addEventListener('scrollend', finish);
    setTimeout(finish, 1200); // fallback if no scrollend fires (e.g. the scroll was interrupted)
  }

  /** Spotlights the finding's paragraph and dims the rest of the page while its tooltip is open. */
  function positionFocus() {
    if (!active || !focusReady) {
      focus.hidden = true;
      return;
    }
    // Measured every time (cheap), so it follows scrolling and layout shifts from lazy-loaded ads.
    const range = active.range.getBoundingClientRect();
    const block = paragraphOf(active.range)?.getBoundingClientRect();
    const r = block && block.width > 0 && block.height > 0 ? block : range;
    const left = Math.min(r.left, range.left);
    const top = Math.min(r.top, range.top);
    const right = Math.max(r.right, range.right);
    const bottom = Math.max(r.bottom, range.bottom);
    const pad = 10;
    focus.hidden = false;
    focus.style.left = `${left - pad}px`;
    focus.style.top = `${top - pad}px`;
    focus.style.width = `${right - left + pad * 2}px`;
    focus.style.height = `${bottom - top + pad * 2}px`;
  }

  function onResize() {
    positionTooltip();
  }

  // Tooltip follows its range while the page scrolls (including nested scroll containers).
  function positionTooltip() {
    positionFocus();
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

  function showFinding(finding: PlacedFinding | null, { scroll = true } = {}) {
    active = finding;
    setActiveHighlight(finding);
    body.querySelectorAll('.finding').forEach((item) => {
      const isActive = !!finding && item.getAttribute('data-key') === findingKey(finding);
      item.classList.toggle('active', isActive);
      if (isActive) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    if (!finding) {
      tooltip.hidden = true;
      focusKey = null;
      focusReady = false;
      focusToken++;
      positionFocus();
      return;
    }
    const meta = CATEGORIES[finding.category];
    tooltip.replaceChildren(
      el('div', 'tooltip-head', [
        chip(finding.category),
        ...(finding.source === 'quick' ? [el('span', 'tag', 'Quick')] : []),
        confidenceGauge(finding.confidence),
      ]),
      ...(finding.technique ? [el('p', 'technique', finding.technique)] : []),
      el('p', 'rationale', finding.rationale),
      ...(CHECKABLE.has(finding.category) ? [renderFactCheck(finding)] : []),
    );
    tooltip.style.setProperty('--cat', meta.color);
    tooltip.hidden = false;
    let willScroll = false;
    if (scroll) {
      // Center the passage in the viewport; the tooltip tracks it during the smooth scroll.
      const rect = finding.range.getBoundingClientRect();
      const delta = rect.top - window.innerHeight * 0.4;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      willScroll = Math.abs(delta) > 2 && !(delta > 0 && scrollY >= maxScroll - 1) && !(delta < 0 && scrollY <= 0);
      if (willScroll) window.scrollBy({ top: delta, behavior: 'smooth' });
    }
    // A different finding than the one spotlit: re-spotlight after scrolling. Same finding
    // (e.g. a re-render after a fact-check) keeps the current spotlight as is.
    const key = findingKey(finding);
    if (key !== focusKey) {
      focusKey = key;
      scheduleFocus(willScroll);
    }
    positionTooltip();
  }

  /** Fact-check section of the tooltip: button → loading → verdict with sources (or error + retry). */
  function renderFactCheck(finding: PlacedFinding): HTMLElement {
    const key = findingKey(finding);
    const state = factChecks.get(key);
    const section = el('div', 'factcheck');

    if (!state || state.status === 'error') {
      const button = el('button', 'check-button', state ? 'Retry fact-check' : 'Check this claim with web sources');
      button.type = 'button';
      button.addEventListener('click', () => void runFactCheck(finding));
      if (state) section.append(el('p', 'error', state.error));
      section.append(button);
    } else if (state.status === 'loading') {
      section.append(el('p', 'muted checking', 'Searching the web for sources…'));
    } else {
      const { verdict, summary, sources, cached } = state.data;
      const badge = el('span', 'chip', VERDICTS[verdict].label);
      badge.style.setProperty('--cat', VERDICTS[verdict].color);
      section.append(el('div', 'verdict', [badge, ...(cached ? [el('span', 'confidence', 'cached')] : [])]));
      if (summary) section.append(el('p', 'summary', summary));
      if (sources.length) {
        const list = el('ul', 'sources');
        for (const s of sources) {
          let host = '';
          try {
            const u = new URL(s.url);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
            host = u.hostname.replace(/^www\./, '');
          } catch {
            continue;
          }
          const link = el('a', null, s.title || host);
          link.href = s.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          list.append(el('li', null, [link, el('span', 'host', host)]));
        }
        section.append(el('p', 'label', 'Sources'), list);
      }
    }
    return section;
  }

  async function runFactCheck(finding: PlacedFinding) {
    const key = findingKey(finding);
    if (!article || factChecks.get(key)?.status === 'loading') return;
    const sentences = article.sentences;
    const context = sentences
      .filter((s) => Math.abs(s.id - finding.sentenceId) <= 2)
      .map((s) => s.text)
      .join(' ');
    factChecks.set(key, { status: 'loading' });
    refreshFinding(finding);
    try {
      const data = await factCheck({
        url: article.url,
        title: article.title,
        publishedTime: article.publishedTime,
        claim: finding.sentence.text,
        context,
      });
      factChecks.set(key, { status: 'done', data });
    } catch (err) {
      factChecks.set(key, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    refreshFinding(finding);
  }

  /** Re-renders the tooltip (if this finding is open) and its panel item after a fact-check update. */
  function refreshFinding(finding: PlacedFinding) {
    addVerdictBadge(finding);
    if (active && findingKey(active) === findingKey(finding)) showFinding(active, { scroll: false });
  }

  /** The finding whose highlighted text is under the given viewport point, if any. */
  function findingAt(x: number, y: number): PlacedFinding | null {
    for (const f of placed) {
      for (const r of f.range.getClientRects()) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return f;
      }
    }
    return null;
  }

  // Clicking highlighted text on the page opens its tooltip; clicking elsewhere closes it.
  // Links inside highlights still navigate as usual.
  function onPagePointerDown(e: PointerEvent) {
    if (e.composedPath().includes(ui.shadowHost)) return;
    const hit = e.button === 0 ? findingAt(e.clientX, e.clientY) : null;
    if (hit) showFinding(hit, { scroll: false });
    else if (active) showFinding(null);
  }

  // Highlights aren't elements, so show a pointer cursor over them manually.
  let moveQueued = false;
  function onPagePointerMove(e: PointerEvent) {
    if (moveQueued || !placed.length) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      setHoverCursor(!!findingAt(e.clientX, e.clientY));
    });
  }
  function setHoverCursor(on: boolean) {
    const root = document.documentElement;
    if (on) root.setAttribute('data-verity-hover', '');
    else root.removeAttribute('data-verity-hover');
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && active) showFinding(null);
  }
  window.addEventListener('scroll', positionTooltip, { capture: true, passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('pointerdown', onPagePointerDown, true);
  document.addEventListener('pointermove', onPagePointerMove, { capture: true, passive: true });
  document.addEventListener('keydown', onKeyDown, true);

  /**
   * Renders the panel and highlights for the current scan state. Called when the on-device Quick
   * findings arrive and again when the smart analysis does (null = still running).
   */
  function renderState({ content, quick, smart }: ViewState) {
    article = content;
    const n = content.sentences.length;
    const smartFindings = smart?.ok ? smart.data.findings.map((f) => ({ ...f, source: 'smart' as const })) : [];
    const smartSentences = new Set(smartFindings.map((f) => f.sentenceId));
    const quickAll = quick?.ok ? quick.data.findings : [];
    const quickSentences = new Set(quickAll.map((f) => f.sentenceId));
    // Once the smart analysis has reviewed the page, Quick findings on sentences it also flagged fold into its findings.
    const quickShown = smart?.ok ? quickAll.filter((f) => !smartSentences.has(f.sentenceId)) : quickAll;

    const activeKey = active ? findingKey(active) : null;
    placed = applyHighlights([...smartFindings, ...quickShown], content.sentences);
    const smartPlaced = placed.filter((f) => f.source !== 'quick');
    const quickPlaced = placed.filter((f) => f.source === 'quick');

    const children: Node[] = [
      el('p', 'label', content.isArticle ? 'Article' : 'Page'),
      el('p', 'title', content.title || location.hostname),
    ];
    if (!n) {
      children.push(el('p', 'muted', 'No article text found on this page.'));
    } else {
      // Quick findings first (they arrive first), then the smart analysis below them.
      if (!quick) children.push(el('p', 'muted', 'Looking for quick findings…'));
      else if (!quick.ok) children.push(el('p', 'muted note', `Quick findings unavailable: ${quick.error}`));
      else if (quickPlaced.length) {
        children.push(
          sectionTitle('Quick findings'),
          ...(smart?.ok ? [] : [el('p', 'muted note', 'A fast first look while the smart analysis runs. Less accurate.')]),
          findingList(quickPlaced, new Set()),
        );
      } else if (!smart?.ok) {
        children.push(el('p', 'muted note', 'Quick findings: nothing flagged.'));
      }

      if (!smart) children.push(el('p', 'muted status checking', 'Running smart analysis…'));
      else if (!smart.ok) children.push(el('p', 'section-title', 'Smart analysis'), el('p', 'error', smart.error));
      else {
        children.push(
          sectionTitle('Smart analysis', smartPlaced.length ? `${smartPlaced.length} flagged of ${n} sentences` : `nothing flagged in ${n} sentences`),
        );
        if (smartPlaced.length) children.push(findingList(smartPlaced, quickSentences));
      }
    }
    if (smart?.ok) {
      if (smart.data.cached) console.debug('[Verity] smart analysis served from cache');
      children.push(el('p', 'muted note', 'Findings are produced by AI and can be wrong.'));
    }
    body.replaceChildren(...children);

    for (const f of placed) addVerdictBadge(f);
    if (activeKey) showFinding(placed.find((f) => findingKey(f) === activeKey) ?? null, { scroll: false });
  }

  function sectionTitle(title: string, detail?: string) {
    return el('p', 'section-title', [document.createTextNode(title), ...(detail ? [el('span', 'section-detail', detail)] : [])]);
  }

  function findingList(findings: PlacedFinding[], alsoQuick: Set<number>) {
    const list = el('ol', 'findings');
    for (const f of findings) {
      const head = [chip(f.category), el('span', 'confidence', `${Math.round(f.confidence * 100)}%`)];
      if (f.source === 'quick') head.splice(1, 0, el('span', 'tag', 'Quick'));
      else if (alsoQuick.has(f.sentenceId)) head.splice(1, 0, el('span', 'tag', 'Also in Quick'));
      const button = el('button', `finding${f.source === 'quick' ? ' quick' : ''}`, [
        el('div', 'finding-head', head),
        ...(f.technique ? [el('p', 'technique', f.technique)] : []),
        el('p', 'excerpt', truncate(f.sentence.text, 140)),
      ]);
      button.type = 'button';
      button.setAttribute('data-key', findingKey(f));
      button.addEventListener('click', () => showFinding(f));
      list.append(el('li', null, [button]));
    }
    return list;
  }

  /** Shows a finished fact-check's verdict on the finding's panel item. */
  function addVerdictBadge(f: PlacedFinding) {
    const key = findingKey(f);
    const state = factChecks.get(key);
    const head = body.querySelector(`.finding[data-key="${CSS.escape(key)}"] .finding-head`);
    head?.querySelector('.verdict-dot')?.remove();
    if (head && state?.status === 'done') {
      const dot = el('span', 'verdict-dot', VERDICTS[state.data.verdict].label);
      dot.style.setProperty('--cat', VERDICTS[state.data.verdict].color);
      head.append(dot);
    }
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

  let scanId = 0;

  return {
    async scan() {
      const id = ++scanId;
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
      placed = [];
      article = null;
      factChecks.clear();
      raise();
      body.replaceChildren(el('p', 'muted status checking', 'Scanning page…'));

      const color = getComputedStyle(sweep).getPropertyValue('background-color');
      const scan = startScan();
      if (!scan.content.ok) {
        await playScanEffect({ canvas, line: sweep, screenshot, color, durationMs: SCAN_EFFECT_MS });
        body.replaceChildren(el('p', 'label', 'Scan failed'), el('p', 'error', scan.content.error));
        return;
      }
      const state: ViewState = { content: scan.content.data, quick: null, smart: null };

      // Quick findings show up as soon as the on-device model answers, while the sweep continues.
      void scan.quick.then((quick) => {
        if (id !== scanId) return;
        state.quick = quick;
        renderState(state);
      });
      await playScanEffect({ canvas, line: sweep, screenshot, color, durationMs: SCAN_EFFECT_MS, until: scan.smart });
      if (id !== scanId) return;
      state.smart = await scan.smart;
      renderState(state);
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

function findingKey(f: { sentenceId: number; category: string; source?: string }) {
  return `${f.source ?? 'smart'}:${f.sentenceId}:${f.category}`;
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
