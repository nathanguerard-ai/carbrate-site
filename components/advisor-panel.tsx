"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  buildEffortAdvisorResult,
  parseAdvisorQuestion,
  type EffortAdvisorResult,
} from "@/lib/advisor";

const preferenceOptions = [
  { value: "best-value", label: "Meilleur ratio" },
  { value: "lowest-cost", label: "Budget minimum" },
  { value: "simple", label: "Le plus simple" },
  { value: "mixed", label: "Mixte" },
] as const;

export function AdvisorPanel() {
  const [durationHours, setDurationHours] = useState(2);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [targetCarbsPerHour, setTargetCarbsPerHour] = useState(60);
  const [preference, setPreference] = useState("best-value");
  const [caffeine, setCaffeine] = useState("any");
  const [question, setQuestion] = useState(
    "Je fais 2h30 à 60g/h, budget minimum, sans caféine.",
  );
  const [assistantResult, setAssistantResult] =
    useState<EffortAdvisorResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formResult = useMemo(
    () =>
      buildEffortAdvisorResult({
        durationMinutes: durationHours * 60 + durationMinutes,
        targetCarbsPerHour,
        preference: preference as "best-value" | "lowest-cost" | "simple" | "mixed",
        caffeine: caffeine as "any" | "avoid" | "ok",
      }),
    [durationHours, durationMinutes, targetCarbsPerHour, preference, caffeine],
  );
  const activeResult = assistantResult ?? formResult;

  function handleCalculatorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAssistantResult(null);
    setError(null);
  }

  async function handleQuestionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "L'assistant n'a pas pu répondre.");
      }

      setAssistantResult(payload);
      const parsed = parseAdvisorQuestion(question);
      setDurationHours(Math.floor(parsed.durationMinutes / 60));
      setDurationMinutes(parsed.durationMinutes % 60);
      setTargetCarbsPerHour(parsed.targetCarbsPerHour);
      setPreference(parsed.preference ?? "best-value");
      setCaffeine(parsed.caffeine ?? "any");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "L'assistant n'a pas pu répondre.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="py-8">
      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
            Assistant IA
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">
            Planifie ton effort.
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            Les recommandations utilisent les prix, portions et liens vérifiés du
            catalogue. L'assistant ne crée pas de prix.
          </p>

          <form onSubmit={handleCalculatorSubmit} className="mt-5 grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Heures
                <input
                  type="number"
                  min="0"
                  max="24"
                  value={durationHours}
                  onChange={(event) => setDurationHours(Number(event.target.value))}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="grid gap-2 text-sm text-ink/72">
                Minutes
                <input
                  type="number"
                  min="0"
                  max="59"
                  step="5"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm text-ink/72">
              Glucides par heure
              <input
                type="number"
                min="20"
                max="140"
                step="5"
                value={targetCarbsPerHour}
                onChange={(event) => setTargetCarbsPerHour(Number(event.target.value))}
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Priorité
                <select
                  value={preference}
                  onChange={(event) => setPreference(event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {preferenceOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-ink/72">
                Caféine
                <select
                  value={caffeine}
                  onChange={(event) => setCaffeine(event.target.value)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  <option value="any">Indifférent</option>
                  <option value="avoid">Éviter</option>
                  <option value="ok">Accepté</option>
                </select>
              </label>
            </div>

            <button
              type="submit"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accent"
            >
              Calculer
            </button>
          </form>

          <form onSubmit={handleQuestionSubmit} className="mt-5 grid gap-3">
            <label className="grid gap-2 text-sm text-ink/72">
              Question libre
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                className="resize-none rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg border border-accent/25 bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Analyse..." : "Demander à CarbRate AI"}
            </button>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </form>
        </div>

        <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--panel)] p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
                Recommandation
              </p>
              <h3 className="mt-3 text-2xl font-semibold text-ink">
                {activeResult.targetTotalCarbs} g à prévoir
              </h3>
            </div>
            <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink/70">
              {activeResult.durationHours.toString().replace(".", ",")} h à{" "}
              {activeResult.targetCarbsPerHour} g/h
            </div>
          </div>

          <p className="mt-4 whitespace-pre-line text-sm leading-6 text-ink/68">
            {activeResult.answer}
          </p>

          <div className="mt-5 grid gap-3">
            {activeResult.plans.map((plan) => (
              <div
                key={plan.title}
                className="rounded-xl border border-ink/10 bg-white/70 p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-ink">{plan.title}</p>
                    <p className="mt-1 text-sm text-ink/60">{plan.summary}</p>
                  </div>
                  <p className="text-sm font-semibold text-accent">
                    {plan.totalCost.toFixed(2)} $
                  </p>
                </div>
                <div className="mt-3 grid gap-2">
                  {plan.items.map((item) => (
                    <a
                      key={`${plan.title}-${item.productId}`}
                      href={item.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/72 transition hover:border-accent hover:text-accent"
                    >
                      <span className="font-medium text-ink">
                        {item.portions.toString().replace(".", ",")} portion
                        {item.portions > 1 ? "s" : ""} · {item.brand} {item.name}
                      </span>
                      <span className="block text-xs text-ink/55">
                        {item.totalCarbs} g · {item.totalCost.toFixed(2)} $ ·{" "}
                        {item.verificationLabel} chez {item.seller}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {activeResult.assumptions.map((assumption) => (
              <span
                key={assumption}
                className="rounded-full border border-ink/10 bg-white/65 px-3 py-1 text-xs text-ink/60"
              >
                {assumption}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
