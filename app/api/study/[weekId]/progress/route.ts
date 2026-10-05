import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { loadStudentWeekPackage } from "@/lib/study-weeks";
import { getSupabaseAdmin, isUuid } from "@/lib/supabase/server";

type CompletionActivity = "lesson" | "flashcards" | "test";

export async function POST(request: Request, context: { params: Promise<{ weekId: string }> }) {
  const account = requireAccount(request, "student");
  if (!account) return NextResponse.json({ error: "Student sign-in required." }, { status: 401 });

  const { weekId } = await context.params;
  if (!isUuid(weekId)) return NextResponse.json({ error: "Invalid study week ID." }, { status: 400 });

  let body: { activity?: unknown; score?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Completion data was not valid." }, { status: 400 });
  }

  if (!(body.activity === "lesson" || body.activity === "flashcards" || body.activity === "test")) {
    return NextResponse.json({ error: "Unknown study activity." }, { status: 400 });
  }
  if (body.activity === "test" && (typeof body.score !== "number" || !Number.isInteger(body.score) || body.score < 0 || body.score > 5)) {
    return NextResponse.json({ error: "Test score must be between zero and five." }, { status: 400 });
  }

  try {
    const packageResult = await loadStudentWeekPackage(weekId, account.username);
    if (packageResult.status !== 200) {
      return NextResponse.json({ error: packageResult.error }, { status: packageResult.status });
    }

    const supabase = getSupabaseAdmin();
    const previousResult = await supabase.from("student_week_progress")
      .select("lesson_completed_at, flashcards_completed_at, test_submitted_at, test_score, completed_at, unlocks_at")
      .eq("study_week_id", weekId)
      .eq("student_username", account.username)
      .maybeSingle();
    if (previousResult.error) throw previousResult.error;

    const previous = previousResult.data;
    const now = new Date();
    const nowIso = now.toISOString();
    const progress = {
      student_username: account.username,
      study_week_id: weekId,
      lesson_completed_at: previous?.lesson_completed_at ?? (body.activity === "lesson" ? nowIso : null),
      flashcards_completed_at: previous?.flashcards_completed_at ?? (body.activity === "flashcards" ? nowIso : null),
      test_submitted_at: previous?.test_submitted_at ?? (body.activity === "test" ? nowIso : null),
      test_score: body.activity === "test" ? body.score as number : previous?.test_score ?? null,
      completed_at: previous?.completed_at ?? null,
      unlocks_at: previous?.unlocks_at ?? null,
      updated_at: nowIso,
    };

    if (
      !progress.completed_at && progress.lesson_completed_at &&
      progress.flashcards_completed_at && progress.test_submitted_at
    ) {
      const unlockDelayDays = packageResult.week?.unlock_delay_days ?? 1;
      const completedAt = now;
      progress.completed_at = completedAt.toISOString();
      progress.unlocks_at = new Date(completedAt.getTime() + unlockDelayDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const saved = await supabase.from("student_week_progress")
      .upsert(progress, { onConflict: "student_username,study_week_id" })
      .select("lesson_completed_at, flashcards_completed_at, test_submitted_at, test_score, completed_at, unlocks_at")
      .single();
    if (saved.error) throw saved.error;

    return NextResponse.json({ progress: saved.data }, { headers: { "Cache-Control": "no-store" } });
  } catch (caughtError) {
    console.error("Student progress save failed:", caughtError instanceof Error ? caughtError.message : "Unknown error");
    return NextResponse.json({ error: "Could not save study progress." }, { status: 503 });
  }
}