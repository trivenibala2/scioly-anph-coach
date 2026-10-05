import "server-only";

export type ExtractedSourcePage = {
  pageNumber: number;
  sourcePageNumber: number;
  text: string;
};

export async function extractPdfPages(file: File, combinedPageOffset: number) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error(`${file.name}: choose a PDF file.`);
  }
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: PDF exceeds 20 MB.`);

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;

  try {
    const pages: ExtractedSourcePage[] = [];
    let combinedPageNumber = combinedPageOffset;

    for (let sourcePageNumber = 1; sourcePageNumber <= document.numPages; sourcePageNumber += 1) {
      const page = await document.getPage(sourcePageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      page.cleanup();

      if (text) {
        combinedPageNumber += 1;
        pages.push({ pageNumber: combinedPageNumber, sourcePageNumber, text });
      }
    }

    if (!pages.length) throw new Error(`${file.name}: no selectable text found. Scanned PDFs need OCR.`);
    return pages;
  } finally {
    await document.destroy();
  }
}