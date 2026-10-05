import { listStudentUsernames, requireAccount } from "../../../lib/auth";
import { PROGRESS_COLUMNS, toProgress, type ProgressRow } from "../../../lib/progress";
import { getSupabaseAdmin } from "../../../lib/supabase/server";

// Lists weeks. Students get their own progress; the admin gets every student's progress.
export async function GET(request: Request) {
  const account = requireAccount(request);
  if (!account) return Response.json({ error: "Please sign in." }, { status: 401 });

  try {
    const supabase = getSupabaseAdmin();
    const [weeks, materials, decks, tests, progress] = await Promise.all([
      supabase.from("study_weeks").select("id, week_number, title, status, created_at").order("week_number", { ascending: true }),
      supabase.from("study_materials").select("study_week_id, file_name"),
      supabase.from("flashcard_decks").select("study_week_id, content"),
      supabase.from("tests").select("study_week_id, content"),
      account.role === "admin"
        ? supabase.from("student_week_progress").select(PROGRESS_COLUMNS)
        : supabase.from("student_week_progress").select(PROGRESS_COLUMNS).eq("student_username", account.username),
    ]);
    for (const result of [weeks, materials, decks, tests, progress]) if (result.error) throw result.error;

    const fileByWeek = new Map((materials.data ?? []).map((item) => [item.study_week_id as string, item.file_name as string]));
    const cardCount = new Map((decks.data ?? []).map((item) => {
      const cards = (item.content as { cards?: unknown[] } | null)?.cards;
      return [item.study_week_id as string, Array.isArray(cards) ? cards.length : 0] as const;
    }));
    const questionCount = new Map((tests.data ?? []).map((item) => {
      const questions = (item.content as { questions?: unknown[] } | null)?.questions;
      return [item.study_week_id as string, Array.isArray(questions) ? questions.length : 0] as const;
    }));
    const progressRows = (progress.data ?? []) as ProgressRow[];

    return Response.json({
      account,
      students: account.role === "admin" ? listStudentUsernames() : [],
      weeks: (weeks.data ?? []).map((week) => ({
        id: week.id as string,
        weekNumber: week.week_number as number,
        title: week.title as string,
        status: week.status as string,
        fileName: fileByWeek.get(week.id as string) ?? "",
        flashcardCount: cardCount.get(week.id as string) ?? 0,
        questionCount: questionCount.get(week.id as string) ?? 0,
        progress: Object.fromEntries(
          progressRows.filter((row) => row.study_week_id === week.id).map((row) => [row.student_username, toProgress(row)]),
        ),
      })),
    });
  } catch (error) {
    console.error("Failed to list weeks:", error);
    return Response.json({ error: "We couldn’t load the weeks. Check your Supabase setup." }, { status: 500 });
  }
}
