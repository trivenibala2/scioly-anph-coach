import { NextResponse } from "next/server";
import { POST as generateLesson } from "@/app/api/lesson/route";
import type { LessonResult } from "@/app/study-session";
import { requireAccount } from "@/lib/auth";
import { isLessonResult } from "@/app/study-session";
import { getSupabaseAdmin, isUuid } from "@/lib/supabase/server";

type StoredPage = { pageNumber: number; sourcePageNumber: number; text: string };

export async function POST(request: Request, context: { params: Promise<{ weekId: string }> }) {
  if (!requireAccount(request, "admin")) {
    return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  }

  const { weekId } = await context.params;
  if (!isUuid(weekId)) return NextResponse.json({ error: "Invalid weekly package ID." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const weekResult = await supabase
    .from("study_weeks")
    .select("id, week_number, title, status, generated_content")
    .eq("id", weekId)
    .maybeSingle();
  if (weekResult.error) return NextResponse.json({ error: "Could not load this week." }, { status: 500 });
  if (!weekResult.data) return NextResponse.json({ error: "Week not found." }, { status: 404 });
  const week = weekResult.data;

  if (week.status === "ready") return NextResponse.json({ id: week.id, status: "ready", reused: true });

  try {
    let packageContent: {
      lesson: LessonResult;
      pageMap: Record<string, { fileName: string; sourcePageNumber: number }>;
    } | null = null;

    if (typeof week.generated_content === "object" && week.generated_content !== null &&
      "lesson" in week.generated_content && "pageMap" in week.generated_content) {
      const saved = week.generated_content as { lesson: unknown; pageMap: unknown };
      if (isLessonResult(saved.lesson) && typeof saved.pageMap === "object" && saved.pageMap !== null) {
        packageContent = {
          lesson: saved.lesson,
          pageMap: saved.pageMap as Record<string, { fileName: string; sourcePageNumber: number }>,
        };
      }
    }

    if (!packageContent) {
      await supabase.from("study_weeks").update({
        status: "processing",
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("id", weekId);

      const materialResult = await supabase
        .from("study_materials")
        .select("file_name, extracted_pages")
        .eq("study_week_id", weekId)
        .order("created_at", { ascending: true });
      if (materialResult.error) throw materialResult.error;

      const pages: Array<{ pageNumber: number; text: string }> = [];
      const pageMap: Record<string, { fileName: string; sourcePageNumber: number }> = {};
      for (const material of materialResult.data ?? []) {
        if (!Array.isArray(material.extracted_pages)) continue;
        for (const rawPage of material.extracted_pages as StoredPage[]) {
          if (
            !rawPage || typeof rawPage.pageNumber !== "number" ||
            typeof rawPage.sourcePageNumber !== "number" || typeof rawPage.text !== "string"
          ) continue;
          pages.push({ pageNumber: rawPage.pageNumber, text: rawPage.text });
          pageMap[String(rawPage.pageNumber)] = {
            fileName: material.file_name,
            sourcePageNumber: rawPage.sourcePageNumber,
          };
        }
      }
      pages.sort((first, second) => first.pageNumber - second.pageNumber);
      if (!pages.length) throw new Error("No extracted PDF text is available. Re-upload the weekly PDFs.");

      const generationResponse = await generateLesson(new Request("http://internal/api/lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages }),
      }));
      const generated: unknown = await generationResponse.json();
      if (!generationResponse.ok || !isLessonResult(generated)) {
        const message = typeof generated === "object" && generated !== null && "error" in generated && typeof generated.error === "string"
          ? generated.error
          : "Gemini returned an invalid weekly study package.";
        throw new Error(message);
      }

      packageContent = { lesson: generated, pageMap };
      const cached = await supabase.from("study_weeks").update({
        generated_content: packageContent,
        updated_at: new Date().toISOString(),
      }).eq("id", weekId);
      if (cached.error) throw cached.error;
    }

    const lesson = packageContent.lesson;
    const commonContent = { title: week.title, studyMaterialId: week.id, pageMap: packageContent.pageMap };
    const lessonSave = await supabase.from("lessons").upsert({
      study_week_id: weekId,
      content: { ...lesson, ...commonContent },
    }, { onConflict: "study_week_id" });
    if (lessonSave.error) throw lessonSave.error;

    const flashcardSave = await supabase.from("flashcard_decks").upsert({
      study_week_id: weekId,
      content: { ...commonContent, cards: lesson.flashcards },
    }, { onConflict: "study_week_id" });
    if (flashcardSave.error) throw flashcardSave.error;

    const testSave = await supabase.from("tests").upsert({
      study_week_id: weekId,
      content: { ...commonContent, questions: lesson.quickTestQuestions },
    }, { onConflict: "study_week_id" });
    if (testSave.error) throw testSave.error;

    const ready = await supabase.from("study_weeks").update({
      status: "ready",
      error_message: null,
      updated_at: new Date().toISOString(),
    }).eq("id", weekId);
    if (ready.error) throw ready.error;

    return NextResponse.json({ id: weekId, status: "ready", reused: false });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Weekly processing failed.";
    await supabase.from("study_weeks").update({
      status: "error",
      error_message: message,
      updated_at: new Date().toISOString(),
    }).eq("id", weekId);
    console.error("Weekly package processing failed:", message);
    return NextResponse.json({ error: message, status: "error" }, { status: 500 });
  }
}