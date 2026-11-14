import { analyze, type Finding } from './analyze';
import { extractPageContent, toAnalysisRequest, type PageContent } from './extract';

export type ScanResult = { content: PageContent; findings: Finding[] };

export async function scanPage(): Promise<ScanResult> {
  const content = extractPageContent();
  const request = toAnalysisRequest(content);
  console.debug('[Verity] analysis request', request);
  const findings = await analyze(request);
  return { content, findings };
}
