"use client";

import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 sm:px-8 lg:px-10">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">
            <span className="text-sm font-bold">C</span>
          </div>
          <span className="text-xl font-semibold text-ink">CarbRate</span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm text-ink/70 hover:text-ink transition-colors"
          >
            Accueil
          </Link>
          <a
            href="/#plans-rapides"
            className="text-sm text-ink/70 transition-colors hover:text-ink"
          >
            Plans
          </a>
          <a
            href="/#plan-effort"
            className="text-sm text-ink/70 transition-colors hover:text-ink"
          >
            Plan d'effort
          </a>
          <a
            href="/#comparateur"
            className="text-sm text-ink/70 transition-colors hover:text-ink"
          >
            Comparateur
          </a>
        </nav>
      </div>
    </header>
  );
}
