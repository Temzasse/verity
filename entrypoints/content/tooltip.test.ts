import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { parseHTML } from 'linkedom';
import { createTooltipPositioner } from './tooltip.ts';

const originalWindow = globalThis.window;
beforeEach(() => {
  globalThis.window = { innerWidth: 1256, innerHeight: 836 } as Window & typeof globalThis;
});
after(() => {
  if (originalWindow) globalThis.window = originalWindow;
  else Reflect.deleteProperty(globalThis, 'window');
});

function fixture(top = 470, height = 300) {
  const { document } = parseHTML('<div class="tooltip"></div>');
  const tooltip = document.querySelector<HTMLElement>('.tooltip')!;
  const rect = { left: 380, top, width: 630, height: 27 };
  const size = { height };
  const scrolls: ScrollToOptions[] = [];
  const cappedHeight = () => Math.min(size.height, parseFloat(tooltip.style.maxHeight) || Infinity);
  Object.defineProperties(tooltip, {
    offsetWidth: { get: () => 300 },
    offsetHeight: { get: cappedHeight },
    clientHeight: { get: cappedHeight },
    scrollHeight: { get: () => size.height },
  });
  tooltip.getBoundingClientRect = () => ({
    top: parseFloat(tooltip.style.top),
    bottom: parseFloat(tooltip.style.top) + cappedHeight(),
  }) as DOMRect;
  window.scrollBy = ((options: ScrollToOptions) => {
    scrolls.push(options);
    rect.top -= options.top ?? 0;
  }) as typeof window.scrollBy;
  const range = { getClientRects: () => [rect] } as unknown as Range;
  const positioner = createTooltipPositioner(tooltip);
  const update = () => positioner.update(range, {
    left: rect.left - 10, top: rect.top - 10,
    right: rect.left + rect.width + 10, bottom: rect.top + rect.height + 10,
  });
  const bounds = () => ({
    left: parseFloat(tooltip.style.left),
    top: parseFloat(tooltip.style.top),
    bottom: parseFloat(tooltip.style.top) + cappedHeight(),
  });
  return { tooltip, rect, size, positioner, update, bounds, scrolls };
}

test('expansion, streamed results, and collapse keep the same edge above the passage', () => {
  const f = fixture();
  f.update();
  const initial = f.bounds();
  for (const height of [650, 900, 120, 380, 300]) {
    f.size.height = height;
    f.update();
    assert.equal(f.bounds().left, initial.left);
    assert.equal(f.bounds().bottom, initial.bottom);
    assert.equal(f.tooltip.classList.contains('below'), false);
    assert.equal(f.tooltip.classList.contains('side'), false);
    assert.ok(Math.abs(f.bounds().bottom - f.bounds().top - Math.min(height, window.innerHeight * 0.8)) < 0.01);
  }
});

test('a popup below the passage keeps its top edge when content expands and collapses', () => {
  const f = fixture(120);
  f.update();
  const initial = f.bounds();
  for (const height of [900, 100, 300]) {
    f.size.height = height;
    f.update();
    assert.equal(f.bounds().top, initial.top);
    assert.equal(f.bounds().left, initial.left);
    assert.equal(f.tooltip.classList.contains('below'), true);
    assert.ok(Math.abs(f.bounds().bottom - f.bounds().top - Math.min(height, window.innerHeight * 0.8)) < 0.01);
  }
});

test('scrolling moves the popup with the passage completely out of the viewport', () => {
  const f = fixture();
  f.update();
  const initial = f.bounds();
  f.rect.top -= 700;
  f.rect.left -= 100;
  f.update();
  assert.equal(f.bounds().bottom, initial.bottom - 700);
  assert.equal(f.bounds().left, initial.left - 100);
  assert.ok(f.bounds().bottom < 0);
  assert.equal(f.tooltip.classList.contains('below'), false);
  f.rect.top += 700;
  f.rect.left += 100;
  f.update();
  assert.deepEqual(f.bounds(), initial);
  assert.equal(f.scrolls.length, 0, 'ordinary scrolling never scrolls the popup back into view');
});

test('a popup beside the passage keeps its position and caps expanded content', () => {
  const f = fixture(470, 650);
  f.update();
  const initial = f.bounds();
  assert.equal(f.tooltip.classList.contains('side'), true);
  f.size.height = 1000;
  f.update();
  assert.equal(f.bounds().top, initial.top);
  assert.equal(f.bounds().left, initial.left);
  assert.ok(Math.abs(f.bounds().bottom - f.bounds().top - window.innerHeight * 0.8) < 0.01);
  assert.equal(f.tooltip.classList.contains('capped'), true);
  f.size.height = 100;
  f.update();
  assert.equal(f.tooltip.classList.contains('capped'), false);
});

test('hidden popups are not measured; a new selection or viewport resize can reset placement', () => {
  const f = fixture();
  f.tooltip.hidden = true;
  f.update();
  assert.equal(f.tooltip.style.top, '');
  f.tooltip.hidden = false;
  f.update();
  assert.equal(f.tooltip.classList.contains('below'), false);
  f.rect.top = 120;
  f.positioner.reset();
  f.update();
  assert.equal(f.tooltip.classList.contains('below'), true);
  assert.equal(f.bounds().top, 167);
});

for (const scenario of ['expand above', 'expand below', 'collapse'] as const) {
  test(`${scenario} scrolls the popup into view without changing its anchor`, () => {
    const f = fixture(scenario === 'expand below' ? 120 : 470);
    f.update();
    if (scenario === 'expand below') f.rect.top += 400;
    if (scenario === 'collapse') f.rect.top -= 400;
    f.size.height = scenario === 'collapse' ? 100 : 650;
    f.update();
    const before = f.bounds();
    f.positioner.scrollIntoView();
    assert.equal(f.scrolls.length, 1);
    assert.equal(f.scrolls[0]!.behavior, 'smooth');
    f.update(); // The real scroll listener updates the anchored position as the page moves.
    assert.ok(f.bounds().top >= 16);
    assert.ok(f.bounds().bottom <= window.innerHeight - 16);
    assert.equal(f.bounds().left, before.left);
    assert.equal(f.bounds().top, before.top - f.scrolls[0]!.top!);
    assert.equal(f.scrolls.length, 1, 'the scroll update does not request another scroll');
  });
}

test('a toggle needs no page scroll when the popup is already visible or hidden', () => {
  const f = fixture();
  f.update();
  f.positioner.scrollIntoView();
  assert.equal(f.scrolls.length, 0);
  f.tooltip.hidden = true;
  f.rect.top -= 700;
  f.positioner.scrollIntoView();
  assert.equal(f.scrolls.length, 0);
});
