"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cacheStudy, readCachedStudy, type StudyPackage, type StudyProgress } from "./study-session";

export type ProgressEvent =
  | { event: "lesson" }
  | { event: "flashcards"; known: number; review: number }
  | { event: "test"; score: number; weakConcepts: string[] };

// Always loads the saved study from Supabase (no Gemini call). sessionStorage is
// only used as a fallback when the network request fails.
export function useStudy(id: string) {
  const router = useRouter();
  const [study, setStudy] = useState<StudyPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/study/${id}`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 401) { router.replace("/login"); return; }
        const result = (await response.json()) as { study?: StudyPackage; error?: string };
        if (!response.ok || !result.study) throw new Error(result.error ?? "We couldn’t load this study.");
        cacheStudy(result.study);
        setStudy(result.study);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const cached = readCachedStudy(id);
        if (cached) setStudy(cached);
        else setError(caught instanceof Error ? caught.message : "We couldn’t load this study.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, router]);

  const recordProgress = useCallback(async (event: ProgressEvent) => {
    try {
      const response = await fetch(`/api/study/${id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(event),
      });
      const result = (await response.json()) as { progress?: StudyProgress; tracked?: boolean };
      if (response.ok && result.progress) {
        const progress = result.progress;
        setStudy((current) => (current ? { ...current, progress } : current));
      }
    } catch {
      /* Progress is best-effort; studying should never be blocked by it. */
    }
  }, [id]);

  return { study, loading, error, recordProgress };
}
