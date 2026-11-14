// Shared by the static demo and the bundled extension. External text is always textContent.
export function renderFactCheckResults(data, verdicts, doc = document) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const link = (url, title) => {
    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) return null;
      const a = el('a', null, title || parsed.hostname);
      a.href = parsed.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    } catch { return null; }
  };
  const root = el('div', 'claim-results');
  if (data.cached) root.append(el('p', 'claim-note', 'Previously checked'));
  if (!data.claims.length) root.append(el('p', 'claim-note', 'No independently verifiable factual claim was identified.'));
  for (const result of data.claims) {
    const section = el('section', 'claim-result');
    section.append(el('p', 'claim-text', result.claim));
    const verdict = verdicts[result.verdict] || verdicts.unverifiable;
    const badge = el('span', 'chip', verdict.label);
    badge.style.setProperty('--cat', verdict.color);
    section.append(badge, el('p', 'claim-summary', result.summary));
    if (result.sources.length) {
      section.append(el('p', 'claim-heading', 'Evidence used'));
      const list = el('ul', 'claim-sources');
      for (const source of result.sources) {
        const a = link(source.url, source.title);
        if (!a) continue;
        const item = el('li');
        item.append(a);
        if (source.citedText) item.append(el('blockquote', 'source-excerpt', source.citedText));
        list.append(item);
      }
      section.append(list);
    }
    if (result.reviews.length) {
      const details = el('details', 'claim-reviews');
      details.append(el('summary', null, `Published fact-checks (${result.reviews.length})`));
      for (const review of result.reviews) {
        const a = link(review.url, review.title);
        if (!a) continue;
        const item = el('div', 'claim-review');
        const date = review.reviewDate && new Date(review.reviewDate);
        const dateLabel = date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'Date unavailable';
        item.append(el('p', 'claim-heading', `${review.publisher} · ${dateLabel}`), a,
          el('p', 'claim-note', `Publisher rating: ${review.rating || 'Not provided'}`),
          el('p', 'reviewed-claim', `Reviewed claim: ${review.claim}`));
        const status = { used: 'Used in this assessment', related: 'Related review; not used as evidence',
          unavailable: 'Review text unavailable; not used as evidence' }[review.status];
        item.append(el('p', 'claim-note', status), el('p', 'claim-note', review.explanation));
        details.append(item);
      }
      section.append(details);
    } else if (result.reviewSearchStatus === 'complete') {
      section.append(el('p', 'claim-note', 'No matching published fact-checks found.'));
    }
    if (result.reviewSearchStatus !== 'complete') {
      section.append(el('p', 'claim-note', 'Published fact-checks weren’t available. Web research was used instead.'));
    }
    root.append(section);
  }
  return root;
}
