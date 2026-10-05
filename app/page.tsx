"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

// Sends each person to the right place: sign-in, the admin console, or the student week list.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) { router.replace("/login"); return; }
        const result = (await response.json()) as { account: { role: "admin" | "student" } };
        router.replace(result.account.role === "admin" ? "/admin" : "/student");
      })
      .catch(() => { if (!cancelled) router.replace("/login"); });
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="app-shell">
      <div className="page-loading"><LoaderCircle className="spin" size={22} /> Loading…</div>
    </main>
  );
}
