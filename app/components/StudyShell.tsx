"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useAccount } from "../use-account";
import { TopBar } from "./TopBar";

// Shared chrome for the study pages: back link goes to the week list for the signed-in role.
export function StudyShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  const { account, signOut } = useAccount();
  const home = account?.role === "admin" ? "/admin" : "/student";
  return (
    <main className={`app-shell ${className}`}>
      <TopBar
        homeHref={home}
        backHref={home}
        backLabel={account?.role === "admin" ? "All weeks" : "Pick a week"}
        username={account?.username}
        roleLabel={account?.role}
        onSignOut={signOut}
      />
      {children}
    </main>
  );
}

export function StudyMessage({ title, body, href, cta }: { title: string; body: string; href?: string; cta?: string }) {
  return (
    <section className="flashcards-empty">
      <h1>{title}</h1>
      <p>{body}</p>
      {href && cta && <Link className="button button-primary" href={href}>{cta}</Link>}
    </section>
  );
}
