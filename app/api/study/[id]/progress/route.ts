import { requireAccount } from "../../../../../lib/auth";
import { PROGRESS_COLUMNS, toProgress, type ProgressRow } from "../../../../../lib/progress";
import { getSupabaseAdmin, isUuid } from "../../../../../lib/supabase/server";

type Context = { params: Promise<{ id: string }> };

function count(value: unknown, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

// Students record their own progress. Admin previews are not tracked.
export async function POST(request: Request, { params }: Context) {
  const account = requireAccount(request);
  if (!account) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (account.role !== "student") return Response.json({ ok: true, tracked: false });

  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Study not found." }, { status: 404 });

  let body: { event?: unknown; known?: unknown; review?: unknown; score?: unknown; weakConcepts?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The progress update was not valid." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [{ data: existing, error: existingError }, deck, test] = await Promise.all([
      supabase.from("student_week_progress").select(PROGRESS_COLUMNS).eq("study_week_id", id).eq("student_username", account.username).maybeSingle(),
      supabase.from("flashcard_decks").select("content").eq("study_week_id", id).maybeSingle(),
      supabase.from("tests").select("content").eq("study_week_id", id).maybeSingle(),
    ]);
    if (existingError) throw existingError;
    if (!deck.data && !test.data) return Response.json({ error: "Study not found." }, { status: 404 });

    const row = (existing ?? null) as ProgressRow | null;
    const now = new Date().toISOString();
    const update: Record<string, unknown> = { last_activity_at: now, updated_at: now };
    const next = {
      lesson: row?.lesson_completed_at ?? null,
      flashcards: row?.flashcards_completed_at ?? null,
      test: row?.test_submitted_at ?? null,
    };

    if (body.event === "lesson") {
      next.lesson = next.lesson ?? now;
      update.lesson_completed_at = next.lesson;
    } else if (body.event === "flashcards") {
      next.flashcards = now;
      update.flashcards_completed_at = now;
      update.flashcards_known = count(body.known, 10);
      update.flashcards_review = count(body.review, 10);
    } else if (body.event === "test") {
      const score = count(body.score, 5);
      if (score === null) return Response.json({ error: "The test score was not valid." }, { status: 400 });
      next.test = now;
      update.test_submitted_at = now;
      update.test_score = score;
      update.best_test_score = Math.max(score, row?.best_test_score ?? 0);
      update.test_attempts = (row?.test_attempts ?? 0) + 1;
      update.weak_concepts = Array.isArray(body.weakConcepts)
        ? body.weakConcepts.filter((item): item is string => typeof item === "string").slice(0, 10)
        : [];
    } else {
      return Response.json({ error: "Unknown progress event." }, { status: 400 });
    }

    const deckCards = (deck.data?.content as { cards?: unknown[] } | undefined)?.cards;
    const testQuestions = (test.data?.content as { questions?: unknown[] } | undefined)?.questions;
    const needsFlashcards = Array.isArray(deckCards) && deckCards.length > 0;
    const needsTest = Array.isArray(testQuestions) && testQuestions.length > 0;
    const complete = Boolean(next.lesson && (!needsFlashcards || next.flashcards) && (!needsTest || next.test));
    update.completed_at = complete ? (row?.completed_at ?? now) : null;

    const { data: saved, error } = await supabase
      .from("student_week_progress")
      .upsert(
        { student_username: account.username, study_week_id: id, ...update },
        { onConflict: "student_username,study_week_id" },
      )
      .select(PROGRESS_COLUMNS)
      .single();
    if (error) throw error;

    return Response.json({ ok: true, tracked: true, progress: toProgress(saved as ProgressRow) });
  } catch (error) {
    console.error("Failed to save progress:", error);
    return Response.json({ error: "We couldn’t save your progress." }, { status: 500 });
  }
}
