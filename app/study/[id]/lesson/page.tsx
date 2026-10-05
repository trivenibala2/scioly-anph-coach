"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpenCheck, Check, Image as ImageIcon, RotateCcw, Sparkles } from "lucide-react";
import { StudyMessage, StudyShell } from "../../../components/StudyShell";
import { renderCitedPages, type PageSnapshot } from "../../../pdf-snapshots";
import type { KeyTerm } from "../../../study-session";
import { useStudy } from "../../../use-study";

function HighlightedParagraph({ text, terms }: { text: string; terms: KeyTerm[] }) {
  const sortedTerms = [...terms].filter((item) => item.term.trim()).sort((first, second) => second.term.length - first.term.length);
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

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const { study, loading, error, recordProgress } = useStudy(id);
  const [pageSnapshots, setPageSnapshots] = useState<PageSnapshot[]>([]);
  const pdfUrl = study?.pdfUrl ?? null;
  const lesson = study?.lesson ?? null;

  // Cited PDF pages are rendered from the saved PDF in Supabase Storage.
  useEffect(() => {
    if (!pdfUrl || !lesson) return;
    let cancelled = false;
    const cited = [...new Set([...(lesson.introSourcePages ?? []), ...lesson.sections.flatMap((section) => section.sourcePages)])].slice(0, 8);
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
        ) : (
          <section className="lesson-column lesson-ready lesson-page-card" aria-labelledby="lesson-heading">
            <div className="lesson-topline">
              <div className="step-index step-index-teal">W{study.weekNumber}</div>
              <div className="lesson-heading-copy">
                <h2 id="lesson-heading">Week {study.weekNumber} lesson</h2>
                <p>Built once from {study.fileName || "the uploaded PDF"}.</p>
              </div>
              <span className="ready-badge"><span /> {study.progress?.lessonCompletedAt ? "LESSON DONE" : "READY"}</span>
            </div>

            <div className="lesson-result">
              <div className="lesson-kicker"><BookOpenCheck size={16} /> SCIENCE OLYMPIAD · A&amp;P</div>
              <h3 className="lesson-title">{lesson.title}</h3>
              <p className="lesson-intro">{lesson.intro}</p>
              {lesson.introSourcePages && lesson.introSourcePages.length > 0 && (
                <div className="section-source-row intro-source-row">
                  <span className="source-label">IN YOUR PDF</span>
                  <PageCitations pages={lesson.introSourcePages} />
                </div>
              )}

              {lesson.insufficientInformation ? (
                <div className="insufficient-note" role="status">
                  <BookOpenCheck size={18} />
                  <p>The lesson stays within the source. A packet with more detail is needed to build out the teaching sections.</p>
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
                                    <Image src={snapshot.dataUrl} alt={`Uploaded PDF page ${pageNumber}`} width={snapshot.width} height={snapshot.height} unoptimized />
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
                      <Link className="button button-practice" href={`/study/${id}/flashcards`} onClick={() => void recordProgress({ event: "lesson" })}>
                        <RotateCcw size={18} /> Practice Flashcards <span className="card-count">{lesson.flashcards.length}</span>
                      </Link>
                    ) : (
                      <button className="button button-practice" type="button" disabled title="No source-supported flashcards could be made from this packet.">
                        <RotateCcw size={18} /> Practice Flashcards
                      </button>
                    )}
                    {lesson.quickTestQuestions.length === 5 ? (
                      <Link id="quick-test" className="button button-test" href={`/study/${id}/test`} onClick={() => void recordProgress({ event: "lesson" })}>
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
          </section>
        )}
      </div>
    </StudyShell>
  );
}
