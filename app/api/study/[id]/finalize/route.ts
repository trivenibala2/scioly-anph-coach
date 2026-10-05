import { requireAccount } from "../../../../../lib/auth";
import { getSupabaseAdmin, isUuid } from "../../../../../lib/supabase/server";
import { isLessonResult } from "../../../../study-session";

type Context = { params: Promise<{ id: string }> };

// Admin only: attach a generated lesson to an already-persisted study (uploaded PDF).
// Splitting upload from generation means a slow or failed Gemini call never loses the PDF.
export async function POST(request: Request, { params }: Context) {
  if (!requireAccount(request, "admin")) {
    return Response.json({ error: "Only the admin can finalize a lesson." }, { status: 403 });
  }

  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Study not found." }, { status: 404 });

  let lesson: unknown;
  try {
    const body = (await request.json()) as { lesson?: unknown };
    lesson = body.lesson;
  } catch {
    return Response.json({ error: "The lesson data was not valid." }, { status: 400 });
  }
  if (!isLessonResult(lesson)) {
    return Response.json({ error: "The lesson data was not valid." }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: week, error: weekError } = await supabase
      .from("study_weeks").select("id").eq("id", id).maybeSingle();
    if (weekError) throw weekError;
    if (!week) return Response.json({ error: "Study not found." }, { status: 404 });

    const upserts = await Promise.all([
      supabase.from("lessons").upsert({ study_week_id: id, content: lesson }, { onConflict: "study_week_id" }),
      supabase.from("flashcard_decks").upsert({ study_week_id: id, content: { title: lesson.title, cards: lesson.flashcards } }, { onConflict: "study_week_id" }),
      supabase.from("tests").upsert({ study_week_id: id, content: { title: lesson.title, questions: lesson.quickTestQuestions } }, { onConflict: "study_week_id" }),
    ]);
    const failedUpsert = upserts.find((result) => result.error);
    if (failedUpsert?.error) throw failedUpsert.error;

    const { error: updateError } = await supabase.from("study_weeks")
      .update({ title: lesson.title, status: "ready", generated_content: lesson, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) throw updateError;

    return Response.json({ studyId: id, status: "ready", lesson });
  } catch (error) {
    console.error("Failed to finalize study:", error);
    return Response.json({ error: "We couldn’t save the generated lesson. The uploaded PDF is still saved — try generating again." }, { status: 500 });
  }
}
