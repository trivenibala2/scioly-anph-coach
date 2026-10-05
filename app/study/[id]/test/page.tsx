"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Check, RotateCcw, X } from "lucide-react";
import { StudyMessage, StudyShell } from "../../../components/StudyShell";
import type { QuizSessionResult } from "../../../study-session";
import { useStudy } from "../../../use-study";

const QUESTION_COUNT = 5;

function SourcePages({ pages }: { pages: number[] }) {
  return (
    <div className="lesson-citations" aria-label="Source pages">
      {pages.map((page) => <span className="citation-chip" key={page}>PDF · page {page}</span>)}
    </div>
  );
}

export default function TestPage() {
  const { id } = useParams<{ id: string }>();
  const { study, loading, error, recordProgress } = useStudy(id);
  const lesson = study?.lesson ?? null;
  const questions = lesson?.quickTestQuestions ?? [];
  const [result, setResult] = useState<QuizSessionResult | null>(null);
  const [answers, setAnswers] = useState<number[]>(new Array(QUESTION_COUNT).fill(-1));
  const [questionIndex, setQuestionIndex] = useState(0);
  const question = questions[questionIndex];
  const selectedAnswer = answers[questionIndex] ?? -1;
  const previous = study?.progress;

  function startOver() {
    setResult(null);
    setAnswers(new Array(QUESTION_COUNT).fill(-1));
    setQuestionIndex(0);
  }

  function completeTest() {
    if (!lesson || questions.length !== QUESTION_COUNT || answers.some((answer) => answer < 0)) return;

    const correctAnswers = questions.map((item) => ({
      question: item.question,
      answer: item.options[item.correctAnswer],
      sourcePages: item.sourcePages,
    }));
    const missedQuestions = questions.flatMap((item, index) => {
      const selectedOption = answers[index];
      if (selectedOption === item.correctAnswer) return [];
      return [{
        question: item.question,
        selectedAnswer: item.options[selectedOption],
        correctAnswer: item.options[item.correctAnswer],
        explanation: item.explanation,
        concept: item.concept,
        sourcePages: item.sourcePages,
      }];
    });
    const weakConcepts = [...new Set(missedQuestions.map((item) => item.concept))];
    const finished: QuizSessionResult = {
      topic: questions[0].topic || lesson.title,
      score: correctAnswers.length - missedQuestions.length,
      totalQuestions: questions.length,
      correctAnswers,
      questionsToReview: missedQuestions.map((item) => item.question),
      weakConcepts,
      missedQuestions,
    };

    setResult(finished);
    void recordProgress({ event: "test", score: finished.score, weakConcepts });
  }

  return (
    <StudyShell className="test-page">
      <div className="test-workspace">
        {loading ? (
          <StudyMessage title="Loading your Quick Test…" body="Restoring the saved questions." />
        ) : error || !lesson ? (
          <StudyMessage title="Quick Test not found" body={error || "This study could not be loaded."} href="/" cta="Back to weeks" />
        ) : questions.length !== QUESTION_COUNT ? (
          <StudyMessage title="Not enough test material" body="This packet couldn’t support five distinct questions with verified page sources." href={`/study/${id}/lesson`} cta="Back to lesson" />
        ) : result ? (
          <section className="test-summary" aria-labelledby="score-heading">
            <div className="test-summary-mark"><Check size={25} /></div>
            <div className="lesson-kicker">QUICK TEST COMPLETE</div>
            <h1 id="score-heading">Your Score</h1>
            <div className="score-display"><strong>{result.score}</strong><span>/ {result.totalQuestions}</span></div>
            <p className="test-topic">{result.topic}</p>

            <section className="test-summary-section" aria-labelledby="correct-answers-heading">
              <h2 id="correct-answers-heading">Correct answers</h2>
              <ol className="test-review-list">
                {result.correctAnswers.map((item, index) => (
                  <li key={`correct-${index}`}>
                    <strong>{item.question}</strong>
                    <p>{item.answer}</p>
                    <SourcePages pages={item.sourcePages} />
                  </li>
                ))}
              </ol>
            </section>

            <section className="test-summary-section" aria-labelledby="review-questions-heading">
              <h2 id="review-questions-heading">Questions to review</h2>
              {result.questionsToReview.length ? (
                <ol className="test-review-list">
                  {result.questionsToReview.map((item, index) => <li key={`review-${index}`}>{item}</li>)}
                </ol>
              ) : <p className="test-summary-muted">None; you got all five questions right.</p>}
            </section>

            <section className="test-summary-section" aria-labelledby="weak-concepts-heading">
              <h2 id="weak-concepts-heading">Concepts to practice</h2>
              {result.weakConcepts.length ? (
                <div className="weak-concept-list">
                  {result.weakConcepts.map((concept) => <span key={concept}>{concept}</span>)}
                </div>
              ) : <p className="test-summary-muted">No weak concepts found in this round.</p>}
            </section>

            {result.missedQuestions.length > 0 && (
              <section className="test-summary-section" aria-labelledby="missed-sources-heading">
                <h2 id="missed-sources-heading">Sources for missed questions</h2>
                <div className="missed-source-list">
                  {result.missedQuestions.map((item, index) => (
                    <article className="missed-source-item" key={`missed-${index}`}>
                      <strong>{item.concept}</strong>
                      <p>{item.question}</p>
                      <SourcePages pages={item.sourcePages} />
                    </article>
                  ))}
                </div>
              </section>
            )}

            <div className="test-summary-actions">
              <Link className="button button-practice" href={`/study/${id}/flashcards`}>Review Flashcards</Link>
              <Link className="button button-outline" href={`/study/${id}/lesson`}>Back to Lesson</Link>
              <button className="test-restart" type="button" onClick={startOver}><RotateCcw size={14} /> Retake Test</button>
            </div>
          </section>
        ) : question ? (
          <section className="quick-test" aria-labelledby="quick-test-heading">
            <div className="lesson-kicker">SCIENCE OLYMPIAD · A&amp;P</div>
            <h1 id="quick-test-heading">Quick Test</h1>
            <p className="test-topic">{lesson.title}</p>
            {previous?.testScore !== null && previous?.testScore !== undefined && questionIndex === 0 && selectedAnswer === -1 && (
              <p className="test-summary-muted">Last score: {previous.testScore}/5 · Best: {previous.bestTestScore ?? previous.testScore}/5</p>
            )}

            <div className="test-progress-labels">
              <span>Question {questionIndex + 1} of {QUESTION_COUNT}</span>
              <span className={`difficulty-tag difficulty-${question.difficulty}`}>{question.difficulty}</span>
            </div>
            <div className="test-progress-track" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={QUESTION_COUNT} aria-valuenow={questionIndex + 1}>
              <span style={{ width: `${((questionIndex + 1) / QUESTION_COUNT) * 100}%` }} />
            </div>

            <h2 className="quick-test-question">{question.question}</h2>
            <div className="quick-test-options">
              {question.options.map((option, optionIndex) => {
                const isSelected = selectedAnswer === optionIndex;
                const isCorrectOption = optionIndex === question.correctAnswer;
                const optionState = selectedAnswer === -1 ? "" : isCorrectOption ? "test-option-correct" : isSelected ? "test-option-wrong" : "";
                return (
                  <button
                    className={`quick-test-option ${optionState}`}
                    type="button"
                    key={`${questionIndex}-${optionIndex}`}
                    disabled={selectedAnswer !== -1}
                    aria-pressed={isSelected}
                    onClick={() => setAnswers((current) => current.map((answer, index) => index === questionIndex ? optionIndex : answer))}
                  >
                    <span>{String.fromCharCode(65 + optionIndex)}</span>
                    <strong>{option}</strong>
                    {selectedAnswer !== -1 && isCorrectOption && <Check size={17} aria-hidden="true" />}
                    {selectedAnswer !== -1 && isSelected && !isCorrectOption && <X size={17} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>

            {selectedAnswer !== -1 && (
              <div className={`quick-test-feedback ${selectedAnswer === question.correctAnswer ? "feedback-correct" : "feedback-wrong"}`} role={selectedAnswer === question.correctAnswer ? "status" : "alert"}>
                <strong>{selectedAnswer === question.correctAnswer ? "Correct!" : "Not quite."}</strong>
                {selectedAnswer !== question.correctAnswer && <p className="test-correct-answer">Correct answer: {question.options[question.correctAnswer]}</p>}
                <p>{question.explanation}</p>
                <SourcePages pages={question.sourcePages} />
              </div>
            )}

            <div className="quick-test-footer">
              <Link className="test-inline-back" href={`/study/${id}/lesson`}>Back to Lesson</Link>
              {selectedAnswer !== -1 && (
                <button
                  className="button button-test"
                  type="button"
                  onClick={() => questionIndex === QUESTION_COUNT - 1 ? completeTest() : setQuestionIndex((index) => index + 1)}
                >
                  {questionIndex === QUESTION_COUNT - 1 ? "See Your Score" : "Next Question"}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </StudyShell>
  );
}