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

export type LessonResult = {
  title: string;
  intro: string;
  sections: LessonSection[];
  rememberThis: string[];
  flashcards: StudyFlashcard[];
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

export function saveStudySession(lesson: LessonResult, mode: StudyMode = "lesson") {
  window.sessionStorage.setItem(STUDY_SESSION_STORAGE_KEY, JSON.stringify({ lesson, mode }));
  window.dispatchEvent(new Event(STUDY_SESSION_EVENT));
}

export function setStudySessionMode(mode: StudyMode) {
  const lesson = restoreStudySession(getStudySessionSnapshot());
  if (lesson) saveStudySession(lesson, mode);
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
    typeof value.insufficientInformation !== "boolean" || !Array.isArray(value.flashcards)
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

  return validSections && validFlashcards && value.rememberThis.every((point) => typeof point === "string");
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

export function getStudySessionMode(snapshot: string | null): StudyMode {
  if (!snapshot) return "lesson";
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return isRecord(parsed) && parsed.mode === "test" ? "test" : "lesson";
  } catch {
    return "lesson";
  }
}