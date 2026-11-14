import type { PageContent } from './extract';

/** Compact completion badge. Only shown once both scans succeed without findings. */
export function clearResult(content: PageContent, onDismiss: () => void): HTMLElement {
  const details = document.createElement('details');
  details.className = 'clear-result';
  details.innerHTML = `
    <summary class="clear-summary">
      <span class="clear-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 12 4 4 8-8"/></svg>
      </span>
      <span class="clear-copy"><strong>Nothing flagged</strong><span class="clear-count"></span></span>
      <svg class="clear-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 6.5 3 3 3-3"/></svg>
    </summary>
    <div class="clear-details">
      <p class="label"></p>
      <p class="title"></p>
      <p class="clear-scope">Quick scan and Smart analysis complete.</p>
      <p class="clear-limitation">AI analysis can miss issues. Facts have not been independently verified.</p>
      <button class="keep-reading" type="button">Keep reading <span aria-hidden="true">→</span></button>
    </div>`;
  const n = content.sentences.length;
  details.querySelector('.clear-count')!.textContent = `${n} ${n === 1 ? 'sentence' : 'sentences'} reviewed`;
  details.querySelector('.label')!.textContent = content.isArticle ? 'Article' : 'Page';
  details.querySelector('.title')!.textContent = content.title || location.hostname;
  details.querySelector('.keep-reading')!.addEventListener('click', onDismiss);
  return details;
}
