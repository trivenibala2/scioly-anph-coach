"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StudyMessage, StudyShell } from "../../../components/StudyShell";
import { PaginatedLesson } from "../../../components/PaginatedLesson";
import { renderCitedPages, type PageSnapshot } from "../../../pdf-snapshots";
import { useStudy } from "../../../use-study";

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { study, loading, error, recordProgress } = useStudy(id);
  const [pageSnapshots, setPageSnapshots] = useState<PageSnapshot[]>([]);
  const pdfUrl = study?.pdfUrl ?? null;
  const lesson = study?.lesson ?? null;

  // Cited PDF pages are rendered from the saved PDF in Supabase Storage.
  useEffect(() => {
    if (!pdfUrl || !lesson) return;
    let cancelled = false;
    const cited = [
      ...new Set([
        ...(lesson.introSourcePages ?? []),
        ...lesson.sections.flatMap((section) => section.sourcePages),
        ...(lesson.visuals ?? []).flatMap((visual) => visual.sourcePages),
      ]),
    ].slice(0, 40);
    void fetch(pdfUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("PDF unavailable"))))
      .then((bytes) => renderCitedPages(bytes, cited))
      .then((snapshots) => { if (!cancelled) setPageSnapshots(snapshots); })
      .catch(() => { /* Page images are a bonus; the cited page numbers still show. */ });
    return () => { cancelled = true; };
  }, [pdfUrl, lesson]);

  return (
    <StudyShell>
      <div className="workspace">
        {loading ? (
          <StudyMessage title="Loading your lesson…" body="Restoring the saved study." />
        ) : error || !study || !lesson ? (
          <StudyMessage title="Lesson not found" body={error || "This study could not be loaded."} href="/" cta="Back to weeks" />
        ) : lesson.insufficientInformation ? (
          <section className="lesson-column lesson-ready lesson-page-card">
            <div className="lesson-result">
              <h3 className="lesson-title">{lesson.title}</h3>
              <p className="lesson-intro">{lesson.intro}</p>
              <div className="insufficient-note" role="status">
                <p>The lesson stays within the source. A packet with more detail is needed to build out the teaching sections.</p>
              </div>
            </div>
          </section>
        ) : (
          <section className="lesson-column lesson-ready lesson-page-card" aria-labelledby="lesson-heading">
            <PaginatedLesson
              lesson={lesson}
              weekNumber={study.weekNumber}
              fileName={study.fileName}
              pdfUrl={pdfUrl}
              pageSnapshots={pageSnapshots}
              pages={study.pages ?? []}
              isCompleted={Boolean(study.progress?.lessonCompletedAt)}
              onComplete={() => void recordProgress({ event: "lesson" })}
              onNavigateToFlashcards={() => {
                void recordProgress({ event: "lesson" });
                router.push(`/study/${id}/flashcards`);
              }}
              onNavigateToTest={() => {
                void recordProgress({ event: "lesson" });
                router.push(`/study/${id}/test`);
              }}
            />
          </section>
        )}
      </div>
    </StudyShell>
  );
}
