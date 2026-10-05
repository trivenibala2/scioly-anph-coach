import { requireAccount } from "../../../lib/auth";
import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { isLessonResult } from "../../study-session";

type ExtractedPage = { pageNumber: number; text: string };

function isPages(value: unknown): value is ExtractedPage[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every((page) =>
    typeof page === "object" && page !== null &&
    typeof (page as ExtractedPage).pageNumber === "number" &&
    Number.isInteger((page as ExtractedPage).pageNumber) &&
    (page as ExtractedPage).pageNumber >= 1 &&
    (page as ExtractedPage).pageNumber <= 200 &&
    typeof (page as ExtractedPage).text === "string",
  );
}

// Admin only: store the PDF once, plus the lesson, flashcards and test generated from it.
// Every student then reads the same saved package from /api/study/{id}.
export async function POST(request: Request) {
  if (!requireAccount(request, "admin")) {
    return Response.json({ error: "Only the admin can upload study packets." }, { status: 403 });
  }

  let storagePath: string | null = null;
  const supabase = (() => {
    try { return getSupabaseAdmin(); } catch { return null; }
  })();
  if (!supabase) return Response.json({ error: "Supabase isn’t configured on the server." }, { status: 503 });

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const pagesValue = formData.get("pages");
    const lessonValue = formData.get("lesson");
    const weekValue = Number(formData.get("weekNumber"));

    if (!(file instanceof File) || file.type !== "application/pdf") {
      return Response.json({ error: "A PDF file is required." }, { status: 400 });
    }
    if (file.size > 20 * 1024 * 1024) {
      return Response.json({ error: "This PDF is over 20 MB." }, { status: 413 });
    }
    if (!Number.isInteger(weekValue) || weekValue < 0 || weekValue > 99) {
      return Response.json({ error: "Choose a week number from 0 to 99." }, { status: 400 });
    }

    // The lesson is optional. When omitted, we persist the PDF and extracted text now and
    // leave the week in "processing" so a slow or failed generation never loses the upload.
    // The admin then attaches the generated lesson via /api/study/{id}/finalize.
    let pages: unknown;
    let lesson: unknown = null;
    try {
      pages = JSON.parse(String(pagesValue ?? ""));
      if (lessonValue != null && String(lessonValue) !== "") lesson = JSON.parse(String(lessonValue));
    } catch {
      return Response.json({ error: "The study data was not valid." }, { status: 400 });
    }
    if (!isPages(pages) || (lesson !== null && !isLessonResult(lesson))) {
      return Response.json({ error: "The study data was not valid." }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from("study_weeks").select("id").eq("week_number", weekValue).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      return Response.json({ error: `Week ${weekValue} already has a lesson. Delete it first to upload a new one.` }, { status: 409 });
    }

    const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const studyId = crypto.randomUUID();
    storagePath = `${studyId}/${safeFileName}`;

    const { error: uploadError } = await supabase.storage
      .from("study-materials")
      .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw uploadError;

    const weekTitle = lesson ? lesson.title : `Week ${weekValue} — generating…`;
    const { error: weekError } = await supabase.from("study_weeks").insert({
      id: studyId,
      week_number: weekValue,
      title: weekTitle,
      status: lesson ? "ready" : "processing",
      generated_content: lesson,
    });
    if (weekError) {
      if (weekError.code === "23505") {
        await supabase.storage.from("study-materials").remove([storagePath]);
        return Response.json({ error: `Week ${weekValue} already has a lesson. Delete it first to upload a new one.` }, { status: 409 });
      }
      throw weekError;
    }

    const { error: materialError } = await supabase.from("study_materials").insert({
      study_week_id: studyId,
      title: weekTitle,
      file_name: file.name,
      file_path: storagePath,
      extracted_text: JSON.stringify(pages),
      status: "ready",
    });
    if (materialError) throw materialError;

    if (lesson) {
      const inserts = await Promise.all([
        supabase.from("lessons").insert({ study_week_id: studyId, content: lesson }),
        supabase.from("flashcard_decks").insert({ study_week_id: studyId, content: { title: lesson.title, cards: lesson.flashcards } }),
        supabase.from("tests").insert({ study_week_id: studyId, content: { title: lesson.title, questions: lesson.quickTestQuestions } }),
      ]);
      const failedInsert = inserts.find((result) => result.error);
      if (failedInsert?.error) {
        await supabase.from("study_weeks").delete().eq("id", studyId);
        await supabase.storage.from("study-materials").remove([storagePath]);
        throw failedInsert.error;
      }
    }

    return Response.json({ studyId, weekNumber: weekValue, status: lesson ? "ready" : "processing", lesson: lesson ?? null });
  } catch (error) {
    console.error("Failed to persist study:", error);
    if (storagePath) await supabase.storage.from("study-materials").remove([storagePath]).catch(() => {});
    return Response.json({ error: "The lesson was created, but we couldn’t save the study. Check your Supabase setup." }, { status: 500 });
  }
}
