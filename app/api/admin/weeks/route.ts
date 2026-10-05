import { NextResponse } from "next/server";
import { requireAccount } from "@/lib/auth";
import { extractPdfPages } from "@/lib/pdf-extract";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const MAX_FILES = 10;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_PAGE_COUNT = 200;
const MAX_TEXT_LENGTH = 80_000;

export async function GET(request: Request) {
  if (!requireAccount(request, "admin")) {
    return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("study_weeks")
      .select("id, week_number, title, status, error_message, created_at, updated_at")
      .order("week_number", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ weeks: data ?? [] });
  } catch (caughtError) {
    console.error("Admin week list failed:", caughtError instanceof Error ? caughtError.message : "Unknown error");
    return NextResponse.json({ error: "Could not load weekly materials. Check Supabase configuration." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!requireAccount(request, "admin")) {
    return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a week and at least one PDF." }, { status: 400 });
  }

  const weekNumber = Number(formData.get("weekNumber"));
  const title = String(formData.get("title") ?? "").trim();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  const totalSize = files.reduce((total, file) => total + file.size, 0);

  if (!Number.isInteger(weekNumber) || weekNumber < 0 || !title) {
    return NextResponse.json({ error: "Enter a valid week number and title." }, { status: 400 });
  }
  if (!files.length || files.length > MAX_FILES) {
    return NextResponse.json({ error: `Choose between 1 and ${MAX_FILES} PDFs for this week.` }, { status: 400 });
  }
  if (totalSize > MAX_TOTAL_SIZE || files.some((file) => file.size > 20 * 1024 * 1024)) {
    return NextResponse.json({ error: "Weekly uploads must be 50 MB total or less, with each PDF at most 20 MB." }, { status: 413 });
  }

  const supabase = getSupabaseAdmin();
  let studyWeekId: string | null = null;
  const uploadedPaths: string[] = [];

  try {
    const existing = await supabase.from("study_weeks").select("id, status").eq("week_number", weekNumber).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.status !== "error") {
      return NextResponse.json({ error: `Week ${weekNumber} already exists. Remove or repair it before uploading a replacement.` }, { status: 409 });
    }

    if (existing.data) {
      studyWeekId = existing.data.id;
      const oldMaterials = await supabase.from("study_materials").select("file_path").eq("study_week_id", studyWeekId);
      if (oldMaterials.error) throw oldMaterials.error;
      const oldPaths = (oldMaterials.data ?? []).map((material) => material.file_path);
      if (oldPaths.length) await supabase.storage.from("study-materials").remove(oldPaths);
      const removeChildren = await Promise.all([
        supabase.from("lessons").delete().eq("study_week_id", studyWeekId),
        supabase.from("flashcard_decks").delete().eq("study_week_id", studyWeekId),
        supabase.from("tests").delete().eq("study_week_id", studyWeekId),
        supabase.from("study_materials").delete().eq("study_week_id", studyWeekId),
      ]);
      const failedDelete = removeChildren.find((result) => result.error);
      if (failedDelete?.error) throw failedDelete.error;
      const resetWeek = await supabase.from("study_weeks").update({
        title,
        status: "processing",
        error_message: null,
        generated_content: null,
        updated_at: new Date().toISOString(),
      }).eq("id", studyWeekId);
      if (resetWeek.error) throw resetWeek.error;
    } else {
      const inserted = await supabase.from("study_weeks").insert({
        week_number: weekNumber,
        title,
        status: "processing",
        unlock_delay_days: 1,
      }).select("id").single();
      if (inserted.error) throw inserted.error;
      studyWeekId = inserted.data.id;
    }

    const materialRows = [];
    let combinedPageCount = 0;
    let totalTextLength = 0;

    for (const file of files) {
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "study.pdf";
      const filePath = `${studyWeekId}/${crypto.randomUUID()}-${safeFileName}`;
      const upload = await supabase.storage.from("study-materials").upload(filePath, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) throw upload.error;
      uploadedPaths.push(filePath);

      const extractedPages = await extractPdfPages(file, combinedPageCount);
      combinedPageCount += extractedPages.length;
      if (combinedPageCount > MAX_PAGE_COUNT) throw new Error(`A weekly package can contain up to ${MAX_PAGE_COUNT} text pages.`);
      totalTextLength += extractedPages.reduce((total, page) => total + page.text.length, 0);
      if (totalTextLength > MAX_TEXT_LENGTH) throw new Error("The combined weekly text is too long. Upload fewer or shorter PDFs.");

      materialRows.push({
        study_week_id: studyWeekId,
        title: safeFileName.replace(/\.pdf$/i, ""),
        file_name: file.name,
        file_path: filePath,
        extracted_text: extractedPages.map((page) => page.text).join("\n"),
        extracted_pages: extractedPages,
        status: "uploaded",
      });
    }

    const insertedMaterials = await supabase.from("study_materials").insert(materialRows);
    if (insertedMaterials.error) throw insertedMaterials.error;
    const readyForGeneration = await supabase.from("study_weeks").update({
      status: "uploaded",
      updated_at: new Date().toISOString(),
    }).eq("id", studyWeekId);
    if (readyForGeneration.error) throw readyForGeneration.error;

    return NextResponse.json({ id: studyWeekId, status: "uploaded", files: files.length, pages: combinedPageCount }, { status: 201 });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : "Weekly PDF upload failed.";
    if (uploadedPaths.length) await supabase.storage.from("study-materials").remove(uploadedPaths);
    if (studyWeekId) {
      await supabase.from("study_materials").delete().eq("study_week_id", studyWeekId);
      await supabase.from("study_weeks").update({ status: "error", error_message: message, updated_at: new Date().toISOString() }).eq("id", studyWeekId);
    }
    console.error("Admin weekly upload failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}