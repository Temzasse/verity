import { z } from 'zod';
import type { ClaimAssessment, PublishedClaimReview } from '../utils/analysis.ts';
import { extractArticle } from './extract.ts';

const MAX_REVIEWS = 3;
const MAX_REVIEW_CHARS = 12_000;
const SearchSchema = z.object({ claims: z.array(z.object({
  text: z.string(),
  claimant: z.string().optional(),
  claimDate: z.string().optional(),
  claimReview: z.array(z.object({
    publisher: z.object({ name: z.string().optional() }).optional(),
    url: z.string(),
    title: z.string().optional(),
    reviewDate: z.string().optional(),
    textualRating: z.string().optional(),
  })).optional(),
})).optional() });

export type ReviewCandidate = PublishedClaimReview & { articleText?: string };

/** Search metadata is discovery only. Each candidate must be read and assessed before it is evidence. */
export async function findPublishedReviews(
  claim: string,
  articles: Map<string, Promise<string | null>>,
): Promise<{ reviews: ReviewCandidate[]; status: ClaimAssessment['reviewSearchStatus'] }> {
  const apiKey = process.env.GOOGLE_FACT_CHECK_API_KEY;
  if (!apiKey) return { reviews: [], status: 'not-configured' };
  const url = new URL('https://factchecktools.googleapis.com/v1alpha1/claims:search');
  url.search = new URLSearchParams({ query: claim, languageCode: 'en', pageSize: String(MAX_REVIEWS), key: apiKey }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = SearchSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('Invalid review search response');
    const candidates = new Map<string, ReviewCandidate>();
    for (const c of parsed.data.claims ?? []) for (const review of c.claimReview ?? []) {
      let reviewUrl: URL;
      try { reviewUrl = new URL(review.url); } catch { continue; }
      if (!['https:', 'http:'].includes(reviewUrl.protocol) || reviewUrl.username || reviewUrl.password) continue;
      reviewUrl.hash = '';
      if (candidates.has(reviewUrl.href) || candidates.size >= MAX_REVIEWS) continue;
      candidates.set(reviewUrl.href, {
        id: `review-${candidates.size + 1}`,
        claim: c.text,
        claimant: c.claimant,
        claimDate: c.claimDate,
        publisher: review.publisher?.name || reviewUrl.hostname,
        url: reviewUrl.href,
        title: review.title || c.text,
        reviewDate: review.reviewDate,
        rating: review.textualRating || '',
        status: 'related',
        explanation: 'Relevance to this claim has not been established.',
      });
    }
    const reviews = await Promise.all([...candidates.values()].map(async (review) => {
      let article = articles.get(review.url);
      if (!article) {
        article = extractArticle(review.url)
          .then((a) => a.paragraphs.join('\n').slice(0, MAX_REVIEW_CHARS))
          .catch(() => null);
        articles.set(review.url, article);
      }
      const articleText = await article;
      return articleText ? { ...review, articleText } : {
        ...review,
        status: 'unavailable' as const,
        explanation: 'The review article could not be read. Its rating is not evidence for this assessment.',
      };
    }));
    return { reviews, status: 'complete' };
  } catch {
    // Never log the request URL: it contains the Google API key.
    console.warn('[reviews] Published review search unavailable; continuing with web research.');
    return { reviews: [], status: 'unavailable' };
  }
}
