"use client";

import { useState } from "react";
import Image from "next/image";
import {
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  Check,
  RotateCcw,
  Image as ImageIcon,
  Sparkles,
  Brain,
  ClipboardCheck,
  FileText,
  ZoomIn,
  X,
} from "lucide-react";
import type { LessonResult, StudyFlashcard, QuickTestQuestion, SourcePageText } from "../study-session";
import type { PageSnapshot } from "../pdf-snapshots";

type PaginatedLessonProps = {
  lesson: LessonResult;
  weekNumber: number;
  fileName: string;
  pdfUrl: string | null;
  pageSnapshots: PageSnapshot[];
  pages: SourcePageText[];
  onComplete: () => void;
  onNavigateToFlashcards: () => void;
  onNavigateToTest: () => void;
  isCompleted: boolean;
};

type SectionView = "content" | "flashcards" | "test";

function PageCitations({ pages }: { pages: number[] }) {
  return (
    <div className="lesson-citations" aria-label="Source pages">
      {pages.map((pageNumber) => (
        <span className="citation-chip" key={pageNumber}>
          PDF · page {pageNumber}
        </span>
      ))}
    </div>
  );
}

function HighlightedParagraph({
  text,
  terms,
}: {
  text: string;
  terms: Array<{ term: string; definition: string }>;
}) {
  const sortedTerms = [...terms]
    .filter((item) => item.term.trim())
    .sort((first, second) => second.term.length - first.term.length);
  if (!sortedTerms.length) return <p>{text}</p>;

  const expression = new RegExp(
    `(${sortedTerms.map(({ term }) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );
  return (
    <p>
      {text.split(expression).map((part, index) => {
        const term = sortedTerms.find((item) => item.term.toLowerCase() === part.toLowerCase());
        return term ? (
          <mark key={`${part}-${index}`} title={term.definition}>
            {part}
          </mark>
        ) : (
          part
        );
      })}
    </p>
  );
}

function SectionFlashcards({ flashcards }: { flashcards: StudyFlashcard[] }) {
  const [currentCard, setCurrentCard] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());

  const card = flashcards[currentCard];

  const handleNext = () => {
    if (currentCard < flashcards.length - 1) {
      setCurrentCard(currentCard + 1);
      setFlipped(false);
    }
  };

  const handlePrevious = () => {
    if (currentCard > 0) {
      setCurrentCard(currentCard - 1);
      setFlipped(false);
    }
  };

  const markKnown = (isKnown: boolean) => {
    const newKnown = new Set(known);
    if (isKnown) {
      newKnown.add(currentCard);
    } else {
      newKnown.delete(currentCard);
    }
    setKnown(newKnown);
    handleNext();
  };

  return (
    <div className="section-flashcards">
      <div className="flashcard-progress">
        Card {currentCard + 1} of {flashcards.length} · {known.size} known
      </div>
      <div className={`flashcard ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)}>
        {!flipped ? (
          <div className="flashcard-front">
            <div className="flashcard-label">Question</div>
            <div className="flashcard-text">{card.question}</div>
          </div>
        ) : (
          <div className="flashcard-back">
            <div className="flashcard-label">Answer</div>
            <div className="flashcard-text">{card.answer}</div>
            <PageCitations pages={card.sourcePages} />
          </div>
        )}
      </div>
      {flipped && (
        <div className="flashcard-actions">
          <button className="button button-secondary" onClick={() => markKnown(false)}>
            Review Again
          </button>
          <button className="button button-primary" onClick={() => markKnown(true)}>
            I Know This
          </button>
        </div>
      )}
      <div className="flashcard-nav">
        <button className="button button-sm" onClick={handlePrevious} disabled={currentCard === 0}>
          <ChevronLeft size={16} /> Previous
        </button>
        <button className="button button-sm" onClick={() => setFlipped(!flipped)}>
          {flipped ? "Show Question" : "Show Answer"}
        </button>
        <button
          className="button button-sm"
          onClick={handleNext}
          disabled={currentCard === flashcards.length - 1}
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function SectionTest({ questions }: { questions: QuickTestQuestion[] }) {
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number>>(new Map());
  const [showResults, setShowResults] = useState(false);

  const question = questions[currentQ];
  const selectedAnswer = answers.get(currentQ);

  const handleAnswer = (optionIndex: number) => {
    const newAnswers = new Map(answers);
    newAnswers.set(currentQ, optionIndex);
    setAnswers(newAnswers);
  };

  const handleNext = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      setShowResults(true);
    }
  };

  const handlePrevious = () => {
    if (currentQ > 0) setCurrentQ(currentQ - 1);
  };

  const score = Array.from(answers.entries()).filter(
    ([qIndex, answer]) => answer === questions[qIndex].correctAnswer
  ).length;

  if (showResults) {
    return (
      <div className="section-test-results">
        <h4>
          Section Quiz Results: {score}/{questions.length}
        </h4>
        <div className="test-summary">
          {questions.map((q, index) => {
            const userAnswer = answers.get(index);
            const isCorrect = userAnswer === q.correctAnswer;
            return (
              <div key={index} className={`test-result-item ${isCorrect ? "correct" : "incorrect"}`}>
                <div className="result-header">
                  <span className="result-icon">{isCorrect ? <Check size={16} /> : <X size={16} />}</span>
                  <span className="result-label">Question {index + 1}</span>
                </div>
                <p className="result-question">{q.question}</p>
                {!isCorrect && (
                  <>
                    <p className="result-your-answer">
                      Your answer: {userAnswer !== undefined ? q.options[userAnswer] : "Not answered"}
                    </p>
                    <p className="result-correct-answer">Correct: {q.options[q.correctAnswer]}</p>
                  </>
                )}
                <p className="result-explanation">{q.explanation}</p>
                <PageCitations pages={q.sourcePages} />
              </div>
            );
          })}
        </div>
        <button
          className="button button-primary"
          onClick={() => {
            setCurrentQ(0);
            setAnswers(new Map());
            setShowResults(false);
          }}
        >
          Retry Quiz
        </button>
      </div>
    );
  }

  return (
    <div className="section-test">
      <div className="test-progress">
        Question {currentQ + 1} of {questions.length}
      </div>
      <div className="test-question-card">
        <div className="test-concept">
          <span className="concept-tag">{question.topic}</span>
          <span className="difficulty-tag">{question.difficulty}</span>
        </div>
        <h4>{question.question}</h4>
        <div className="test-options">
          {question.options.map((option, index) => (
            <button
              key={index}
              className={`test-option ${selectedAnswer === index ? "selected" : ""}`}
              onClick={() => handleAnswer(index)}
            >
              <span className="option-letter">{String.fromCharCode(65 + index)}</span>
              <span className="option-text">{option}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="test-nav">
        <button className="button button-secondary" onClick={handlePrevious} disabled={currentQ === 0}>
          <ChevronLeft size={16} /> Previous
        </button>
        <button
          className="button button-primary"
          onClick={handleNext}
          disabled={selectedAnswer === undefined}
        >
          {currentQ < questions.length - 1 ? (
            <>
              Next <ChevronRight size={16} />
            </>
          ) : (
            <>
              Submit <Check size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export function PaginatedLesson({
  lesson,
  weekNumber,
  fileName,
  pdfUrl,
  pageSnapshots,
  pages,
  onComplete,
  onNavigateToFlashcards,
  onNavigateToTest,
  isCompleted,
}: PaginatedLessonProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [sectionView, setSectionView] = useState<SectionView>("content");
  const [zoomedPage, setZoomedPage] = useState<PageSnapshot | null>(null);

  // Total pages: intro + sections + summary (Remember This)
  const totalPages = 1 + lesson.sections.length + (lesson.rememberThis.length > 0 ? 1 : 0);
  const isIntroPage = currentPage === 0;
  const isSummaryPage = currentPage === totalPages - 1 && lesson.rememberThis.length > 0;
  const currentSection = !isIntroPage && !isSummaryPage ? lesson.sections[currentPage - 1] : null;

  // Each module names the packet pages that hold its most useful diagrams. We render those actual
  // (persisted) PDF pages first, then the module's other cited pages.
  const diagramPagesFor = (section: LessonResult["sections"][number]) => {
    const fromVisuals = (section.visuals ?? []).flatMap((visual) => visual.sourcePages);
    return [...new Set([...fromVisuals, ...section.sourcePages])];
  };

  // The exact extracted text of a module's pages, so students can read the full source
  // for that module without opening the PDF.
  const sourceTextFor = (section: LessonResult["sections"][number]) =>
    section.sourcePages
      .map((pageNumber) => pages.find((page) => page.pageNumber === pageNumber))
      .filter((page): page is SourcePageText => Boolean(page?.text));

  const handleNext = () => {
    if (sectionView !== "content") {
      setSectionView("content");
    } else if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (!isCompleted) {
      onComplete();
    }
  };

  const handlePrevious = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
      setSectionView("content");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="paginated-lesson">
      <div className="lesson-topline">
        <div className="step-index step-index-teal">W{weekNumber}</div>
        <div className="lesson-heading-copy">
          <h2>Week {weekNumber} lesson</h2>
          <p>Built from {fileName || "the uploaded PDF"}.</p>
        </div>
        <div className="lesson-topline-actions">
          {pdfUrl && (
            <a className="view-pdf-link" href={pdfUrl} target="_blank" rel="noopener noreferrer">
              <FileText size={14} /> View original PDF
            </a>
          )}
          <span className="ready-badge">
            <span /> {isCompleted ? "LESSON DONE" : "READY"}
          </span>
        </div>
      </div>

      <div className="lesson-progress-bar">
        <div className="progress-fill" style={{ width: `${((currentPage + 1) / totalPages) * 100}%` }} />
      </div>

      <div className="lesson-result">
        <div className="lesson-kicker">
          <BookOpenCheck size={16} /> SCIENCE OLYMPIAD · A&amp;P
        </div>
        <h3 className="lesson-title">{lesson.title}</h3>

        {isIntroPage && (
          <div className="lesson-intro-page">
            <p className="lesson-intro">{lesson.intro}</p>
            {lesson.introSourcePages && lesson.introSourcePages.length > 0 && (
              <div className="section-source-row intro-source-row">
                <span className="source-label">IN YOUR PDF</span>
                <PageCitations pages={lesson.introSourcePages} />
              </div>
            )}
            <div className="intro-toc">
              <h4>What you&apos;ll learn ({lesson.sections.length} modules):</h4>
              <ol>
                {lesson.sections.map((section, index) => (
                  <li key={index}>
                    <button onClick={() => setCurrentPage(index + 1)} className="toc-link">
                      {section.heading}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {currentSection && sectionView === "content" && (
          <article className="teaching-section">
            <div className="teaching-section-heading">
              <span>{String(currentPage).padStart(2, "0")}</span>
              <h4>{currentSection.heading}</h4>
            </div>

            {diagramPagesFor(currentSection).some((pageNumber) =>
              pageSnapshots.some((snapshot) => snapshot.pageNumber === pageNumber)
            ) && (
              <div className="source-visuals source-visuals-lead">
                <div className="visual-heading">
                  <ImageIcon size={14} /> Diagrams from your packet <span className="zoom-hint">· tap to zoom</span>
                </div>
                <div className="visual-grid">
                  {diagramPagesFor(currentSection)
                    .slice(0, 2)
                    .map((pageNumber) => {
                      const snapshot = pageSnapshots.find((item) => item.pageNumber === pageNumber);
                      return snapshot ? (
                        <figure className="source-visual" key={pageNumber}>
                          <button
                            type="button"
                            className="source-visual-button"
                            onClick={() => setZoomedPage(snapshot)}
                            aria-label={`Zoom in on PDF page ${pageNumber}`}
                          >
                            <Image
                              src={snapshot.dataUrl}
                              alt={`Uploaded PDF page ${pageNumber}`}
                              width={snapshot.width}
                              height={snapshot.height}
                              unoptimized
                            />
                            <span className="source-visual-zoom"><ZoomIn size={16} /></span>
                          </button>
                          <figcaption>PDF page {pageNumber}</figcaption>
                        </figure>
                      ) : null;
                    })}
                </div>
              </div>
            )}

            <div className="teaching-copy">
              {currentSection.paragraphs.map((paragraph, paragraphIndex) => (
                <HighlightedParagraph
                  key={paragraphIndex}
                  text={paragraph}
                  terms={currentSection.keyTerms}
                />
              ))}
            </div>

            {currentSection.keyTerms.length > 0 && (
              <dl className="key-term-list">
                {currentSection.keyTerms.map((keyTerm, idx) => (
                  <div className="key-term" key={idx}>
                    <dt>{keyTerm.term}</dt>
                    <dd>{keyTerm.definition}</dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="section-source-row">
              <span className="source-label">IN YOUR PDF</span>
              <PageCitations pages={currentSection.sourcePages} />
            </div>

            {sourceTextFor(currentSection).length > 0 && (
              <details className="source-text-panel">
                <summary>Show the full packet text for these pages</summary>
                <div className="source-text-body">
                  {sourceTextFor(currentSection).map((page) => (
                    <div className="source-text-page" key={page.pageNumber}>
                      <div className="source-text-page-label">PDF page {page.pageNumber}</div>
                      <p>{page.text}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}

            <div className="section-practice-actions">
              {currentSection.flashcards.length > 0 && (
                <button
                  className="button button-practice"
                  onClick={() => setSectionView("flashcards")}
                >
                  <Brain size={18} /> Practice ({currentSection.flashcards.length} cards)
                </button>
              )}
              {currentSection.testQuestions.length > 0 && (
                <button className="button button-test" onClick={() => setSectionView("test")}>
                  <ClipboardCheck size={18} /> Quick Quiz ({currentSection.testQuestions.length}{" "}
                  questions)
                </button>
              )}
            </div>
          </article>
        )}

        {currentSection && sectionView === "flashcards" && (
          <div className="section-practice-view">
            <div className="practice-header">
              <h4>
                <Brain size={20} /> Practice: {currentSection.heading}
              </h4>
              <button className="button button-sm" onClick={() => setSectionView("content")}>
                Back to Lesson
              </button>
            </div>
            <SectionFlashcards flashcards={currentSection.flashcards} />
          </div>
        )}

        {currentSection && sectionView === "test" && (
          <div className="section-practice-view">
            <div className="practice-header">
              <h4>
                <ClipboardCheck size={20} /> Quick Quiz: {currentSection.heading}
              </h4>
              <button className="button button-sm" onClick={() => setSectionView("content")}>
                Back to Lesson
              </button>
            </div>
            <SectionTest questions={currentSection.testQuestions} />
          </div>
        )}

        {isSummaryPage && (
          <section className="remember-panel" aria-labelledby="remember-heading">
            <div className="remember-kicker">
              <Sparkles size={15} /> TAKE THIS WITH YOU
            </div>
            <h4 id="remember-heading">Remember This</h4>
            <ul>
              {lesson.rememberThis.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>

            <div className="lesson-actions">
              {lesson.flashcards.length > 0 ? (
                <button className="button button-practice" onClick={onNavigateToFlashcards}>
                  <RotateCcw size={18} /> All Flashcards{" "}
                  <span className="card-count">{lesson.flashcards.length}</span>
                </button>
              ) : (
                <button
                  className="button button-practice"
                  type="button"
                  disabled
                  title="No source-supported flashcards could be made from this packet."
                >
                  <RotateCcw size={18} /> All Flashcards
                </button>
              )}
              {lesson.quickTestQuestions.length === 5 ? (
                <button className="button button-test" onClick={onNavigateToTest}>
                  <Check size={18} /> Final Test
                </button>
              ) : (
                <button
                  className="button button-test"
                  type="button"
                  disabled
                  title="This packet does not support five distinct cited questions."
                >
                  <Check size={18} /> Final Test
                </button>
              )}
            </div>
          </section>
        )}

        <div className="lesson-nav-controls">
          <button className="button button-nav" onClick={handlePrevious} disabled={currentPage === 0}>
            <ChevronLeft size={18} /> Previous
          </button>
          <div className="lesson-page-indicator">
            {sectionView === "content"
              ? `Module ${currentPage + 1} of ${totalPages}`
              : sectionView === "flashcards"
              ? "Practice Cards"
              : "Quick Quiz"}
          </div>
          <button className="button button-nav button-primary" onClick={handleNext}>
            {sectionView !== "content" ? (
              <>
                Back to Module <ChevronRight size={18} />
              </>
            ) : currentPage < totalPages - 1 ? (
              <>
                Next Module <ChevronRight size={18} />
              </>
            ) : (
              <>
                Complete <Check size={18} />
              </>
            )}
          </button>
        </div>
      </div>

      {zoomedPage && (
        <div
          className="diagram-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`PDF page ${zoomedPage.pageNumber}, enlarged`}
          onClick={() => setZoomedPage(null)}
        >
          <button className="diagram-lightbox-close" type="button" onClick={() => setZoomedPage(null)} aria-label="Close">
            <X size={22} />
          </button>
          <figure className="diagram-lightbox-figure" onClick={(event) => event.stopPropagation()}>
            <Image
              src={zoomedPage.dataUrl}
              alt={`Uploaded PDF page ${zoomedPage.pageNumber}, enlarged`}
              width={zoomedPage.width}
              height={zoomedPage.height}
              unoptimized
            />
            <figcaption>PDF page {zoomedPage.pageNumber}</figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
