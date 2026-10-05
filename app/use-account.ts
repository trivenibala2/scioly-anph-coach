"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Account = { username: string; role: "admin" | "student" };

// Loads the signed-in account. Redirects to /login when signed out, or to the
// right home page when the signed-in role is not allowed on this page.
export function useAccount(requiredRole?: Account["role"]) {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me")
      .then(async (response) => {
        if (cancelled) return;
        if (!response.ok) { router.replace("/login"); return; }
        const result = (await response.json()) as { account: Account };
        if (requiredRole && result.account.role !== requiredRole) {
          router.replace(result.account.role === "admin" ? "/admin" : "/student");
          return;
        }
        setAccount(result.account);
      })
      .catch(() => { if (!cancelled) router.replace("/login"); });
    return () => { cancelled = true; };
  }, [requiredRole, router]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
  }

  return { account, signOut };
}
