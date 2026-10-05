import "server-only";

import type { StudyProgress } from "../app/study-session";

export type ProgressRow = {
  student_username: string;
  study_week_id: string;
  lesson_completed_at: string | null;
  flashcards_completed_at: string | null;
  flashcards_known: number | null;
  flashcards_review: number | null;
  test_submitted_at: string | null;
  test_score: number | null;
  best_test_score: number | null;
  test_attempts: number | null;
  weak_concepts: unknown;
  completed_at: string | null;
  last_activity_at: string | null;
};

export const PROGRESS_COLUMNS =
  "student_username, study_week_id, lesson_completed_at, flashcards_completed_at, flashcards_known, flashcards_review, test_submitted_at, test_score, best_test_score, test_attempts, weak_concepts, completed_at, last_activity_at";

export function toProgress(row: ProgressRow | null | undefined): StudyProgress | null {
  if (!row) return null;
  return {
    lessonCompletedAt: row.lesson_completed_at,
    flashcardsCompletedAt: row.flashcards_completed_at,
    flashcardsKnown: row.flashcards_known,
    flashcardsReview: row.flashcards_review,
    testSubmittedAt: row.test_submitted_at,
    testScore: row.test_score,
    bestTestScore: row.best_test_score,
    testAttempts: row.test_attempts ?? 0,
    weakConcepts: Array.isArray(row.weak_concepts) ? row.weak_concepts.filter((item): item is string => typeof item === "string") : [],
    completedAt: row.completed_at,
  };
}
