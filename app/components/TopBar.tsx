"use client";

import Link from "next/link";
import { ArrowLeft, Dna, LogOut } from "lucide-react";

type TopBarProps = {
  homeHref?: string;
  backHref?: string;
  backLabel?: string;
  username?: string;
  roleLabel?: string;
  onSignOut?: () => void;
};

export function TopBar({ homeHref = "/", backHref, backLabel = "Back", username, roleLabel, onSignOut }: TopBarProps) {
  return (
    <header className="topbar">
      <Link className="brand" href={homeHref} aria-label="ScienceOly home">
        <span className="brand-mark"><Dna size={20} strokeWidth={2.2} /></span>
        <span>science<span className="brand-light">oly</span></span>
      </Link>
      <div className="topbar-actions">
        {backHref && (
          <Link className="flashcards-back-link" href={backHref}>
            <ArrowLeft size={15} /> <span>{backLabel}</span>
          </Link>
        )}
        {username && <span className="topbar-note"><span className="privacy-dot" /> {username}{roleLabel ? ` · ${roleLabel}` : ""}</span>}
        {onSignOut && (
          <button className="signout-button" type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
        )}
      </div>
    </header>
  );
}
