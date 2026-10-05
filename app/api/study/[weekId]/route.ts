import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { loadStudentWeekPackage } from "@/lib/study-weeks";
import { getSupabaseAdmin, isUuid } from "@/lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ weekId: string }> }) {
  const account = requireAccount(request, "student");
  if (!account) return NextResponse.json({ error: "Student sign-in required." }, { status: 401 });

  const { weekId } = await context.params;
  if (!isUuid(weekId)) return NextResponse.json({ error: "Invalid study week ID." }, { status: 400 });

  try {
    const packageResult = await loadStudentWeekPackage(weekId, account.username);
    if (packageResult.status !== 200) {
      return NextResponse.json({ error: packageResult.error }, { status: packageResult.status });
    }

    const supabase = getSupabaseAdmin();
    const materials = await Promise.all(packageResult.materials.map(async (material) => {
      const signed = await supabase.storage.from("study-materials").createSignedUrl(material.file_path, 10 * 60);
      return {
        id: material.id,
        fileName: material.file_name,
        url: signed.error ? null : signed.data.signedUrl,
      };
    }));

    return NextResponse.json({
      week: packageResult.week,
      materials,
      lesson: packageResult.lesson,
      flashcards: packageResult.flashcards,
      test: packageResult.test,
      progress: packageResult.progress,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (caughtError) {
    console.error("Student weekly package load failed:", caughtError instanceof Error ? caughtError.message : "Unknown error");
    return NextResponse.json({ error: "Could not load this study package." }, { status: 503 });
  }
}