export default function Footer() {
  return (
    <footer className="border-t border-[var(--line)] bg-white/50 py-8">
      <div className="mx-auto max-w-7xl px-6 sm:px-8 lg:px-10">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-accent text-white">
              <span className="text-xs font-bold">C</span>
            </div>
            <span className="text-sm font-semibold text-ink">CarbRate</span>
          </div>

          <p className="text-sm text-ink/60">
            Outil de comparaison nutritionnelle pour athlètes d'endurance.
          </p>

          <div className="flex items-center gap-4 text-sm text-ink/60">
            <a
              href="https://github.com/nathanguerard-ai/carbrate-site"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              Code source
            </a>
            <span>•</span>
            <span>2026</span>
          </div>
        </div>
      </div>
    </footer>
  );
}