"use client";

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, LoaderCircle, Sparkles, Trash2, Upload, X } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { useAccount } from "../use-account";
import { extractPdfPages, readPdfAsBase64, type ExtractedPage } from "../pdf-snapshots";
import { isLessonResult, type StudyProgress } from "../study-session";

type Week = {
  id: string;
  weekNumber: number;
  title: string;
  fileName: string;
  flashcardCount: number;
  questionCount: number;
  progress: Record<string, StudyProgress | null>;
};

type WorkState = "empty" | "extracting" | "ready" | "generating";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_TEXT_LENGTH = 80_000;

function errorMessage(result: unknown, fallback: string) {
  return typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : fallback;
}

function StudentStatus({ progress }: { progress: StudyProgress | null | undefined }) {
  if (!progress) return <span className="status-none">Not started</span>;
  return (
    <span className="status-cell">
      <span className={progress.lessonCompletedAt ? "status-done" : ""}>Lesson</span>
      <span className={progress.flashcardsCompletedAt ? "status-done" : ""}>Cards</span>
      <span className={progress.testSubmittedAt ? "status-done" : ""}>
        Test{progress.testScore !== null ? ` ${progress.testScore}/5` : ""}
      </span>
    </span>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { account, signOut } = useAccount("admin");
  const fileInput = useRef<HTMLInputElement>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [students, setStudents] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [weekNumber, setWeekNumber] = useState("0");
  const [workState, setWorkState] = useState<WorkState>("empty");
  const [error, setError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const loadWeeks = useCallback(async () => {
    try {
      const response = await fetch("/api/weeks");
      const result = (await response.json()) as { weeks?: Week[]; students?: string[]; error?: string };
      if (!response.ok || !result.weeks) throw new Error(errorMessage(result, "We couldn’t load the weeks."));
      setWeeks(result.weeks);
      setStudents(result.students ?? []);
      setWeekNumber((current) => {
        const taken = new Set(result.weeks?.map((week) => week.weekNumber));
        if (!taken.has(Number(current))) return current;
        let next = 0;
        while (taken.has(next)) next += 1;
        return String(next);
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t load the weeks.");
    }
  }, []);

  useEffect(() => {
    if (!account) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWeeks();
  }, [account, loadWeeks]);

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

    setSelectedFile(file);
    setPages([]);
    setWorkState("extracting");
    try {
      const extracted = await extractPdfPages(await file.arrayBuffer());
      if (!extracted.some((page) => page.text)) throw new Error("No selectable text found. This may be a scanned PDF; try a text-based copy.");
      if (extracted.reduce((total, page) => total + page.text.length, 0) > MAX_TEXT_LENGTH) {
        throw new Error("This study packet has too much text for one lesson. Try a shorter PDF.");
      }
      setPages(extracted);
      setWorkState("ready");
    } catch (caught) {
      setSelectedFile(null);
      setWorkState("empty");
      setError(caught instanceof Error ? caught.message : "We couldn’t read that PDF. Try another file.");
    }
  }

  async function generateAndSave() {
    setError("");
    const number = Number(weekNumber);
    if (!selectedFile) { setError("Please choose the PDF again before generating."); return; }
    if (!Number.isInteger(number) || number < 0 || number > 99) { setError("Choose a week number from 0 to 99."); return; }
    if (weeks.some((week) => week.weekNumber === number)) {
      setError(`Week ${number} already has a lesson. Delete it first, or pick another week number.`);
      return;
    }

    setWorkState("generating");
    try {
      // Step 1: persist the PDF and extracted text first, so a slow or failed
      // generation never loses the upload. The week starts in "processing".
      const form = new FormData();
      form.append("file", selectedFile);
      form.append("weekNumber", String(number));
      form.append("pages", JSON.stringify(pages));
      const saveResponse = await fetch("/api/study", { method: "POST", body: form });
      const saved = (await saveResponse.json()) as { studyId?: string; error?: string };
      if (!saveResponse.ok || !saved.studyId) throw new Error(errorMessage(saved, "We couldn’t save the uploaded PDF."));
      const studyId = saved.studyId;

      // Step 2: generate the lesson. The PDF is sent to Gemini directly so it can read the
      // diagrams and labeled figures; the extracted text is used to verify evidence quotes.
      const pdfData = await readPdfAsBase64(selectedFile);
      const lessonResponse = await fetch("/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, pdf: { data: pdfData, mimeType: "application/pdf" } }),
      });
      const lesson: unknown = await lessonResponse.json();
      if (!lessonResponse.ok || !isLessonResult(lesson)) {
        throw new Error(errorMessage(lesson, "The PDF was saved, but we couldn’t generate the lesson. Try generating again from the week list."));
      }

      // Step 3: attach the generated lesson and mark the week ready.
      const finalizeResponse = await fetch(`/api/study/${studyId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lesson }),
      });
      const finalized = (await finalizeResponse.json()) as { studyId?: string; error?: string };
      if (!finalizeResponse.ok || !finalized.studyId) throw new Error(errorMessage(finalized, "The lesson was created, but could not be saved."));

      router.push(`/study/${studyId}/lesson`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t create a lesson just now. Please try again.");
      setWorkState("ready");
      void loadWeeks();
    }
  }

  async function deleteWeek(week: Week) {
    if (!window.confirm(`Delete Week ${week.weekNumber} (${week.title})? This removes the PDF, lesson, flashcards, test, and all student progress for it.`)) return;
    const response = await fetch(`/api/study/${week.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(errorMessage(await response.json().catch(() => null), "We couldn’t delete that week."));
      return;
    }
    await loadWeeks();
  }

  function clearPdf() {
    setSelectedFile(null);
    setPages([]);
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

  return (
    <main className="app-shell">
      <TopBar homeHref="/admin" username={account?.username} roleLabel="admin" onSignOut={signOut} />
      <div className="workspace">
        <section className="intro">
          <div className="eyebrow"><span>ADMIN</span><span className="eyebrow-slash">/</span><span>STUDY WEEKS</span></div>
          <h1>Upload once, study together<span className="title-period">.</span></h1>
          <p className="intro-copy">Upload a PDF for a week. The lesson, flashcards, and Quick Test are generated one time and shared with both students.</p>
        </section>

        <div className="content-grid">
          <section className="upload-column" aria-labelledby="upload-heading">
            <div className="section-heading">
              <div className="step-index">01</div>
              <div>
                <h2 id="upload-heading">Add a week</h2>
                <p>Choose the week number, then the PDF.</p>
              </div>
            </div>

            <label className="field-label" htmlFor="week-number">Week number</label>
            <input
              id="week-number"
              className="text-field"
              type="number"
              min={0}
              max={99}
              value={weekNumber}
              onChange={(event) => setWeekNumber(event.target.value)}
              disabled={workState === "generating"}
            />

            {workState === "empty" || workState === "extracting" ? (
              <div
                className={`dropzone ${isDragging ? "dropzone-active" : ""} ${workState === "extracting" ? "dropzone-loading" : ""}`}
                onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInput} className="file-input" type="file" accept="application/pdf,.pdf" onChange={handleFileChange} aria-label="Choose a PDF" />
                <span className="upload-icon">{workState === "extracting" ? <LoaderCircle className="spin" size={24} /> : <Upload size={23} />}</span>
                <div className="dropzone-title">{workState === "extracting" ? "Reading the pages…" : "Drop a PDF right here"}</div>
                <p className="dropzone-copy">{workState === "extracting" ? "Pulling out text and page numbers" : "or choose a file from your device"}</p>
                {workState === "empty" && (
                  <button className="button button-outline" type="button" onClick={() => fileInput.current?.click()}><FileText size={16} /> Choose PDF</button>
                )}
                <div className="file-limits">PDF only <span>·</span> up to 20 MB <span>·</span> text-based files</div>
              </div>
            ) : (
              <div className="document-panel">
                <div className="document-topline">
                  <div className="document-icon"><FileText size={21} /></div>
                  <div className="document-info">
                    <strong title={selectedFile?.name}>{selectedFile?.name}</strong>
                    <span><Check size={13} /> {pages.length} {pages.length === 1 ? "page" : "pages"} extracted</span>
                  </div>
                  <button className="icon-button" type="button" onClick={clearPdf} aria-label="Remove PDF" title="Remove PDF" disabled={workState === "generating"}><X size={17} /></button>
                </div>
                <button className="button button-primary generate-button" type="button" onClick={generateAndSave} disabled={workState === "generating"}>
                  {workState === "generating" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
                  {workState === "generating" ? "Building and saving the week…" : `Generate Week ${weekNumber || "…"}`}
                </button>
                <p className="local-note">Only the extracted text is sent to Gemini. The PDF and everything generated are saved once in Supabase.</p>
              </div>
            )}

            {error && <div className="error-message" role="alert">{error}</div>}
          </section>

          <section className="lesson-column" aria-labelledby="weeks-heading">
            <div className="lesson-topline">
              <div className="step-index step-index-teal">02</div>
              <div className="lesson-heading-copy">
                <h2 id="weeks-heading">Weeks &amp; student progress</h2>
                <p>Open a week to preview it, or delete it to re-upload.</p>
              </div>
            </div>

            {weeks.length === 0 ? (
              <div className="empty-weeks">No weeks yet. Upload Week 0 to get started.</div>
            ) : (
              <div className="admin-week-list">
                {weeks.map((week) => (
                  <article className="admin-week" key={week.id}>
                    <div className="admin-week-head">
                      <div>
                        <span className="week-badge">WEEK {week.weekNumber}</span>
                        <h3>{week.title}</h3>
                        <p className="admin-week-meta">{week.fileName} · {week.flashcardCount} cards · {week.questionCount} questions</p>
                      </div>
                      <div className="admin-week-actions">
                        <Link className="button button-outline" href={`/study/${week.id}/lesson`}>Preview</Link>
                        <button className="icon-button" type="button" onClick={() => void deleteWeek(week)} aria-label={`Delete week ${week.weekNumber}`} title="Delete week"><Trash2 size={16} /></button>
                      </div>
                    </div>
                    <div className="student-status-list">
                      {students.map((student) => (
                        <div className="student-status" key={student}>
                          <strong>{student}</strong>
                          <StudentStatus progress={week.progress[student]} />
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
