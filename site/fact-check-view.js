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
  if (!data.claims.length) root.append(el('p', 'claim-note', 'No factual claim to verify.'));
  for (const result of data.claims) {
    const section = el('section', 'claim-result');
    if (data.claims.length > 1) section.append(el('p', 'claim-text', result.claim));
    // Streamed check still running for this claim.
    if (result.pending) {
      section.append(el('p', 'claim-pending', data.claims.length > 1 ? 'Checking…' : 'Checking sources…'));
      root.append(section);
      continue;
    }
    const verdict = verdicts[result.verdict] || verdicts.unverifiable;
    const badge = el('span', 'chip', verdict.label);
    badge.style.setProperty('--cat', verdict.color);
    section.append(badge, el('p', `claim-summary${result.takeaway ? '' : ' claim-summary-preview'}`, result.takeaway || result.summary));
    // The sources are the point of a fact-check, so their links stay visible; excerpts and the
    // full assessment live under Details.
    const evidence = [
      ...result.sources.map((source) => ({ url: source.url, title: source.title })),
      ...result.reviews.filter((review) => review.status === 'used')
        .map((review) => ({ url: review.url, title: review.title, label: `Fact-check · ${review.publisher}` })),
    ];
    const seen = new Set();
    const links = el('ul', 'claim-source-links');
    for (const item of evidence) {
      const a = link(item.url, item.title);
      if (!a || seen.has(a.href)) continue;
      seen.add(a.href);
      const row = el('li');
      row.append(a, el('span', 'source-host', item.label || new URL(a.href).hostname.replace(/^www\./, '')));
      links.append(row);
    }
    if (links.childElementCount) section.append(el('p', 'claim-heading', 'Sources'), links);

    const details = el('details', 'claim-details');
    details.append(el('summary', null, 'Details'),
      el('p', 'claim-heading', 'Claim checked'), el('p', 'claim-full-text', result.claim),
      el('p', 'claim-heading', 'Assessment'), el('p', 'claim-explanation', result.summary));
    if (data.cached) details.append(el('p', 'claim-note', 'Previously checked'));

    const excerpts = result.sources.filter((source) => source.citedText && link(source.url));
    if (excerpts.length) {
      details.append(el('p', 'claim-heading', 'What the sources say'));
      const list = el('ul', 'claim-sources');
      for (const source of excerpts) {
        const item = el('li');
        item.append(el('span', 'source-host', new URL(source.url).hostname.replace(/^www\./, '')),
          el('blockquote', 'source-excerpt', source.citedText));
        list.append(item);
      }
      details.append(list);
    }
    if (result.reviews.length) {
      details.append(el('p', 'claim-heading', `Published fact-checks (${result.reviews.length})`));
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
    } else if (result.reviewSearchStatus === 'complete') {
      details.append(el('p', 'claim-note', 'No matching published fact-checks found.'));
    }
    if (result.reviewSearchStatus !== 'complete') {
      details.append(el('p', 'claim-note', 'Published fact-checks weren’t available. Web research was used instead.'));
    }
    section.append(details);
    root.append(section);
  }
  return root;
}
