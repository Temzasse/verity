# Fact-checking design

Design agreed with the user on 2026-11-14 and implemented behind the existing **Check with web sources** feature. Published-review lookup is enabled by setting `GOOGLE_FACT_CHECK_API_KEY` on the server; without it, web research remains available.

## Reader flow

1. The article scan identifies rhetoric and claims worth checking.
2. Before factual verification, use **Claim to check** in place of **Misinformation / False claim**. Preserve the other categories and techniques.
3. Factual checking runs only when the reader clicks the existing **Check with web sources** button, rather than automatically during the scan.
4. The check retrieves relevant published claim reviews through Google's Fact Check Tools API, reads the applicable review articles, and researches web sources.
5. Return an assessment based on relevant external evidence, with source links. Model agreement or confidence alone cannot establish a factual verdict.

## Unit of assessment

Assess each factual claim independently. When a sentence contains several claims, show separate results grouped under the original sentence, rather than one verdict for the sentence as a whole. Preserve the assertion's meaning and relevant context when separating claims.

For example, "Unemployment doubled, and violent crime rose 40%" contains two claims. Evidence supporting the unemployment figure does not establish the crime figure.

## Published reviews

- A review can contribute to Verity's verdict only if it concerns the same assertion and relevant circumstances.
- Display the publisher, review date, original rating, and review link. Keep the publisher's rating distinct from Verity's assessment.
- Retrieve and inspect a review's article text before using its assessment as evidence for Verity's verdict. Metadata and the publisher's rating alone are insufficient.
- If a review article cannot be retrieved, it may be shown as an attributed related review, but Verity's verdict must rely on other evidence it could inspect.
- Continue to offer web checking when no matching review is found. An empty result does not establish truth or falsity.

## Integration with the existing feature

Extend the current **Check with web sources** flow in both the extension and web demo. Keep one entry point and show the published reviews, source explanations, and per-claim assessments within its results. The existing `/fact-check` endpoint is the integration point for the expanded workflow; Google's review search is an internal evidence source, rather than a separate reader-facing tool.

## Conflicting evidence

Check dates, definitions, and relevance before treating sources as contradictory. If credible, applicable sources still disagree, return **Mixed evidence**, explain the disagreement, and link to evidence on both sides. Do not decide the verdict by counting sources supporting each side.

## Operational limits

Check up to eight independently verifiable claims per request, with at most three web searches and three published review candidates per claim. Requests exceeding the claim limit return an explicit error rather than silently omitting assertions. Reuse review article reads within the same request, and keep results for six hours. Do not cache transient review-search or article-reading failures. Account for model usage after each turn, including turns preceding a failed check, and enforce the configured daily budget between turns.

The model assesses relevance and evidence strength; citation and article-read requirements provide additional checks but do not guarantee the factual assessment is correct. `pnpm test` exercises the HTTP feature boundary with simulated external services.

Updated clients request response version 2. Versionless requests retain the original top-level fields for installed extensions, mapping mixed evidence to their existing disputed result and avoiding a single truth verdict for compound assertions. Long checks send JSON whitespace heartbeats every ten seconds; errors after headers have been sent are explicit JSON errors which updated clients display as failures. Caddy flushes those heartbeats immediately.

The extension keeps its background worker alive only while the fact-check request and response-body read are pending, using Chrome's documented periodic extension API call pattern and clearing it in `finally`.

See the [glossary](../CONTEXT.md) and [evidence requirement decision](adr/0001-require-external-evidence-for-factual-verdicts.md).
