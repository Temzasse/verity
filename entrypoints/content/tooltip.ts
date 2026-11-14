type Box = { left: number; top: number; right: number; bottom: number };

type Placement = {
  side: 'above' | 'below' | 'side';
  leftOffset: number;
  edgeOffset: number;
  maxHeight: number;
};

/** Choose a placement once, then follow the passage without flipping or pinning to the viewport. */
export function createTooltipPositioner(tooltip: HTMLElement) {
  let placement: Placement | null = null;

  return {
    reset() {
      placement = null;
    },
    scrollIntoView() {
      if (tooltip.hidden || !placement) return;
      const rect = tooltip.getBoundingClientRect();
      const margin = 16;
      const top = rect.top < margin
        ? rect.top - margin
        : Math.max(0, rect.bottom - window.innerHeight + margin);
      // This card is in a fixed top-layer overlay, so native scrollIntoView cannot move
      // the underlying page. Scroll only after a disclosure toggle, never on page scroll.
      if (Math.abs(top) > 1) window.scrollBy({ top, behavior: 'smooth' });
    },
    update(range: Range, box: Box) {
      if (tooltip.hidden) return;
      const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      if (!placement) {
        const maxHeight = window.innerHeight * 0.8;
        tooltip.style.maxHeight = `${maxHeight}px`;
        tooltip.classList.remove('capped');
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const gap = 10;
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const spaceAbove = box.top - gap - margin;
        const spaceBelow = vh - box.bottom - gap - margin;
        let left = Math.min(Math.max(margin, rect.left + Math.min(rect.width, 240) / 2 - tw / 2), vw - tw - margin);
        let side: Placement['side'];
        let top: number;
        let initialHeightLimit: number;

        // Use the available room to choose the initial anchor. Expanded content can grow
        // beyond that band up to 80vh without changing sides or moving the anchor.
        if (th <= spaceAbove) {
          side = 'above';
          initialHeightLimit = spaceAbove;
          top = box.top - gap - th;
        } else if (th <= spaceBelow) {
          side = 'below';
          initialHeightLimit = spaceBelow;
          top = box.bottom + gap;
        } else if (vw - box.right - gap - margin >= tw || box.left - gap - margin >= tw) {
          side = 'side';
          left = vw - box.right - gap - margin >= tw ? box.right + gap : box.left - gap - tw;
          top = Math.min(Math.max(margin, rect.top - 20), Math.max(margin, vh - th - margin));
          initialHeightLimit = vh - top - margin;
        } else if (Math.max(spaceAbove, spaceBelow) >= 180) {
          side = spaceBelow >= spaceAbove ? 'below' : 'above';
          initialHeightLimit = side === 'below' ? spaceBelow : spaceAbove;
          top = side === 'below' ? box.bottom + gap : margin;
        } else {
          side = rect.top - th - gap < margin ? 'below' : 'above';
          initialHeightLimit = Math.max(1, side === 'below' ? vh - rect.bottom - gap - margin : rect.top - gap - margin);
          top = side === 'below' ? rect.bottom + gap : rect.top - th - gap;
        }

        const height = Math.min(th, initialHeightLimit);
        top = Math.min(Math.max(margin, top), Math.max(margin, vh - height - margin));
        placement = {
          side,
          leftOffset: left - rect.left,
          edgeOffset: top + (side === 'above' ? height : 0) - rect.top,
          maxHeight,
        };
        tooltip.classList.toggle('below', side === 'below');
        tooltip.classList.toggle('side', side === 'side');
        tooltip.style.setProperty('--arrow-x', `${Math.min(Math.max(12, rect.left + 12 - left), tw - 12)}px`);
      }

      // Above the passage, keep the bottom edge anchored and grow upwards. Below or beside
      // it, keep the top edge anchored. Never clamp again while scrolling or changing content.
      tooltip.style.left = `${rect.left + placement.leftOffset}px`;
      tooltip.style.top = `${rect.top + placement.edgeOffset - (placement.side === 'above' ? tooltip.offsetHeight : 0)}px`;
      // The decorative arrow contributes to scrollHeight even when the content fits.
      tooltip.classList.toggle('capped', tooltip.offsetHeight >= placement.maxHeight - 1);
    },
  };
}
