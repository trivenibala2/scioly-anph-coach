import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { listStudentWeeks } from "@/lib/study-weeks";

export async function GET(request: Request) {
  const account = requireAccount(request, "student");
  if (!account) return NextResponse.json({ error: "Student sign-in required." }, { status: 401 });

  try {
    const weeks = await listStudentWeeks(account.username);
    return NextResponse.json({ weeks }, { headers: { "Cache-Control": "no-store" } });
  } catch (caughtError) {
    console.error("Student week list failed:", caughtError instanceof Error ? caughtError.message : "Unknown error");
    return NextResponse.json({ error: "Could not load the weekly study plan. Check Supabase configuration." }, { status: 503 });
  }
}