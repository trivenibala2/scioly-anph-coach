"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, Check, LoaderCircle, RotateCcw } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { useAccount } from "../use-account";
import type { StudyProgress } from "../study-session";

type Week = {
  id: string;
  weekNumber: number;
  title: string;
  flashcardCount: number;
  questionCount: number;
  progress: Record<string, StudyProgress | null>;
};

export default function StudentPage() {
  const { account, signOut } = useAccount("student");
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void fetch("/api/weeks")
      .then(async (response) => {
        const result = (await response.json()) as { weeks?: Week[]; error?: string };
        if (!response.ok || !result.weeks) throw new Error(result.error ?? "We couldn’t load the weeks.");
        if (!cancelled) setWeeks(result.weeks);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "We couldn’t load the weeks."); });
    return () => { cancelled = true; };
  }, [account]);

  return (
    <main className="app-shell">
      <TopBar homeHref="/student" username={account?.username} roleLabel="student" onSignOut={signOut} />
      <div className="workspace">
        <section className="intro">
          <div className="eyebrow"><span>SCIENCE OLYMPIAD</span><span className="eyebrow-slash">/</span><span>ANATOMY &amp; PHYSIOLOGY</span></div>
          <h1>Pick your week<span className="title-period">.</span></h1>
          <p className="intro-copy">Read the lesson, practice the flashcards, then take the Quick Test. Your progress is saved.</p>
        </section>

        {error && <div className="error-message" role="alert">{error}</div>}
        {!weeks && !error && <div className="page-loading"><LoaderCircle className="spin" size={20} /> Loading weeks…</div>}
        {weeks && weeks.length === 0 && <div className="empty-weeks">No weeks are ready yet. Check back after the admin uploads one.</div>}

        <div className="week-grid">
          {weeks?.map((week) => {
            const progress = account ? week.progress[account.username] ?? null : null;
            return (
              <article className="week-card" key={week.id}>
                <div className="week-card-top">
                  <span className="week-badge">WEEK {week.weekNumber}</span>
                  {progress?.completedAt && <span className="ready-badge"><span /> COMPLETE</span>}
                </div>
                <h2>{week.title}</h2>
                <ul className="week-steps">
                  <li className={progress?.lessonCompletedAt ? "step-done" : ""}><Check size={13} /> Lesson</li>
                  <li className={progress?.flashcardsCompletedAt ? "step-done" : ""}><Check size={13} /> Flashcards ({week.flashcardCount})</li>
                  <li className={progress?.testSubmittedAt ? "step-done" : ""}>
                    <Check size={13} /> Quick Test{progress?.testScore !== null && progress?.testScore !== undefined ? ` · ${progress.testScore}/5 (best ${progress.bestTestScore ?? progress.testScore}/5)` : ""}
                  </li>
                </ul>
                <div className="week-actions">
                  <Link className="button button-primary" href={`/study/${week.id}/lesson`}><BookOpenCheck size={15} /> Lesson</Link>
                  <Link className={`button button-practice ${week.flashcardCount ? "" : "link-disabled"}`} href={`/study/${week.id}/flashcards`}><RotateCcw size={15} /> Flashcards</Link>
                  <Link className={`button button-test ${week.questionCount === 5 ? "" : "link-disabled"}`} href={`/study/${week.id}/test`}><Check size={15} /> Test</Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
