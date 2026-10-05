export type KeyTerm = {
  term: string;
  definition: string;
};

export type LessonVisual = {
  title: string;
  purpose: string;
  visualPrompt: string;
  sourcePages: number[];
  sourceQuotes: string[];
  type: "anatomy_diagram" | "concept_diagram" | "process_diagram";
  imageUrl?: string;
};

export type LessonSection = {
  heading: string;
  paragraphs: string[];
  keyTerms: KeyTerm[];
  sourcePages: number[];
  visuals?: LessonVisual[];
  flashcards: StudyFlashcard[];
  testQuestions: QuickTestQuestion[];
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
  introSourcePages?: number[];
  sections: LessonSection[];
  rememberThis: string[];
  flashcards: StudyFlashcard[];
  quickTestQuestions: QuickTestQuestion[];
  visuals?: LessonVisual[];
  insufficientInformation: boolean;
};

export type StudyProgress = {
  lessonCompletedAt: string | null;
  flashcardsCompletedAt: string | null;
  flashcardsKnown: number | null;
  flashcardsReview: number | null;
  testSubmittedAt: string | null;
  testScore: number | null;
  bestTestScore: number | null;
  testAttempts: number;
  weakConcepts: string[];
  completedAt: string | null;
};

export type StudyPackage = {
  id: string;
  weekNumber: number;
  title: string;
  fileName: string;
  status: string;
  pdfUrl: string | null;
  lesson: LessonResult;
  progress: StudyProgress | null;
};

// sessionStorage is only an offline convenience copy. Supabase is the source of truth.
const CACHE_PREFIX = "scienceoly-study-";

export function cacheStudy(study: StudyPackage) {
  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${study.id}`, JSON.stringify(study));
  } catch {
    /* ignore quota/private-mode errors */
  }
}

export function readCachedStudy(id: string): StudyPackage | null {
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${id}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && isLessonResult(parsed.lesson) ? (parsed as StudyPackage) : null;
  } catch {
    return null;
  }
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
      !Array.isArray(section.keyTerms) || !arePageNumbers(section.sourcePages) ||
      !Array.isArray(section.flashcards) || !Array.isArray(section.testQuestions)
    ) return false;

    const validKeyTerms = section.keyTerms.every((keyTerm) =>
      isRecord(keyTerm) && typeof keyTerm.term === "string" && typeof keyTerm.definition === "string"
    );

    const validSectionFlashcards = section.flashcards.every((flashcard: unknown) =>
      isRecord(flashcard) && typeof flashcard.question === "string" && typeof flashcard.answer === "string" &&
      arePageNumbers(flashcard.sourcePages)
    );

    const validSectionTests = section.testQuestions.every((item: unknown) =>
      isRecord(item) && typeof item.topic === "string" && typeof item.concept === "string" &&
      (item.difficulty === "easy" || item.difficulty === "medium" || item.difficulty === "challenging") &&
      typeof item.question === "string" && Array.isArray(item.options) && item.options.length === 4 &&
      (item.options as unknown[]).every((option) => typeof option === "string") && typeof item.correctAnswer === "number" &&
      Number.isInteger(item.correctAnswer) && item.correctAnswer >= 0 && (item.correctAnswer as number) < 4 &&
      typeof item.explanation === "string" && arePageNumbers(item.sourcePages)
    );

    return validKeyTerms && validSectionFlashcards && validSectionTests;
  });
  const validFlashcards = value.flashcards.length <= 10 && value.flashcards.every((flashcard) =>
    isRecord(flashcard) && typeof flashcard.question === "string" && typeof flashcard.answer === "string" &&
    arePageNumbers(flashcard.sourcePages),
  );
  const validQuestions = (value.quickTestQuestions.length === 0 || value.quickTestQuestions.length === 5) && value.quickTestQuestions.every((item) =>
    isRecord(item) && typeof item.topic === "string" && typeof item.concept === "string" &&
    (item.difficulty === "easy" || item.difficulty === "medium" || item.difficulty === "challenging") &&
    typeof item.question === "string" && Array.isArray(item.options) && item.options.length === 4 &&
    item.options.every((option) => typeof option === "string") && typeof item.correctAnswer === "number" &&
    Number.isInteger(item.correctAnswer) && item.correctAnswer >= 0 && item.correctAnswer < 4 &&
    typeof item.explanation === "string" && arePageNumbers(item.sourcePages),
  );

  const validIntroPages = value.introSourcePages === undefined || arePageNumbers(value.introSourcePages);

  return validIntroPages && validSections && validFlashcards && validQuestions && value.rememberThis.every((point) => typeof point === "string");
}

export function isQuizSessionResult(value: unknown): value is QuizSessionResult {
  if (
    !isRecord(value) || typeof value.topic !== "string" || typeof value.score !== "number" ||
    !Number.isInteger(value.score) || value.score < 0 || value.score > 5 || value.totalQuestions !== 5 ||
    !Array.isArray(value.correctAnswers) || value.correctAnswers.length !== 5 ||
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
