export type KeyTerm = {
  term: string;
  definition: string;
};

export type LessonSection = {
  heading: string;
  paragraphs: string[];
  keyTerms: KeyTerm[];
  sourcePages: number[];
};

export type StudyFlashcard = {
  question: string;
  answer: string;
  sourcePages: number[];
};

export type QuickTestQuestion = {
  topic: string;
  concept: string;
  difficulty: "easy" | "medium" | "challenging";
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
  sourcePages: number[];
};

export type MissedQuestion = {
  question: string;
  selectedAnswer: string;
  correctAnswer: string;
  explanation: string;
  concept: string;
  sourcePages: number[];
};

export type QuizSessionResult = {
  topic: string;
  score: number;
  totalQuestions: number;
  correctAnswers: Array<{ question: string; answer: string; sourcePages: number[] }>;
  questionsToReview: string[];
  weakConcepts: string[];
  missedQuestions: MissedQuestion[];
};

export type LessonResult = {
  title: string;
  intro: string;
  sections: LessonSection[];
  rememberThis: string[];
  flashcards: StudyFlashcard[];
  quickTestQuestions: QuickTestQuestion[];
  insufficientInformation: boolean;
};

export type StudyMode = "lesson" | "test";

export const STUDY_SESSION_STORAGE_KEY = "pulse-notes-study-session";
const STUDY_SESSION_EVENT = "pulse-notes-study-session-change";

export function subscribeToStudySession(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(STUDY_SESSION_EVENT, onChange);
  return () => window.removeEventListener(STUDY_SESSION_EVENT, onChange);
}

export function getStudySessionSnapshot() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STUDY_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getServerStudySessionSnapshot() {
  return null;
}

export function saveStudySession(
  lesson: LessonResult,
  mode: StudyMode = "lesson",
  quizResult: QuizSessionResult | null = null,
) {
  window.sessionStorage.setItem(STUDY_SESSION_STORAGE_KEY, JSON.stringify({ lesson, mode, quizResult }));
  window.dispatchEvent(new Event(STUDY_SESSION_EVENT));
}

export function setStudySessionMode(mode: StudyMode) {
  const snapshot = getStudySessionSnapshot();
  const lesson = restoreStudySession(snapshot);
  if (lesson) saveStudySession(lesson, mode, restoreQuizResult(snapshot));
}

export function saveQuizResult(result: QuizSessionResult) {
  const snapshot = getStudySessionSnapshot();
  const lesson = restoreStudySession(snapshot);
  if (lesson) saveStudySession(lesson, "test", result);
}

export function clearStudySession() {
  try {
    window.sessionStorage.removeItem(STUDY_SESSION_STORAGE_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(STUDY_SESSION_EVENT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arePageNumbers(value: unknown) {
  return Array.isArray(value) && value.every(
    (pageNumber) => typeof pageNumber === "number" && Number.isInteger(pageNumber) && pageNumber > 0 && pageNumber <= 200,
  );
}

export function isLessonResult(value: unknown): value is LessonResult {
  if (
    !isRecord(value) || typeof value.title !== "string" || typeof value.intro !== "string" ||
    !Array.isArray(value.sections) || !Array.isArray(value.rememberThis) ||
    typeof value.insufficientInformation !== "boolean" || !Array.isArray(value.flashcards) ||
    !Array.isArray(value.quickTestQuestions)
  ) return false;

  const validSections = value.sections.every((section) => {
    if (
      !isRecord(section) || typeof section.heading !== "string" ||
      !Array.isArray(section.paragraphs) || !section.paragraphs.every((paragraph) => typeof paragraph === "string") ||
      !Array.isArray(section.keyTerms) || !arePageNumbers(section.sourcePages)
    ) return false;

    return section.keyTerms.every((keyTerm) =>
      isRecord(keyTerm) && typeof keyTerm.term === "string" && typeof keyTerm.definition === "string",
    );
  });
  const validFlashcards = value.flashcards.length <= 10 && value.flashcards.every((flashcard) =>
    isRecord(flashcard) && typeof flashcard.question === "string" && typeof flashcard.answer === "string" &&
    arePageNumbers(flashcard.sourcePages),
  );
  const validQuestions = value.quickTestQuestions.length <= 5 && value.quickTestQuestions.every((item) =>
    isRecord(item) && typeof item.topic === "string" && typeof item.concept === "string" &&
    (item.difficulty === "easy" || item.difficulty === "medium" || item.difficulty === "challenging") &&
    typeof item.question === "string" && Array.isArray(item.options) && item.options.length === 4 &&
    item.options.every((option) => typeof option === "string") && typeof item.correctAnswer === "number" &&
    Number.isInteger(item.correctAnswer) && item.correctAnswer >= 0 && item.correctAnswer < 4 &&
    typeof item.explanation === "string" && arePageNumbers(item.sourcePages),
  );

  return validSections && validFlashcards && validQuestions && value.rememberThis.every((point) => typeof point === "string");
}

export function isQuizSessionResult(value: unknown): value is QuizSessionResult {
  if (
    !isRecord(value) || typeof value.topic !== "string" || typeof value.score !== "number" ||
    typeof value.totalQuestions !== "number" || !Array.isArray(value.correctAnswers) ||
    !Array.isArray(value.questionsToReview) || !Array.isArray(value.weakConcepts) ||
    !Array.isArray(value.missedQuestions)
  ) return false;

  return value.correctAnswers.every((answer) =>
    isRecord(answer) && typeof answer.question === "string" && typeof answer.answer === "string" && arePageNumbers(answer.sourcePages),
  ) && value.questionsToReview.every((question) => typeof question === "string") &&
    value.weakConcepts.every((concept) => typeof concept === "string") &&
    value.missedQuestions.every((question) =>
      isRecord(question) && typeof question.question === "string" &&
      typeof question.selectedAnswer === "string" && typeof question.correctAnswer === "string" &&
      typeof question.explanation === "string" && typeof question.concept === "string" && arePageNumbers(question.sourcePages),
    );
}

export function restoreStudySession(snapshot: string | null) {
  if (!snapshot) return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (isLessonResult(parsed)) return parsed;
    return isRecord(parsed) && isLessonResult(parsed.lesson) ? parsed.lesson : null;
  } catch {
    return null;
  }
}

export function restoreQuizResult(snapshot: string | null) {
  if (!snapshot) return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return isRecord(parsed) && isQuizSessionResult(parsed.quizResult) ? parsed.quizResult : null;
  } catch {
    return null;
  }
}

export function getStudySessionMode(snapshot: string | null): StudyMode {
  if (!snapshot) return "lesson";
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return isRecord(parsed) && parsed.mode === "test" ? "test" : "lesson";
  } catch {
    return "lesson";
  }
}