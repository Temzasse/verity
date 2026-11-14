import type { ClaimAssessment, PendingClaim, Verdict } from '../utils/analysis.ts';

export function renderFactCheckResults(
  data: { claims: (ClaimAssessment | PendingClaim)[]; cached?: boolean },
  verdicts: Record<Verdict, { label: string; color: string }>,
  doc?: Document,
): HTMLElement;
