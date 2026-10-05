"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { TopBar } from "../components/TopBar";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = (await response.json()) as { account?: { role: "admin" | "student" }; error?: string };
      if (!response.ok || !result.account) throw new Error(result.error ?? "We couldn’t sign you in.");
      router.replace(result.account.role === "admin" ? "/admin" : "/student");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn’t sign you in.");
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <TopBar />
      <div className="auth-workspace">
        <form className="auth-card" onSubmit={submit}>
          <div className="eyebrow"><span>SCIENCE OLYMPIAD</span><span className="eyebrow-slash">/</span><span>ANATOMY &amp; PHYSIOLOGY</span></div>
          <h1>Sign in</h1>
          <p className="auth-copy">Students pick a week and study. The admin uploads PDFs and builds lessons.</p>
          <label className="field-label" htmlFor="username">Username</label>
          <input id="username" className="text-field" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" className="text-field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          {error && <div className="error-message" role="alert">{error}</div>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={16} />} Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
