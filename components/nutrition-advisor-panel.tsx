"use client";

import { FormEvent, useState } from "react";
import {
  type AidStationAccess,
  buildEffortAdvisorResult,
  DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE,
  DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
  DRINK_BOTTLE_ML,
  type HeatProfile,
  type IntensityLevel,
  parseAdvisorQuestion,
  type SportProfile,
  type EffortContext,
  type EffortAdvisorResult,
  type GutTrainingStatus,
} from "@/lib/nutrition-advisor";
import {
  DEFAULT_TARGET_CARBS,
  getProductBrands,
  type ProductType,
} from "@/lib/product-offer-catalog";

const preferenceOptions = [
  { value: "best-value", label: "Meilleur ratio" },
  { value: "lowest-cost", label: "Budget minimum" },
  { value: "simple", label: "Le plus simple" },
  { value: "mixed", label: "Mixte" },
] as const;
const contextOptions: Array<{ value: EffortContext; label: string }> = [
  { value: "neutral", label: "Neutre" },
  { value: "training", label: "Entraînement" },
  { value: "race", label: "Course" },
];
const gutTrainingOptions: Array<{
  value: GutTrainingStatus;
  label: string;
}> = [
  { value: "standard", label: "Tolérance standard" },
  { value: "gut-trained", label: "Gut-trained" },
];
const sportOptions: Array<{ value: SportProfile; label: string }> = [
  { value: "neutral", label: "Endurance générale" },
  { value: "running", label: "Course à pied" },
  { value: "cycling", label: "Vélo" },
  { value: "trail", label: "Trail" },
  { value: "triathlon", label: "Triathlon" },
];
const intensityOptions: Array<{ value: IntensityLevel; label: string }> = [
  { value: "easy", label: "Facile" },
  { value: "steady", label: "Régulière" },
  { value: "hard", label: "Soutenue" },
  { value: "race-pace", label: "Allure course" },
];
const heatOptions: Array<{ value: HeatProfile; label: string }> = [
  { value: "cool", label: "Frais" },
  { value: "mild", label: "Tempéré" },
  { value: "hot", label: "Chaud" },
];
const aidStationOptions: Array<{ value: AidStationAccess; label: string }> = [
  { value: "self-supported", label: "Autonomie" },
  { value: "regular", label: "Ravitos réguliers" },
  { value: "frequent", label: "Ravitos fréquents" },
];
const productTypes: ProductType[] = ["Gel", "Boisson", "Barre", "Autre"];

const initialTypeValues: Record<ProductType, string> = {
  Gel: "",
  Boisson: "",
  Barre: "",
  Autre: "",
};

export function NutritionAdvisorPanel() {
  const productBrands = getProductBrands();
  const [durationHours, setDurationHours] = useState("2");
  const [durationMinutes, setDurationMinutes] = useState("0");
  const [targetCarbsPerHour, setTargetCarbsPerHour] = useState("60");
  const [maxDrinkPortionsPerHour, setMaxDrinkPortionsPerHour] = useState(
    String(DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR),
  );
  const [context, setContext] = useState<EffortContext>("neutral");
  const [gutTrainingStatus, setGutTrainingStatus] =
    useState<GutTrainingStatus>("standard");
  const [sport, setSport] = useState<SportProfile>("neutral");
  const [intensity, setIntensity] = useState<IntensityLevel>("steady");
  const [heat, setHeat] = useState<HeatProfile>("mild");
  const [aidStations, setAidStations] = useState<AidStationAccess>("regular");
  const [preference, setPreference] = useState("best-value");
  const [caffeine, setCaffeine] = useState("any");
  const [typeCounts, setTypeCounts] =
    useState<Record<ProductType, string>>(initialTypeValues);
  const [typeBrandPreferences, setTypeBrandPreferences] =
    useState<Record<ProductType, string>>(initialTypeValues);
  const [question, setQuestion] = useState(
    "Ex.: 3 h, 80 g/h, gels et boisson, sans caféine.",
  );
  const [calculatorResult, setCalculatorResult] =
    useState<EffortAdvisorResult | null>(null);
  const [assistantResult, setAssistantResult] =
    useState<EffortAdvisorResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingPrompt, setMissingPrompt] = useState<string | null>(null);

  const activeResult = assistantResult ?? calculatorResult;
  const leadPlan = activeResult?.plans[0] ?? null;
  const planMetrics = leadPlan
    ? buildPlanMetrics(leadPlan, activeResult?.durationHours ?? 0)
    : null;

  function handleCalculatorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCalculatorResult(buildEffortAdvisorResult(buildCalculatorInput()));
    setAssistantResult(null);
    setError(null);
    setMissingPrompt(null);
  }

  async function handleQuestionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/nutrition-advisor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          input: buildCalculatorInput(),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        if (payload.missingInfo) {
          setMissingPrompt(payload.error);
        }

        throw new Error(payload.error ?? "Le plan n'a pas pu être généré.");
      }

      setMissingPrompt(null);
      setAssistantResult(payload);
      const parsed = parseAdvisorQuestion(question);
      setDurationHours(String(Math.floor((payload.durationMinutes ?? parsed.durationMinutes) / 60)));
      setDurationMinutes(String((payload.durationMinutes ?? parsed.durationMinutes) % 60));
      setTargetCarbsPerHour(String(payload.targetCarbsPerHour ?? parsed.targetCarbsPerHour));
      setMaxDrinkPortionsPerHour(
        String(
          payload.maxDrinkPortionsPerHour ??
            parsed.maxDrinkPortionsPerHour ??
            DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
        ),
      );
      setContext(payload.context ?? parsed.context ?? "neutral");
      setGutTrainingStatus(
        payload.gutTrainingStatus ?? parsed.gutTrainingStatus ?? "standard",
      );
      setSport(payload.sport ?? parsed.sport ?? "neutral");
      setIntensity(payload.intensity ?? parsed.intensity ?? "steady");
      setHeat(payload.heat ?? parsed.heat ?? "mild");
      setAidStations(payload.aidStations ?? parsed.aidStations ?? "regular");
      setPreference(parsed.preference ?? "best-value");
      setCaffeine(parsed.caffeine ?? "any");
      if (
        parsed.desiredTypeCounts &&
        Object.keys(parsed.desiredTypeCounts).length > 0
      ) {
        setTypeCounts((current) => ({
          ...current,
          ...Object.fromEntries(
            Object.entries(parsed.desiredTypeCounts ?? {}).map(([type, count]) => [
              type,
              String(count),
            ]),
          ),
        }));
      } else {
        setTypeCounts({ ...initialTypeValues });
      }

      if (
        parsed.typeBrandPreferences &&
        Object.keys(parsed.typeBrandPreferences).length > 0
      ) {
        setTypeBrandPreferences((current) => ({
          ...current,
          ...Object.fromEntries(
            Object.entries(parsed.typeBrandPreferences ?? {}).map(
              ([type, brand]) => [type, brand ?? ""],
            ),
          ),
        }));
      } else {
        setTypeBrandPreferences({ ...initialTypeValues });
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Le plan n'a pas pu être généré.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function buildCalculatorInput() {
    return {
      durationMinutes:
        parseIntegerField(durationHours, 0, 0, 24) * 60 +
        parseIntegerField(durationMinutes, 0, 0, 59),
      targetCarbsPerHour: parseIntegerField(
        targetCarbsPerHour,
        DEFAULT_TARGET_CARBS,
        20,
        140,
      ),
      maxDrinkPortionsPerHour: parseIntegerField(
        maxDrinkPortionsPerHour,
        DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
        0,
        6,
      ),
      context,
      gutTrainingStatus,
      sport,
      intensity,
      heat,
      aidStations,
      preference: preference as "best-value" | "lowest-cost" | "simple" | "mixed",
      caffeine: caffeine as "any" | "avoid" | "ok",
      ...buildPreferenceInput(),
    };
  }

  function buildPreferenceInput() {
    const desiredTypeCounts = Object.fromEntries(
      productTypes
        .filter((type) => typeCounts[type] !== "")
        .map((type) => [
          type,
          parseIntegerField(typeCounts[type], 0, 0, 12),
        ]),
    );
    const brandPreferences = Object.fromEntries(
      productTypes
        .filter((type) => typeBrandPreferences[type] !== "")
        .map((type) => [type, typeBrandPreferences[type]]),
    );

    return {
      desiredTypeCounts:
        Object.keys(desiredTypeCounts).length > 0 ? desiredTypeCounts : undefined,
      typeBrandPreferences:
        Object.keys(brandPreferences).length > 0 ? brandPreferences : undefined,
    };
  }

  return (
    <section className="py-10">
      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-accent">
                Analyse intelligente
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-ink">
                Plan d'effort
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink/65">
                Décris la sortie, la cible de glucides et les produits souhaités.
                CarbRate valide les informations avant de calculer.
              </p>
            </div>
            <div className="rounded-lg bg-pine/10 px-3 py-2 text-xs font-medium text-pine">
              Durée + glucides + produits
            </div>
          </div>

          <form onSubmit={handleCalculatorSubmit} className="mt-5 grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Heures
                <input
                  type="number"
                  min="0"
                  max="24"
                  value={durationHours}
                  onChange={(event) =>
                    setDurationHours(normalizeIntegerInput(event.target.value, 24))
                  }
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
                  onChange={(event) =>
                    setDurationMinutes(normalizeIntegerInput(event.target.value, 59))
                  }
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
                onChange={(event) =>
                  setTargetCarbsPerHour(normalizeIntegerInput(event.target.value, 140))
                }
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>

            <label className="grid gap-2 text-sm text-ink/72">
              Max boissons par heure
              <input
                type="number"
                min="0"
                max="6"
                step="1"
                value={maxDrinkPortionsPerHour}
                onChange={(event) =>
                  setMaxDrinkPortionsPerHour(normalizeIntegerInput(event.target.value, 6))
                }
                className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
              />
              <span className="text-xs leading-5 text-ink/55">
                CarbRate limite la boisson à{" "}
                {DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR} portions/h pour garder un
                plan buvable, avec un maximum de{" "}
                {DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE} portions par bidon de{" "}
                {DRINK_BOTTLE_ML} ml pour éviter une boisson trop concentrée.
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Contexte
                <select
                  value={context}
                  onChange={(event) => setContext(event.target.value as EffortContext)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {contextOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-ink/72">
                Tolérance digestive
                <select
                  value={gutTrainingStatus}
                  onChange={(event) =>
                    setGutTrainingStatus(event.target.value as GutTrainingStatus)
                  }
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {gutTrainingOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Sport
                <select
                  value={sport}
                  onChange={(event) => setSport(event.target.value as SportProfile)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {sportOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-ink/72">
                Intensité
                <select
                  value={intensity}
                  onChange={(event) =>
                    setIntensity(event.target.value as IntensityLevel)
                  }
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {intensityOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-2 text-sm text-ink/72">
                Température
                <select
                  value={heat}
                  onChange={(event) => setHeat(event.target.value as HeatProfile)}
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {heatOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-sm text-ink/72">
                Logistique
                <select
                  value={aidStations}
                  onChange={(event) =>
                    setAidStations(event.target.value as AidStationAccess)
                  }
                  className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                >
                  {aidStationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

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

            <div className="grid gap-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  Composition souhaitée
                </p>
                <p className="mt-1 text-xs leading-5 text-ink/55">
                  Laisse un champ vide pour laisser CarbRate compléter le plan.
                  Mets 0 pour exclure un type.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {productTypes.map((type) => (
                  <label key={type} className="grid gap-2 text-sm text-ink/72">
                    {labelForTypeCount(type)}
                    <input
                      type="number"
                      min="0"
                      max="12"
                      value={typeCounts[type]}
                      onChange={(event) =>
                        setTypeCounts((current) => ({
                          ...current,
                          [type]: normalizeIntegerInput(event.target.value, 12),
                        }))
                      }
                      placeholder="Auto"
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none placeholder:text-ink/35 focus:border-accent"
                    />
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {productTypes.map((type) => (
                  <label key={type} className="grid gap-2 text-sm text-ink/72">
                    Marque {type.toLowerCase()}
                    <select
                      value={typeBrandPreferences[type]}
                      onChange={(event) =>
                        setTypeBrandPreferences((current) => ({
                          ...current,
                          [type]: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
                    >
                      <option value="">Indifférent</option>
                      {productBrands.map((brand) => (
                        <option key={`${type}-${brand}`} value={brand}>
                          {brand}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-accent"
            >
              Calculer
            </button>
            <button
              type="button"
              onClick={() => {
                setDurationHours("2");
                setDurationMinutes("0");
                setTargetCarbsPerHour("60");
                setMaxDrinkPortionsPerHour(
                  String(DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR),
                );
                setContext("neutral");
                setGutTrainingStatus("standard");
                setSport("neutral");
                setIntensity("steady");
                setHeat("mild");
                setAidStations("regular");
                setPreference("best-value");
                setCaffeine("any");
                setTypeCounts({ ...initialTypeValues });
                setTypeBrandPreferences({ ...initialTypeValues });
                setCalculatorResult(null);
                setAssistantResult(null);
                setError(null);
                setMissingPrompt(null);
              }}
              className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm font-medium text-ink/72 transition hover:border-accent hover:text-accent"
            >
              Réinitialiser le plan
            </button>
          </form>

          <form onSubmit={handleQuestionSubmit} className="mt-5 grid gap-3">
            <label className="grid gap-2 text-sm text-ink/72">
              Demande personnalisée
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                className="resize-none rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                "2 h 30, trail, 60 g/h, boisson et gels",
                "4 h, vélo, allure course, 90 g/h, boisson, chaud",
                "3 h 30, marathon, 75 g/h, sans caféine, ravitos réguliers",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="rounded-full border border-pine/15 bg-pine/8 px-3 py-1.5 text-xs text-pine transition hover:border-pine/35 hover:bg-pine/12"
                >
                  {example}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="rounded-lg border border-accent/25 bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Analyse..." : "Générer le plan"}
            </button>
            {missingPrompt ? (
              <div className="rounded-lg border border-accent/25 bg-accent/8 p-4 text-sm leading-6 text-ink">
                <p className="font-semibold text-accent">Information requise</p>
                <p className="mt-1">{missingPrompt}</p>
              </div>
            ) : null}
            {error && !missingPrompt ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : null}
          </form>
        </div>

        <div className="rounded-lg border border-[var(--line)] bg-white p-5 shadow-card">
          {activeResult ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
                    Plan recommandé
                  </p>
                  <h3 className="mt-3 text-2xl font-semibold text-ink">
                    {activeResult.targetTotalCarbs} g à prévoir
                  </h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeResult.recommendedCarbsPerHourRange ? (
                      <span className="rounded-full border border-pine/15 bg-pine/8 px-3 py-1 text-xs text-pine">
                        Plage réaliste:{" "}
                        {activeResult.recommendedCarbsPerHourRange.min}-
                        {activeResult.recommendedCarbsPerHourRange.max} g/h
                      </span>
                    ) : null}
                    {activeResult.context && activeResult.context !== "neutral" ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {activeResult.context === "race"
                          ? "Mode course"
                          : "Mode entraînement"}
                      </span>
                    ) : null}
                    {activeResult.gutTrainingStatus === "gut-trained" ? (
                      <span className="rounded-full border border-accent/15 bg-accent/8 px-3 py-1 text-xs text-accent">
                        Gut-trained
                      </span>
                    ) : null}
                    {activeResult.sport && activeResult.sport !== "neutral" ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {labelForSport(activeResult.sport)}
                      </span>
                    ) : null}
                    {activeResult.intensity ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {labelForIntensity(activeResult.intensity)}
                      </span>
                    ) : null}
                    {activeResult.heat ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {labelForHeat(activeResult.heat)}
                      </span>
                    ) : null}
                    {activeResult.aidStations ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {labelForAidStations(activeResult.aidStations)}
                      </span>
                    ) : null}
                    {activeResult.recommendationTier ? (
                      <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/65">
                        {labelForRecommendationTier(activeResult.recommendationTier)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm text-ink/70">
                  {activeResult.durationHours.toString().replace(".", ",")} h à{" "}
                  {activeResult.targetCarbsPerHour} g/h
                </div>
              </div>

              <p className="mt-4 whitespace-pre-line text-sm leading-6 text-ink/68">
                {activeResult.answer}
              </p>

              {planMetrics ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label="Coût / heure"
                    value={`${planMetrics.costPerHour.toFixed(2)} $`}
                    detail="sur le plan principal"
                  />
                  <MetricCard
                    label="Eau minimale"
                    value={`${planMetrics.totalWaterMl} ml`}
                    detail={`${planMetrics.bottleCount} bidon${planMetrics.bottleCount > 1 ? "s" : ""} estimé${planMetrics.bottleCount > 1 ? "s" : ""}`}
                  />
                  <MetricCard
                    label="Prises totales"
                    value={String(planMetrics.totalActions)}
                    detail="rythme à exécuter"
                  />
                  <MetricCard
                    label="Charge"
                    value={planMetrics.loadLabel}
                    detail={planMetrics.mixLabel}
                  />
                </div>
              ) : null}

              {activeResult.warnings.length > 0 ? (
                <div className="mt-5 rounded-xl border border-accent/20 bg-accent/6 p-4">
                  <p className="text-sm font-semibold text-accent">
                    Points de vigilance
                  </p>
                  <div className="mt-3 grid gap-2">
                    {activeResult.warnings.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-lg border border-accent/15 bg-white px-3 py-2 text-sm text-ink/72"
                      >
                        {warning}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeResult.strategyNotes.length > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {activeResult.strategyNotes.map((note) => (
                    <div
                      key={note.title}
                      className="rounded-xl border border-ink/10 bg-[var(--panel)] p-4"
                    >
                      <p className="text-sm font-semibold text-ink">{note.title}</p>
                      <p className="mt-2 text-sm leading-6 text-ink/65">
                        {note.detail}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}

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
                            {item.seller}
                            {item.waterMl
                              ? ` · environ ${item.waterMl} ml d'eau`
                              : ""}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {activeResult.executionPlan.length > 0 ? (
                <div className="mt-5 rounded-xl border border-ink/10 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">
                        Plan d'exécution
                      </p>
                      <p className="mt-1 text-xs text-ink/55">
                        Déroulé indicatif pour éviter les gros blocs et lisser la prise.
                      </p>
                    </div>
                    <div className="rounded-full border border-pine/15 bg-pine/8 px-3 py-1 text-xs text-pine">
                      {activeResult.executionPlan.length} repères
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3">
                    {activeResult.executionPlan.map((step) => (
                      <div
                        key={`${step.minute}-${step.label}`}
                        className="rounded-lg border border-ink/10 bg-white px-3 py-3"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {step.label}
                            </p>
                            <p className="mt-1 text-sm text-ink/68">{step.action}</p>
                          </div>
                          <div className="text-sm text-ink/60">
                            <p>{step.carbsTarget} g visés</p>
                            <p className="mt-1 text-xs">{step.hydration}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeResult.preRaceChecklist.length > 0 ? (
                <div className="mt-5 rounded-xl border border-ink/10 bg-[var(--panel)] p-4">
                  <p className="text-sm font-semibold text-ink">
                    Checklist avant départ
                  </p>
                  <div className="mt-3 grid gap-2">
                    {activeResult.preRaceChecklist.map((item) => (
                      <div
                        key={item}
                        className="rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/72"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

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
            </>
          ) : (
            <div className="flex min-h-[22rem] flex-col justify-center rounded-lg border border-pine/10 bg-pine/8 p-6">
              <p className="text-xs font-semibold text-pine">
                Plan recommandé
              </p>
              <h3 className="mt-3 text-2xl font-semibold text-ink">
                Prêt à analyser
              </h3>
              <p className="mt-3 text-sm leading-6 text-ink/65">
                Écris une demande complète comme “3 h, 80 g/h, gels et boisson”.
                Si un détail manque, CarbRate le demandera avant de proposer un plan.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function normalizeIntegerInput(value: string, max: number) {
  const digits = value.replace(/\D/g, "");
  if (digits === "") {
    return "";
  }

  return String(Math.min(max, Number.parseInt(digits, 10)));
}

function parseIntegerField(
  value: string,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function labelForTypeCount(type: ProductType) {
  if (type === "Gel") {
    return "Portions de gel";
  }

  if (type === "Boisson") {
    return "Portions de boisson";
  }

  if (type === "Barre") {
    return "Portions de barre";
  }

  return "Portions autres";
}

function labelForRecommendationTier(value: "conservative" | "standard" | "advanced") {
  if (value === "conservative") {
    return "Approche prudente";
  }

  if (value === "advanced") {
    return "Approche avancée";
  }

  return "Approche standard";
}

function labelForSport(value: SportProfile) {
  if (value === "running") {
    return "Course à pied";
  }

  if (value === "cycling") {
    return "Vélo";
  }

  if (value === "trail") {
    return "Trail";
  }

  if (value === "triathlon") {
    return "Triathlon";
  }

  return "Endurance générale";
}

function labelForIntensity(value: IntensityLevel) {
  if (value === "easy") {
    return "Intensité facile";
  }

  if (value === "hard") {
    return "Intensité soutenue";
  }

  if (value === "race-pace") {
    return "Allure course";
  }

  return "Intensité régulière";
}

function labelForHeat(value: HeatProfile) {
  if (value === "cool") {
    return "Temps frais";
  }

  if (value === "hot") {
    return "Temps chaud";
  }

  return "Temps tempéré";
}

function labelForAidStations(value: AidStationAccess) {
  if (value === "self-supported") {
    return "Autonomie";
  }

  if (value === "frequent") {
    return "Ravitos fréquents";
  }

  return "Ravitos réguliers";
}

function buildPlanMetrics(
  plan: EffortAdvisorResult["plans"][number],
  durationHours: number,
) {
  const totalWaterMl = plan.items.reduce(
    (sum, item) => sum + (item.waterMl ?? 0),
    0,
  );
  const bottleCount = totalWaterMl > 0 ? Math.ceil(totalWaterMl / DRINK_BOTTLE_ML) : 0;
  const totalActions = plan.items.reduce((sum, item) => {
    if (item.type === "Boisson" || item.type === "Barre" || item.type === "Autre") {
      return sum + Math.ceil(item.portions * 2);
    }

    return sum + Math.ceil(item.portions);
  }, 0);
  const costPerHour =
    durationHours > 0 ? plan.totalCost / durationHours : plan.totalCost;
  const itemCount = plan.items.length;

  return {
    totalWaterMl,
    bottleCount,
    totalActions,
    costPerHour,
    loadLabel:
      totalActions >= 10 ? "Élevée" : totalActions >= 6 ? "Modérée" : "Simple",
    mixLabel:
      itemCount === 1
        ? "une seule référence"
        : itemCount === 2
          ? "mix compact"
          : "mix multi-format",
  };
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-ink/10 bg-[var(--panel)] p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-ink/45">{label}</p>
      <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs leading-5 text-ink/55">{detail}</p>
    </div>
  );
}
