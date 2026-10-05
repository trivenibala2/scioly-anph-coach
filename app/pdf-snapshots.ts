export type PageSnapshot = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

export type ExtractedPage = { pageNumber: number; text: string };

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return pdfjs;
}

export async function extractPdfPages(fileBytes: ArrayBuffer, maxPages = 200): Promise<ExtractedPage[]> {
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(fileBytes.slice(0)) }).promise;
  if (document.numPages > maxPages) throw new Error(`This PDF has more than ${maxPages} pages. Try a shorter study packet.`);

  const pages: ExtractedPage[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .flatMap((item) => ("str" in item ? [item.str] : []))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push({ pageNumber, text });
  }
  await document.destroy();
  return pages;
}

export async function renderCitedPages(fileBytes: ArrayBuffer, pageNumbers: number[]): Promise<PageSnapshot[]> {
  if (pageNumbers.length === 0) return [];
  const pdfjs = await loadPdfjs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(fileBytes.slice(0)) }).promise;
  const snapshots: PageSnapshot[] = [];

  try {
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > document.numPages) continue;
      const page = await document.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1, 720 / originalViewport.width, 880 / originalViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");

      if (context) {
        await page.render({ canvasContext: context, viewport }).promise;
        snapshots.push({
          pageNumber,
          dataUrl: canvas.toDataURL("image/jpeg", 0.78),
          width: canvas.width,
          height: canvas.height,
        });
      }

      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }

  return snapshots;
}
