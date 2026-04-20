export default function Footer() {
  return (
    <footer className="border-t border-[var(--line)] bg-white/50 py-8">
      <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-accent text-white">
              <span className="text-xs font-bold">C</span>
            </div>
            <div>
              <span className="text-sm font-semibold text-ink">CarbRate</span>
              <p className="mt-1 text-sm text-ink/60">
                Comparateur de nutrition sportive d'endurance.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-ink/60">
            <a href="/#plans-rapides" className="transition hover:text-accent">
              Plans rapides
            </a>
            <a href="/#plan-effort" className="transition hover:text-accent">
              Plan d'effort
            </a>
            <a href="/#comparateur" className="transition hover:text-accent">
              Comparateur
            </a>
            <span>2026</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
