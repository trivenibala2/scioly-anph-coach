import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type StudyWeekStatus = "uploaded" | "processing" | "ready" | "error";

export type StudentWeekStatus = {
  id: string;
  weekNumber: number;
  title: string;
  status: StudyWeekStatus;
  errorMessage: string | null;
  unlocked: boolean;
  completedAt: string | null;
  unlocksAt: string | null;
  lessonDone: boolean;
  flashcardsDone: boolean;
  testDone: boolean;
};

export async function listStudentWeeks(username: string): Promise<StudentWeekStatus[]> {
  const supabase = getSupabaseAdmin();
  const [{ data: weeks, error: weekError }, { data: progress, error: progressError }] = await Promise.all([
    supabase.from("study_weeks")
      .select("id, week_number, title, status, error_message")
      .order("week_number", { ascending: true }),
    supabase.from("student_week_progress")
      .select("study_week_id, lesson_completed_at, flashcards_completed_at, test_submitted_at, completed_at, unlocks_at")
      .eq("student_username", username),
  ]);

  if (weekError) throw weekError;
  if (progressError) throw progressError;

  const progressByWeek = new Map((progress ?? []).map((item) => [item.study_week_id, item]));
  const readyWeekByNumber = new Map((weeks ?? [])
    .filter((week) => week.status === "ready")
    .map((week) => [week.week_number, week]));
  const now = Date.now();

  return (weeks ?? []).map((week) => {
    const studentProgress = progressByWeek.get(week.id);
    let unlocked = week.week_number === 0;
    if (week.week_number > 0) {
      const previousWeek = readyWeekByNumber.get(week.week_number - 1);
      const previousProgress = previousWeek ? progressByWeek.get(previousWeek.id) : null;
      unlocked = Boolean(
        previousProgress?.completed_at && previousProgress.unlocks_at &&
        Date.parse(previousProgress.unlocks_at) <= now,
      );
    }

    return {
      id: week.id,
      weekNumber: week.week_number,
      title: week.title,
      status: week.status as StudyWeekStatus,
      errorMessage: week.error_message,
      unlocked: week.status === "ready" && unlocked,
      completedAt: studentProgress?.completed_at ?? null,
      unlocksAt: studentProgress?.unlocks_at ?? null,
      lessonDone: Boolean(studentProgress?.lesson_completed_at),
      flashcardsDone: Boolean(studentProgress?.flashcards_completed_at),
      testDone: Boolean(studentProgress?.test_submitted_at),
    };
  });
}

export async function loadStudentWeekPackage(weekId: string, username: string) {
  const weeks = await listStudentWeeks(username);
  const access = weeks.find((week) => week.id === weekId);
  if (!access) return { status: 404 as const, error: "Study week not found." };
  if (!access.unlocked) return { status: 403 as const, error: "This study week is not unlocked yet." };

  const supabase = getSupabaseAdmin();
  const [weekResult, materialResult, lessonResult, flashcardResult, testResult] = await Promise.all([
    supabase.from("study_weeks").select("id, week_number, title, status, error_message, generated_content, unlock_delay_days").eq("id", weekId).single(),
    supabase.from("study_materials").select("id, file_name, file_path, extracted_pages, status").eq("study_week_id", weekId).order("created_at", { ascending: true }),
    supabase.from("lessons").select("content").eq("study_week_id", weekId).maybeSingle(),
    supabase.from("flashcard_decks").select("content").eq("study_week_id", weekId).maybeSingle(),
    supabase.from("tests").select("content").eq("study_week_id", weekId).maybeSingle(),
  ]);
  const failure = [weekResult, materialResult, lessonResult, flashcardResult, testResult].find((result) => result.error);
  if (failure?.error) throw failure.error;

  return {
    status: 200 as const,
    week: weekResult.data,
    materials: materialResult.data ?? [],
    lesson: lessonResult.data?.content ?? null,
    flashcards: flashcardResult.data?.content ?? null,
    test: testResult.data?.content ?? null,
    progress: access,
  };
}