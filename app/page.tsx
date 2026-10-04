"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import {
  BookOpenCheck,
  Check,
  FileText,
  HeartPulse,
  LoaderCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

type ExtractedPage = {
  pageNumber: number;
  text: string;
};

type LessonResult = {
  lesson: string;
  sourcePages: number[];
};

type WorkState = "empty" | "extracting" | "ready" | "generating";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 80_000;

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [workState, setWorkState] = useState<WorkState>("empty");
  const [lesson, setLesson] = useState<LessonResult | null>(null);
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  async function readPdf(file: File) {
    setError("");
    setLesson(null);

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file to get started.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This PDF is over 20 MB. Try a smaller study packet.");
      return;
    }

    setFileName(file.name);
    setPages([]);
    setWorkState("extracting");

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const document = await pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      const extractedPages: ExtractedPage[] = [];

      if (document.numPages > 200) {
        throw new Error("This PDF has more than 200 pages. Try a shorter study packet.");
      }

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        extractedPages.push({ pageNumber, text });
      }

      const textLength = extractedPages.reduce((total, page) => total + page.text.length, 0);
      if (!extractedPages.some((page) => page.text)) {
        throw new Error("No selectable text found. This may be a scanned PDF; try a text-based copy.");
      }
      if (textLength > MAX_TEXT_LENGTH) {
        throw new Error("This study packet has too much text for one lesson. Try a shorter PDF.");
      }

      setPages(extractedPages);
      setWorkState("ready");
    } catch (caughtError) {
      setWorkState("empty");
      setFileName("");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "We couldn’t read that PDF. Try another file.",
      );
    }
  }

  async function generateLesson() {
    setError("");
    setWorkState("generating");

    try {
      const response = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const result = (await response.json()) as LessonResult | { error?: string };

      if (!response.ok || !("lesson" in result)) {
        throw new Error("error" in result ? result.error : "We couldn’t create a lesson just now.");
      }

      setLesson(result);
      setWorkState("ready");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "We couldn’t create a lesson just now. Please try again.",
      );
      setWorkState("ready");
    }
  }

  function clearPdf() {
    setFileName("");
    setPages([]);
    setLesson(null);
    setError("");
    setWorkState("empty");
    if (fileInput.current) fileInput.current.value = "";
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void readPdf(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readPdf(file);
  }

  const pageCountLabel = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pulse Notes home">
          <span className="brand-mark"><HeartPulse size={20} strokeWidth={2.2} /></span>
          <span>pulse<span className="brand-light">notes</span></span>
        </a>
        <div className="topbar-note"><span className="privacy-dot" /> No account · no saved history</div>
      </header>

      <div className="workspace" id="top">
        <section className="intro">
          <div className="eyebrow"><span>SCIENCE OLYMPIAD</span><span className="eyebrow-slash">/</span><span>ANATOMY &amp; PHYSIOLOGY</span></div>
          <h1>Make your notes<br />make sense<span className="title-period">.</span></h1>
          <p className="intro-copy">A study coach that sticks to your materials. Drop in a PDF and get a short, clear lesson built from your pages.</p>
        </section>

        <div className="content-grid">
          <section className="upload-column" aria-labelledby="upload-heading">
            <div className="section-heading">
              <div className="step-index">01</div>
              <div>
                <h2 id="upload-heading">Add your study packet</h2>
                <p>Start with a class handout, notes, or a chapter.</p>
              </div>
            </div>

            {workState === "empty" || workState === "extracting" ? (
              <div
                className={`dropzone ${isDragging ? "dropzone-active" : ""} ${workState === "extracting" ? "dropzone-loading" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInput}
                  className="file-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  aria-label="Choose a PDF"
                />
                <span className="upload-icon">
                  {workState === "extracting" ? <LoaderCircle className="spin" size={24} /> : <Upload size={23} />}
                </span>
                <div className="dropzone-title">
                  {workState === "extracting" ? "Reading your pages…" : "Drop a PDF right here"}
                </div>
                <p className="dropzone-copy">{workState === "extracting" ? "Pulling out text and page numbers" : "or choose a file from your device"}</p>
                {workState === "empty" && (
                  <button className="button button-outline" type="button" onClick={() => fileInput.current?.click()}>
                    <FileText size={16} /> Choose PDF
                  </button>
                )}
                <div className="file-limits">PDF only <span>·</span> up to 20 MB <span>·</span> text-based files</div>
              </div>
            ) : (
              <div className="document-panel">
                <div className="document-topline">
                  <div className="document-icon"><FileText size={21} /></div>
                  <div className="document-info">
                    <strong title={fileName}>{fileName}</strong>
                    <span><Check size={13} /> {pageCountLabel} extracted</span>
                  </div>
                  <button className="icon-button" type="button" onClick={clearPdf} aria-label="Remove PDF" title="Remove PDF">
                    <X size={17} />
                  </button>
                </div>
                <div className="page-list-label">PAGE PREVIEW <span>{pages.length} TOTAL</span></div>
                <div className="page-previews">
                  {pages.filter((page) => page.text).slice(0, 3).map((page) => (
                    <div className="page-preview" key={page.pageNumber}>
                      <span className="page-number">{String(page.pageNumber).padStart(2, "0")}</span>
                      <p>{page.text.slice(0, 180)}{page.text.length > 180 ? "…" : ""}</p>
                    </div>
                  ))}
                  {pages.filter((page) => page.text).length > 3 && (
                    <div className="more-pages">+ {pages.filter((page) => page.text).length - 3} more pages in this packet</div>
                  )}
                </div>
                <button className="button button-primary generate-button" type="button" onClick={generateLesson} disabled={workState === "generating"}>
                  {workState === "generating" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                  {workState === "generating" ? "Building your lesson…" : "Generate lesson"}
                </button>
                <p className="local-note">Your PDF is read on this device. Only its extracted text is sent to make a lesson.</p>
              </div>
            )}

            {error && <div className="error-message" role="alert">{error}</div>}

            <div className="how-it-works">
              <span className="mini-spark"><Sparkles size={15} /></span>
              <p><strong>Only your material.</strong> Your coach won’t add facts from the internet or outside sources.</p>
            </div>
          </section>

          <section className={`lesson-column ${lesson ? "lesson-ready" : ""}`} aria-labelledby="lesson-heading" aria-live="polite">
            <div className="lesson-topline">
              <div className="step-index step-index-teal">02</div>
              <div className="lesson-heading-copy">
                <h2 id="lesson-heading">Your mini lesson</h2>
                <p>Short, clear, and made for your packet.</p>
              </div>
              {lesson && <span className="ready-badge"><span /> READY</span>}
            </div>

            {lesson ? (
              <div className="lesson-result">
                <div className="lesson-kicker"><BookOpenCheck size={16} /> ANATOMY &amp; PHYSIOLOGY</div>
                <div className="lesson-text">{lesson.lesson}</div>
                <div className="source-box">
                  <span className="source-label">BUILT FROM YOUR PDF</span>
                  <div className="source-pages">
                    {lesson.sourcePages.map((pageNumber) => <span key={pageNumber}>Page {pageNumber}</span>)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="lesson-empty">
                <div className="empty-mark"><BookOpenCheck size={22} /></div>
                <h3>{workState === "generating" ? "Connecting the ideas…" : "A little lesson, just for you."}</h3>
                <p>{workState === "generating" ? "Finding the key ideas in your study packet." : "Your lesson will appear here after you add a PDF and hit Generate."}</p>
                <div className="lesson-outline">
                  <div><span className="outline-number">A</span><span className="outline-line" /></div>
                  <div><span className="outline-number">B</span><span className="outline-line outline-line-short" /></div>
                  <div><span className="outline-number">C</span><span className="outline-line outline-line-medium" /></div>
                </div>
                <span className="citation-hint">PAGE CITATIONS INCLUDED</span>
              </div>
            )}
          </section>
        </div>

        <footer className="footer-note">
          <span>MADE FOR CURIOUS MINDS</span>
          <span>Use your packet as your source of truth.</span>
        </footer>
      </div>
    </main>
  );
}