"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, RotateCcw } from "lucide-react";
import { StudyMessage, StudyShell } from "../../../components/StudyShell";
import { useStudy } from "../../../use-study";

type CardRating = "known" | "review" | null;

export default function FlashcardsPage() {
  const { id } = useParams<{ id: string }>();
  const { study, loading, error, recordProgress } = useStudy(id);
  const lesson = study?.lesson ?? null;
  const [ratings, setRatings] = useState<CardRating[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const cards = lesson?.flashcards ?? [];
  const card = cards[currentIndex];
  const currentRatings = cards.map((_, index) => ratings[index] ?? null);
  const reviewedCount = currentRatings.filter((rating) => rating !== null).length;
  const knownCount = currentRatings.filter((rating) => rating === "known").length;
  const reviewCount = currentRatings.filter((rating) => rating === "review").length;

  function moveTo(index: number) {
    setCurrentIndex(Math.max(0, Math.min(cards.length - 1, index)));
    setIsFlipped(false);
  }

  function rateCard(rating: Exclude<CardRating, null>) {
    const nextRatings = currentRatings.map((currentRating, index) => index === currentIndex ? rating : currentRating);
    setRatings(nextRatings);
    setIsFlipped(false);

    const nextUnratedIndex = nextRatings.findIndex((currentRating, index) => currentRating === null && index !== currentIndex);
    if (nextUnratedIndex === -1) {
      const finished = nextRatings.every((currentRating) => currentRating !== null);
      setIsComplete(finished);
      if (finished) {
        void recordProgress({
          event: "flashcards",
          known: nextRatings.filter((item) => item === "known").length,
          review: nextRatings.filter((item) => item === "review").length,
        });
      }
      return;
    }

    const laterUnratedIndex = nextRatings.findIndex((currentRating, index) => index > currentIndex && currentRating === null);
    moveTo(laterUnratedIndex === -1 ? nextUnratedIndex : laterUnratedIndex);
  }

  function restartSession() {
    setRatings(new Array(cards.length).fill(null));
    setCurrentIndex(0);
    setIsFlipped(false);
    setIsComplete(false);
  }

  return (
    <StudyShell className="flashcards-page">
      <div className="flashcards-workspace">
        {loading ? (
          <StudyMessage title="Loading your flashcards…" body="Restoring the saved deck." />
        ) : error || !lesson ? (
          <StudyMessage title="Flashcards not found" body={error || "This study could not be loaded."} href="/" cta="Back to weeks" />
        ) : cards.length === 0 ? (
          <StudyMessage title="No flashcards for this week" body="This packet couldn’t support source-cited flashcards." href={`/study/${id}/lesson`} cta="Back to lesson" />
        ) : isComplete ? (
          <section className="flashcards-complete" aria-labelledby="complete-heading">
            <div className="complete-mark"><Check size={25} /></div>
            <div className="lesson-kicker">STUDY SESSION FINISHED</div>
            <h1 id="complete-heading">Flashcards Complete!</h1>
            <p className="complete-topic">{lesson.title}</p>

            <div className="completion-stats">
              <div><strong>{reviewedCount}</strong><span>Cards reviewed</span></div>
              <div><strong>{knownCount}</strong><span>Cards known</span></div>
              <div><strong>{reviewCount}</strong><span>Cards needing review</span></div>
            </div>

            <div className="completion-actions">
              <Link className="button button-test" href={`/study/${id}/test`}>
                Take Quick Test <ArrowRight size={17} />
              </Link>
              <Link className="button button-outline" href={`/study/${id}/lesson`}>
                Back to Lesson
              </Link>
              <button className="restart-session" type="button" onClick={restartSession}>
                <RotateCcw size={14} /> Review cards again
              </button>
            </div>
          </section>
        ) : card ? (
          <section className="flashcard-study" aria-labelledby="flashcards-heading">
            <div className="flashcards-heading-row">
              <div>
                <div className="lesson-kicker">SCIENCE OLYMPIAD · A&amp;P</div>
                <h1 id="flashcards-heading">Flashcards</h1>
                <p className="flashcards-topic">{lesson.title}</p>
              </div>
              <span className="flashcard-session-count">{cards.length} CARDS</span>
            </div>

            <div className="flashcard-progress-row">
              <span>Card {currentIndex + 1} of {cards.length}</span>
              <span>{reviewedCount} reviewed</span>
            </div>
            <div
              className="flashcard-progress-track"
              role="progressbar"
              aria-label="Flashcard progress"
              aria-valuemin={0}
              aria-valuemax={cards.length}
              aria-valuenow={reviewedCount}
            >
              <span style={{ width: `${(reviewedCount / cards.length) * 100}%` }} />
            </div>

            <div className="flashcard-stage">
              <button
                className="flip-card"
                type="button"
                onClick={() => setIsFlipped((flipped) => !flipped)}
                aria-label={isFlipped ? "Show flashcard question" : "Show flashcard answer"}
                aria-pressed={isFlipped}
              >
                <span className={`flip-card-inner ${isFlipped ? "flip-card-turned" : ""}`}>
                  <span className="flip-card-face flip-card-question">
                    <span className="flip-card-label">QUESTION</span>
                    <strong>{card.question}</strong>
                    <span className="flip-card-corner">Q</span>
                  </span>
                  <span className="flip-card-face flip-card-answer">
                    <span className="flip-card-label">ANSWER</span>
                    <strong>{card.answer}</strong>
                    <span className="flip-card-corner">A</span>
                  </span>
                </span>
              </button>
              <div className="flashcard-source-label">SOURCE PAGES</div>
              <div className="lesson-citations flashcard-citations">
                {card.sourcePages.map((pageNumber) => (
                  <span className="citation-chip" key={pageNumber}>PDF · page {pageNumber}</span>
                ))}
              </div>
            </div>

            {currentRatings[currentIndex] && (
              <div className={`card-rating-note ${currentRatings[currentIndex] === "known" ? "rating-known" : "rating-review"}`}>
                {currentRatings[currentIndex] === "known" ? "Marked as known" : "Added to review"}
              </div>
            )}

            <div className="flashcard-ratings">
              <button className="button button-review" type="button" onClick={() => rateCard("review")}>
                <RotateCcw size={17} /> Review Again
              </button>
              <button className="button button-know" type="button" onClick={() => rateCard("known")}>
                <Check size={17} /> I Know This
              </button>
            </div>

            <div className="flashcard-navigation">
              <button className="button button-outline" type="button" onClick={() => moveTo(currentIndex - 1)} disabled={currentIndex === 0}>
                <ArrowLeft size={16} /> Previous
              </button>
              <button className="button button-outline" type="button" onClick={() => moveTo(currentIndex + 1)} disabled={currentIndex === cards.length - 1}>
                Next <ArrowRight size={16} />
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </StudyShell>
  );
}