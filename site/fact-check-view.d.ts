import type { FactCheckResponse, Verdict } from '../utils/analysis.ts';

export function renderFactCheckResults(
  data: FactCheckResponse,
  verdicts: Record<Verdict, { label: string; color: string }>,
  doc?: Document,
): HTMLElement;
