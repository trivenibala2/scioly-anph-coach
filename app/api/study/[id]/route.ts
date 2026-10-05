import { requireAccount } from "../../../../lib/auth";
import { PROGRESS_COLUMNS, toProgress, type ProgressRow } from "../../../../lib/progress";
import { getSupabaseAdmin, isUuid } from "../../../../lib/supabase/server";
import { isLessonResult, type LessonResult } from "../../../study-session";

type Context = { params: Promise<{ id: string }> };

// Loads the complete saved study package. Never calls Gemini.
export async function GET(request: Request, { params }: Context) {
  const account = requireAccount(request);
  if (!account) return Response.json({ error: "Please sign in." }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Study not found." }, { status: 404 });

  try {
    const supabase = getSupabaseAdmin();
    const { data: week, error: weekError } = await supabase
      .from("study_weeks").select("id, week_number, title, status").eq("id", id).maybeSingle();
    if (weekError) throw weekError;
    if (!week) return Response.json({ error: "Study not found." }, { status: 404 });

    const [material, lesson, deck, test, progress] = await Promise.all([
      supabase.from("study_materials").select("file_name, file_path, status, extracted_text").eq("study_week_id", id).maybeSingle(),
      supabase.from("lessons").select("content").eq("study_week_id", id).maybeSingle(),
      supabase.from("flashcard_decks").select("content").eq("study_week_id", id).maybeSingle(),
      supabase.from("tests").select("content").eq("study_week_id", id).maybeSingle(),
      account.role === "student"
        ? supabase.from("student_week_progress").select(PROGRESS_COLUMNS).eq("study_week_id", id).eq("student_username", account.username).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const result of [material, lesson, deck, test, progress]) if (result.error) throw result.error;

    if (!lesson.data || !isLessonResult(lesson.data.content)) {
      return Response.json({ error: "This study has no saved lesson." }, { status: 404 });
    }

    const base = lesson.data.content;
    const deckContent = deck.data?.content as { cards?: unknown } | undefined;
    const testContent = test.data?.content as { questions?: unknown } | undefined;
    const merged: LessonResult = {
      ...base,
      flashcards: Array.isArray(deckContent?.cards) ? (deckContent.cards as LessonResult["flashcards"]) : base.flashcards,
      quickTestQuestions: Array.isArray(testContent?.questions) ? (testContent.questions as LessonResult["quickTestQuestions"]) : base.quickTestQuestions,
    };
    const lessonResult = isLessonResult(merged) ? merged : base;

    let pdfUrl: string | null = null;
    if (material.data?.file_path) {
      const { data: signed } = await supabase.storage.from("study-materials").createSignedUrl(material.data.file_path, 60 * 60);
      pdfUrl = signed?.signedUrl ?? null;
    }

    // The extracted per-page text lets the lesson show the complete source text for each module,
    // so students can study everything without opening the PDF.
    let pages: Array<{ pageNumber: number; text: string }> = [];
    if (typeof material.data?.extracted_text === "string") {
      try {
        const parsed: unknown = JSON.parse(material.data.extracted_text);
        if (Array.isArray(parsed)) {
          pages = parsed.flatMap((page) => (
            typeof page === "object" && page !== null &&
            typeof (page as { pageNumber?: unknown }).pageNumber === "number" &&
            typeof (page as { text?: unknown }).text === "string"
              ? [{ pageNumber: (page as { pageNumber: number }).pageNumber, text: (page as { text: string }).text }]
              : []
          ));
        }
      } catch {
        /* The source-text panel is a bonus; the lesson still works without it. */
      }
    }

    return Response.json({
      study: {
        id: week.id,
        weekNumber: week.week_number,
        title: week.title,
        fileName: material.data?.file_name ?? "",
        status: week.status,
        pdfUrl,
        lesson: lessonResult,
        pages,
        progress: toProgress(progress.data as ProgressRow | null),
      },
    });
  } catch (error) {
    console.error("Failed to load saved study:", error);
    return Response.json({ error: "We couldn’t load the saved study." }, { status: 500 });
  }
}

// Admin only: remove a week (cascades to lesson, deck, test, and student progress) and its PDF.
export async function DELETE(request: Request, { params }: Context) {
  if (!requireAccount(request, "admin")) return Response.json({ error: "Only the admin can delete a week." }, { status: 403 });

  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Study not found." }, { status: 404 });

  try {
    const supabase = getSupabaseAdmin();
    const { data: material } = await supabase.from("study_materials").select("file_path").eq("study_week_id", id).maybeSingle();
    const { error } = await supabase.from("study_weeks").delete().eq("id", id);
    if (error) throw error;
    if (material?.file_path) await supabase.storage.from("study-materials").remove([material.file_path]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete study:", error);
    return Response.json({ error: "We couldn’t delete that week." }, { status: 500 });
  }
}
