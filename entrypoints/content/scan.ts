export type ScanResult = {
  title: string;
  url: string;
  wordCount: number;
  linkCount: number;
  imageCount: number;
};

/** Placeholder scan: collects basic page stats. Replace with the real analysis. */
export async function scanPage(): Promise<ScanResult> {
  await new Promise((resolve) => setTimeout(resolve, 900)); // fake latency so the scanning state is visible
  const text = document.body.innerText;
  return {
    title: document.title,
    url: location.href,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    linkCount: document.links.length,
    imageCount: document.images.length,
  };
}
