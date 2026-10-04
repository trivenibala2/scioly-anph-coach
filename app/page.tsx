"use client";

import { ChangeEvent, DragEvent, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  BookOpenCheck,
  Check,
  FileText,
  HeartPulse,
  Image as ImageIcon,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  clearStudySession,
  getServerStudySessionSnapshot,
  getStudySessionSnapshot,
  isLessonResult,
  restoreStudySession,
  saveStudySession,
  subscribeToStudySession,
  type KeyTerm,
} from "./study-session";

type ExtractedPage = {
  pageNumber: number;
  text: string;
};

type PageSnapshot = {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
};

type WorkState = "empty" | "extracting" | "ready" | "generating";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 80_000;

function HighlightedParagraph({ text, terms }: { text: string; terms: KeyTerm[] }) {
  const sortedTerms = [...terms]
    .filter((item) => item.term.trim())
    .sort((first, second) => second.term.length - first.term.length);
  if (!sortedTerms.length) return <p>{text}</p>;

  const expression = new RegExp(`(${sortedTerms.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return (
    <p>
      {text.split(expression).map((part, index) => {
        const term = sortedTerms.find((item) => item.term.toLowerCase() === part.toLowerCase());
        return term ? <mark key={`${part}-${index}`} title={term.definition}>{part}</mark> : part;
      })}
    </p>
  );
}

function PageCitations({ pages }: { pages: number[] }) {
  return (
    <div className="lesson-citations" aria-label="Source pages">
      {pages.map((pageNumber) => <span className="citation-chip" key={pageNumber}>PDF · page {pageNumber}</span>)}
    </div>
  );
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfBytes = useRef<ArrayBuffer | null>(null);
  const storedSession = useSyncExternalStore(
    subscribeToStudySession,
    getStudySessionSnapshot,
    getServerStudySessionSnapshot,
  );
  const lesson = restoreStudySession(storedSession);
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [pageSnapshots, setPageSnapshots] = useState<PageSnapshot[]>([]);
  const [workState, setWorkState] = useState<WorkState>("empty");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  async function readPdf(file: File) {
    setError("");

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file to get started.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("This PDF is over 20 MB. Try a smaller study packet.");
      return;
    }

    clearStudySession();
    setFileName(file.name);
    setPages([]);
    setPageSnapshots([]);
    pdfBytes.current = null;
    setWorkState("extracting");

    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      const fileBytes = await file.arrayBuffer();
      pdfBytes.current = fileBytes.slice(0);
      const document = await pdfjs.getDocument({ data: new Uint8Array(fileBytes) }).promise;
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
      pdfBytes.current = null;
    }
  }

  async function renderCitedPages(pageNumbers: number[]) {
    if (!pdfBytes.current || pageNumbers.length === 0) return [];

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    const document = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes.current.slice(0)) }).promise;
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

  async function generateLesson() {
    setError("");
    setWorkState("generating");

    try {
      const response = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      });
      const result: unknown = await response.json();

      if (!response.ok || !isLessonResult(result)) {
        throw new Error(
          typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
            ? result.error
            : "We couldn’t create a lesson just now.",
        );
      }

      try {
        saveStudySession(result);
      } catch {
        throw new Error("Your browser couldn’t save this study session for flashcards. Check that session storage is available.");
      }

      const citedPages = [...new Set(result.sections.flatMap((section) => section.sourcePages))].slice(0, 8);
      try {
        setPageSnapshots(await renderCitedPages(citedPages));
      } catch {
        setPageSnapshots([]);
      }
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
    setPageSnapshots([]);
    pdfBytes.current = null;
    clearStudySession();
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
                <div className="lesson-kicker"><BookOpenCheck size={16} /> SCIENCE OLYMPIAD · A&amp;P</div>
                <h3 className="lesson-title">{lesson.title}</h3>
                <p className="lesson-intro">{lesson.intro}</p>

                {lesson.insufficientInformation ? (
                  <div className="insufficient-note" role="status">
                    <BookOpenCheck size={18} />
                    <p>The lesson stays within your source. Add a packet with more detail to build out the teaching sections.</p>
                  </div>
                ) : (
                  <>
                    <div className="teaching-sections">
                      {lesson.sections.map((section, index) => (
                        <article className="teaching-section" key={`${section.heading}-${index}`}>
                          <div className="teaching-section-heading">
                            <span>{String(index + 1).padStart(2, "0")}</span>
                            <h4>{section.heading}</h4>
                          </div>
                          <div className="teaching-copy">
                            {section.paragraphs.map((paragraph, paragraphIndex) => (
                              <HighlightedParagraph key={`${section.heading}-${paragraphIndex}`} text={paragraph} terms={section.keyTerms} />
                            ))}
                          </div>
                          {section.keyTerms.length > 0 && (
                            <dl className="key-term-list">
                              {section.keyTerms.map((keyTerm) => (
                                <div className="key-term" key={`${section.heading}-${keyTerm.term}`}>
                                  <dt>{keyTerm.term}</dt>
                                  <dd>{keyTerm.definition}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                          <div className="section-source-row">
                            <span className="source-label">IN YOUR PDF</span>
                            <PageCitations pages={section.sourcePages} />
                          </div>
                          {section.sourcePages.some((pageNumber) => pageSnapshots.some((snapshot) => snapshot.pageNumber === pageNumber)) && (
                            <div className="source-visuals">
                              <div className="visual-heading"><ImageIcon size={14} /> From your packet</div>
                              <div className="visual-grid">
                                {section.sourcePages.slice(0, 2).map((pageNumber) => {
                                  const snapshot = pageSnapshots.find((item) => item.pageNumber === pageNumber);
                                  return snapshot ? (
                                    <figure className="source-visual" key={`${section.heading}-${pageNumber}`}>
                                      <Image
                                        src={snapshot.dataUrl}
                                        alt={`Uploaded PDF page ${pageNumber}`}
                                        width={snapshot.width}
                                        height={snapshot.height}
                                        unoptimized
                                      />
                                      <figcaption>PDF page {pageNumber}</figcaption>
                                    </figure>
                                  ) : null;
                                })}
                              </div>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>

                    {lesson.rememberThis.length > 0 && (
                      <section className="remember-panel" aria-labelledby="remember-heading">
                        <div className="remember-kicker"><Sparkles size={15} /> TAKE THIS WITH YOU</div>
                        <h4 id="remember-heading">Remember This</h4>
                        <ul>{lesson.rememberThis.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul>
                      </section>
                    )}

                    <div className="lesson-actions">
                      {lesson.flashcards.length > 0 ? (
                        <Link className="button button-practice" href="/flashcards">
                          <RotateCcw size={18} /> Practice Flashcards <span className="card-count">{lesson.flashcards.length}</span>
                        </Link>
                      ) : (
                        <button className="button button-practice" type="button" disabled title="No source-supported flashcards could be made from this packet.">
                          <RotateCcw size={18} /> Practice Flashcards
                        </button>
                      )}
                      {lesson.quickTestQuestions.length === 5 ? (
                        <Link id="quick-test" className="button button-test" href="/test">
                          <Check size={18} /> Take Quick Test
                        </Link>
                      ) : (
                        <button id="quick-test" className="button button-test" type="button" disabled title="This packet does not support five distinct cited questions.">
                          <Check size={18} /> Take Quick Test
                        </button>
                      )}
                    </div>
                  </>
                )}
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