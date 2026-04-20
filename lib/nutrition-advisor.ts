import {
  DEFAULT_TARGET_CARBS,
  ProductType,
  ProductWithMetrics,
  getOfferVerificationStatus,
  getProducts,
} from "@/lib/product-offer-catalog";

export type EffortPreference = "best-value" | "lowest-cost" | "simple" | "mixed";
export type CaffeinePreference = "any" | "avoid" | "ok";
export type EffortContext = "training" | "race" | "neutral";
export type GutTrainingStatus = "standard" | "gut-trained";
export type SportProfile =
  | "neutral"
  | "running"
  | "cycling"
  | "trail"
  | "triathlon";
export type IntensityLevel = "easy" | "steady" | "hard" | "race-pace";
export type HeatProfile = "cool" | "mild" | "hot";
export type AidStationAccess = "self-supported" | "regular" | "frequent";
export type RecommendationTier = "conservative" | "standard" | "advanced";

export type EffortAdvisorInput = {
  durationMinutes: number;
  targetCarbsPerHour: number;
  preference?: EffortPreference;
  caffeine?: CaffeinePreference;
  context?: EffortContext;
  gutTrainingStatus?: GutTrainingStatus;
  sport?: SportProfile;
  intensity?: IntensityLevel;
  heat?: HeatProfile;
  aidStations?: AidStationAccess;
  preferredTypes?: ProductType[];
  desiredTypeCounts?: Partial<Record<ProductType, number>>;
  typeBrandPreferences?: Partial<Record<ProductType, string>>;
  maxDrinkPortionsPerHour?: number;
  question?: string;
};

export type MissingAdvisorInfo =
  | "duration"
  | "targetCarbsPerHour"
  | "productPreference";

export type AdvisorQuestionAnalysis = {
  input: EffortAdvisorInput;
  missingInfo: MissingAdvisorInfo[];
  prompt: string | null;
};

export type EffortAdvisorItem = {
  productId: string;
  name: string;
  brand: string;
  type: ProductType;
  seller: string;
  productUrl: string;
  portions: number;
  carbsPerPortion: number;
  totalCarbs: number;
  unitPrice: number;
  totalCost: number;
  waterMl?: number;
  packagePrice?: number;
  unitCount?: number;
  verificationLabel: string;
};

export type EffortAdvisorPlan = {
  title: string;
  summary: string;
  totalCarbs: number;
  totalCost: number;
  items: EffortAdvisorItem[];
};

export type EffortAdvisorExecutionStep = {
  minute: number;
  label: string;
  carbsTarget: number;
  action: string;
  hydration: string;
};

export type EffortAdvisorStrategyNote = {
  title: string;
  detail: string;
};

export type EffortAdvisorResult = {
  durationMinutes: number;
  durationHours: number;
  targetCarbsPerHour: number;
  maxDrinkPortionsPerHour?: number;
  requestedTargetCarbsPerHour?: number;
  targetTotalCarbs: number;
  context?: EffortContext;
  gutTrainingStatus?: GutTrainingStatus;
  sport?: SportProfile;
  intensity?: IntensityLevel;
  heat?: HeatProfile;
  aidStations?: AidStationAccess;
  recommendationTier?: RecommendationTier;
  recommendedCarbsPerHourRange?: {
    min: number;
    max: number;
  };
  assumptions: string[];
  warnings: string[];
  strategyNotes: EffortAdvisorStrategyNote[];
  executionPlan: EffortAdvisorExecutionStep[];
  preRaceChecklist: string[];
  plans: EffortAdvisorPlan[];
  answer: string;
};

const TYPE_KEYWORDS: Array<[ProductType, RegExp]> = [
  ["Gel", /\b(gel|gels|gelatineux|gelatineuse)\b/i],
  ["Boisson", /\b(boisson|boissons|liquide|liquides|drink|drinks|mix|poudre|poudres|bouteille|bouteilles|bidon|bidons|flasque|flasques|hydratation|boire)\b/i],
  ["Barre", /\b(barre|barres|bar|bars|solide|solides|manger|collation)\b/i],
  ["Autre", /\b(autre|autres|chew|chews|gomme|gommes|gummies|bonbon|bonbons|machouiller|mastiquer)\b/i],
];
const PRODUCT_TYPES: ProductType[] = ["Gel", "Boisson", "Barre", "Autre"];
export const DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR = 2;
export const DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE = 2;
export const DRINK_BOTTLE_ML = 500;
const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
};
const NUMBER_TOKEN =
  "(?:\\d+(?:[,.]\\d+)?|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)";

type AdvisorSelection = {
  product: ProductWithMetrics;
  portions?: number;
};

type CarbRecommendationProfile = {
  min: number;
  max: number;
  suggested: number;
  note: string;
  tier: RecommendationTier;
};

type PortionAllocation = {
  product: ProductWithMetrics;
  portions: number;
};

export function parseAdvisorQuestion(question: string): EffortAdvisorInput {
  return analyzeAdvisorQuestion(question, {
    durationMinutes: 120,
    targetCarbsPerHour: DEFAULT_TARGET_CARBS,
  }).input;
}

export function analyzeAdvisorQuestion(
  question: string,
  fallbackInput: Partial<EffortAdvisorInput> = {},
): AdvisorQuestionAnalysis {
  const durationMinutes = parseDurationMinutes(question);
  const targetCarbsPerHour = parseCarbsPerHour(question, durationMinutes);
  const preferredTypes = parsePreferredTypes(question);
  const desiredTypeCounts = parseDesiredTypeCounts(question);
  const maxDrinkPortionsPerHour = parseMaxDrinkPortionsPerHour(question);
  const missingInfo: MissingAdvisorInfo[] = [];

  if (
    durationMinutes === null &&
    !Number.isFinite(fallbackInput.durationMinutes)
  ) {
    missingInfo.push("duration");
  }

  if (
    targetCarbsPerHour === null &&
    !Number.isFinite(fallbackInput.targetCarbsPerHour)
  ) {
    missingInfo.push("targetCarbsPerHour");
  }

  const fallbackTypeCounts = normalizeTypeCounts(fallbackInput.desiredTypeCounts);
  const hasFallbackProductPreference =
    (fallbackInput.preferredTypes?.length ?? 0) > 0 ||
    Object.keys(fallbackTypeCounts).length > 0;

  if (
    preferredTypes.length === 0 &&
    Object.keys(desiredTypeCounts).length === 0 &&
    !hasFallbackProductPreference
  ) {
    missingInfo.push("productPreference");
  }

  const input = {
    ...fallbackInput,
    durationMinutes:
      durationMinutes ?? fallbackInput.durationMinutes ?? 120,
    targetCarbsPerHour:
      targetCarbsPerHour ?? fallbackInput.targetCarbsPerHour ?? DEFAULT_TARGET_CARBS,
    preference: parsePreference(question),
    caffeine: /\b(sans|éviter|eviter|pas de|aucune?)\s+(caféine|cafeine)\b/i.test(question)
      ? "avoid"
      : fallbackInput.caffeine ?? "any",
    context: parseEffortContext(question) ?? fallbackInput.context ?? "neutral",
    gutTrainingStatus:
      parseGutTrainingStatus(question) ??
      fallbackInput.gutTrainingStatus ??
      "standard",
    sport: parseSportProfile(question) ?? fallbackInput.sport ?? "neutral",
    intensity:
      parseIntensityLevel(question) ??
      fallbackInput.intensity ??
      ((parseEffortContext(question) ?? fallbackInput.context) === "race"
        ? "race-pace"
        : "steady"),
    heat: parseHeatProfile(question) ?? fallbackInput.heat ?? "mild",
    aidStations:
      parseAidStations(question) ?? fallbackInput.aidStations ?? "regular",
    preferredTypes: preferredTypes.length > 0
      ? preferredTypes
      : fallbackInput.preferredTypes ?? [],
    desiredTypeCounts: Object.keys(desiredTypeCounts).length > 0
      ? desiredTypeCounts
      : fallbackInput.desiredTypeCounts,
    maxDrinkPortionsPerHour:
      maxDrinkPortionsPerHour ??
      fallbackInput.maxDrinkPortionsPerHour ??
      DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
    question,
  } as EffortAdvisorInput;

  return {
    input,
    missingInfo,
    prompt: missingInfo.length > 0 ? formatMissingInfoPrompt(missingInfo) : null,
  };
}

export function buildEffortAdvisorResult(
  input: EffortAdvisorInput,
): EffortAdvisorResult {
  const durationMinutes = clamp(input.durationMinutes, 30, 24 * 60);
  const requestedTargetCarbsPerHour = clamp(input.targetCarbsPerHour, 20, 140);
  const context = input.context ?? "neutral";
  const gutTrainingStatus = input.gutTrainingStatus ?? "standard";
  const sport = input.sport ?? "neutral";
  const intensity = input.intensity ?? (context === "race" ? "race-pace" : "steady");
  const heat = input.heat ?? "mild";
  const aidStations = input.aidStations ?? "regular";
  const carbProfile = getCarbRecommendationProfile(
    durationMinutes,
    context,
    gutTrainingStatus,
    sport,
    intensity,
    heat,
  );
  const targetCarbsPerHour = clamp(
    requestedTargetCarbsPerHour,
    20,
    carbProfile.max,
  );
  const durationHours = round(durationMinutes / 60);
  const targetTotalCarbs = Math.round(durationHours * targetCarbsPerHour);
  const maxDrinkPortions = getMaxDrinkPortionsForDuration(input, durationHours);
  const normalizedInput = {
    ...input,
    targetCarbsPerHour,
    context,
    gutTrainingStatus,
    sport,
    intensity,
    heat,
    aidStations,
  };
  const products = getAdvisorProducts(normalizedInput);
  const assumptions = buildAssumptions(
    normalizedInput,
    durationMinutes,
    targetCarbsPerHour,
    requestedTargetCarbsPerHour,
    carbProfile,
  );
  const customPlan = buildRequestedCompositionPlan(
    products,
    targetTotalCarbs,
    normalizedInput,
    maxDrinkPortions,
  );
  const mixedPlan = buildMixedPlan(products, targetTotalCarbs, normalizedInput, maxDrinkPortions);
  const budgetPlan = buildSingleProductPlan(
    "Option budget",
    products,
    targetTotalCarbs,
    "lowest-cost",
    normalizedInput,
    maxDrinkPortions,
  );
  const ratioPlan = buildSingleProductPlan(
    "Option meilleur ratio",
    products,
    targetTotalCarbs,
    "best-value",
    normalizedInput,
    maxDrinkPortions,
  );
  const simplePlan = buildSingleProductPlan(
    "Option simple",
    products,
    targetTotalCarbs,
    "simple",
    normalizedInput,
    maxDrinkPortions,
  );
  const plans = dedupePlans(
    (customPlan
      ? [customPlan, budgetPlan, mixedPlan, ratioPlan, simplePlan]
      : [mixedPlan, budgetPlan, ratioPlan, simplePlan]
    ).filter((plan): plan is EffortAdvisorPlan => plan !== null),
  ).slice(0, 4);
  const primaryPlan = plans[0] ?? {
    title: "Aucun plan",
    summary: "",
    totalCarbs: 0,
    totalCost: 0,
    items: [],
  };
  const warnings = buildAdvisorWarnings(
    normalizedInput,
    primaryPlan,
    targetTotalCarbs,
    carbProfile,
  );
  const strategyNotes = buildStrategyNotes(
    normalizedInput,
    primaryPlan,
    durationHours,
    targetCarbsPerHour,
  );
  const executionPlan = buildExecutionPlan(
    normalizedInput,
    primaryPlan,
    targetCarbsPerHour,
    durationMinutes,
  );
  const preRaceChecklist = buildPreRaceChecklist(
    normalizedInput,
    primaryPlan,
    targetCarbsPerHour,
  );

  return {
    durationMinutes,
    durationHours,
    targetCarbsPerHour,
    maxDrinkPortionsPerHour: input.maxDrinkPortionsPerHour ?? DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
    requestedTargetCarbsPerHour,
    targetTotalCarbs,
    context,
    gutTrainingStatus,
    sport,
    intensity,
    heat,
    aidStations,
    recommendationTier: carbProfile.tier,
    recommendedCarbsPerHourRange: {
      min: carbProfile.min,
      max: carbProfile.max,
    },
    assumptions,
    warnings,
    strategyNotes,
    executionPlan,
    preRaceChecklist,
    plans,
    answer: formatAdvisorAnswer(
      targetTotalCarbs,
      targetCarbsPerHour,
      durationHours,
      plans,
      context,
      carbProfile,
      sport,
      intensity,
    ),
  };
}

function getAdvisorProducts(input: EffortAdvisorInput) {
  const preferredTypes = input.preferredTypes ?? [];
  const hasRequestedComposition =
    Object.keys(normalizeTypeCounts(input.desiredTypeCounts)).length > 0;

  const candidates = getProducts(input.targetCarbsPerHour)
    .filter((product) => {
      if (!isAutomaticRecommendationCandidate(product, input)) {
        return false;
      }

      if (
        preferredTypes.length > 0 &&
        !hasRequestedComposition &&
        !preferredTypes.includes(product.type)
      ) {
        return false;
      }

      if (input.caffeine === "avoid" && /caf|caffeine|caféine/i.test(product.name)) {
        return false;
      }

      return getOfferVerificationStatus(product.cheapestOffer) !== "review";
    })
    .sort((a, b) => b.carbsPerDollar - a.carbsPerDollar);

  return candidates;
}

function buildSingleProductPlan(
  title: string,
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  mode: EffortPreference,
  input: EffortAdvisorInput,
  maxDrinkPortions: number,
): EffortAdvisorPlan {
  const ranked = rankProducts(products, targetTotalCarbs, mode, input);
  const product = ranked[0] ?? products[0];

  return buildPlanFromSelections(
    title,
    targetTotalCarbs,
    product ? [{ product }] : [],
    maxDrinkPortions,
    input,
  );
}

function buildMixedPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
  maxDrinkPortions: number,
): EffortAdvisorPlan {
  const candidatePool = buildMixedCandidatePool(products, targetTotalCarbs, input);
  const candidateSelectionSets = buildSelectionSets(candidatePool);
  const fallbackPlan = buildPlanFromSelections(
    "Option mixte",
    targetTotalCarbs,
    candidatePool.slice(0, 3).map((product) => ({ product })),
    maxDrinkPortions,
    input,
  );

  return candidateSelectionSets.reduce<EffortAdvisorPlan>((bestPlan, selectionSet) => {
    const nextPlan = buildPlanFromSelections(
      "Option mixte",
      targetTotalCarbs,
      selectionSet.map((product) => ({ product })),
      maxDrinkPortions,
      input,
    );

    return scorePlan(nextPlan, targetTotalCarbs, input) <
      scorePlan(bestPlan, targetTotalCarbs, input)
      ? nextPlan
      : bestPlan;
  }, fallbackPlan);
}

function buildRequestedCompositionPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
  maxDrinkPortions: number,
): EffortAdvisorPlan | null {
  const counts = normalizeTypeCounts(input.desiredTypeCounts);
  const hasCounts = Object.keys(counts).length > 0;

  if (!hasCounts) {
    return null;
  }

  const selections: AdvisorSelection[] = [];

  for (const type of PRODUCT_TYPES) {
    const requestedPortions = counts[type];
    if (!Number.isFinite(requestedPortions)) {
      continue;
    }

    const requestedCount = requestedPortions ?? 0;

    if (requestedCount <= 0) {
      continue;
    }

    const product = selectProductForType(
      products,
      type,
      targetTotalCarbs,
      input,
      input.preference ?? "best-value",
    );

    if (product) {
      selections.push({
        product,
        portions: clampRequestedPortions(
          product,
          requestedCount,
          maxDrinkPortions,
          input,
        ),
      });
    }
  }

  const fixedCarbs = selections.reduce(
    (sum, selection) => sum + selection.product.carbsGrams * (selection.portions ?? 0),
    0,
  );
  const preferredTypes = input.preferredTypes ?? [];
  const autoTypes = (preferredTypes.length > 0 ? preferredTypes : PRODUCT_TYPES)
    .filter((type) => counts[type] === undefined);

  if (fixedCarbs < targetTotalCarbs && autoTypes.length > 0) {
    const rankedProducts = rankProducts(
      products.filter((product) => autoTypes.includes(product.type)),
      targetTotalCarbs - fixedCarbs,
      input.preference ?? "best-value",
      input,
    );

    for (const product of rankedProducts) {
      if (selections.length >= 4) {
        break;
      }

      if (selections.some((selection) => selection.product.id === product.id)) {
        continue;
      }

      if (!canAddProductToPlan(selections.map((selection) => selection.product), product)) {
        continue;
      }

      selections.push({ product });
    }
  }

  return buildPlanFromSelections(
    "Option personnalisée",
    targetTotalCarbs,
    selections,
    maxDrinkPortions,
    input,
  );
}

function buildPlanFromSelections(
  title: string,
  targetTotalCarbs: number,
  selections: AdvisorSelection[],
  maxDrinkPortions: number,
  input: EffortAdvisorInput,
): EffortAdvisorPlan {
  if (selections.length === 0) {
    return {
      title,
      summary: "Aucun produit fiable ne correspond à cette demande.",
      totalCarbs: 0,
      totalCost: 0,
      items: [],
    };
  }

  const durationHours = round(input.durationMinutes / 60);
  const portionPlan = allocatePlanPortions(
    selections,
    targetTotalCarbs,
    maxDrinkPortions,
    durationHours,
    input,
  );
  const items = portionPlan
    .filter((entry) => entry.portions > 0)
    .map((entry) => buildAdvisorItem(entry.product, entry.portions));
  const totalCarbs = round(items.reduce((sum, item) => sum + item.totalCarbs, 0));
  const totalCost = round(items.reduce((sum, item) => sum + item.totalCost, 0));

  return {
    title,
    summary: describePlanFit(totalCarbs, targetTotalCarbs, items, durationHours),
    totalCarbs,
    totalCost,
    items,
  };
}

function buildAdvisorItem(
  product: ProductWithMetrics,
  portions: number,
): EffortAdvisorItem {
  const offer = product.cheapestOffer;

  return {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    type: product.type,
    seller: offer.seller,
    productUrl: offer.productUrl,
    portions,
    carbsPerPortion: product.carbsGrams,
    totalCarbs: round(product.carbsGrams * portions),
    unitPrice: offer.price,
    totalCost: round(offer.price * portions),
    waterMl:
      product.type === "Boisson"
        ? estimateDrinkWaterMl(product, portions)
        : undefined,
    packagePrice: offer.packagePrice,
    unitCount: offer.unitCount,
    verificationLabel: offer.verificationLabel ?? "Prix vérifié",
  };
}

function estimateTotalCost(product: ProductWithMetrics, targetTotalCarbs: number) {
  return estimatePortions(product, targetTotalCarbs) * product.cheapestOffer.price;
}

function estimatePortions(product: ProductWithMetrics, targetTotalCarbs: number) {
  return estimatePortionsForCarbs(product, targetTotalCarbs);
}

function estimatePortionsForCarbs(
  product: ProductWithMetrics,
  targetCarbs: number,
  maxDrinkPortions = Infinity,
  durationHours = 1,
  context: EffortContext = "neutral",
  targetCarbsPerHour = DEFAULT_TARGET_CARBS,
) {
  const step = product.type === "Boisson" || product.type === "Barre" ? 0.5 : 1;
  const portions = Math.max(step, Math.ceil(targetCarbs / product.carbsGrams / step) * step);
  return clampPortionsForPracticality(
    product,
    portions,
    maxDrinkPortions,
    durationHours,
    context,
    targetCarbsPerHour,
  );
}

function clampRequestedPortions(
  product: ProductWithMetrics,
  requestedPortions: number,
  maxDrinkPortions: number,
  input: EffortAdvisorInput,
) {
  return clampPortionsForPracticality(
    product,
    requestedPortions,
    maxDrinkPortions,
    round(input.durationMinutes / 60),
    input.context ?? "neutral",
    input.targetCarbsPerHour,
  );
}

function getMaxDrinkPortionsForDuration(
  input: EffortAdvisorInput,
  durationHours: number,
) {
  const perHour = clamp(
    input.maxDrinkPortionsPerHour ?? DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR,
    0,
    6,
  );
  return round(perHour * durationHours);
}

function rankProducts(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  mode: EffortPreference,
  input: EffortAdvisorInput,
) {
  return [...products].sort((a, b) => {
    const practicalityDifference =
      getPracticalityPenalty(a, targetTotalCarbs, input) -
      getPracticalityPenalty(b, targetTotalCarbs, input);
    if (practicalityDifference !== 0) {
      return practicalityDifference;
    }

    const suitabilityDifference =
      getFuelFormPenalty(a, input) - getFuelFormPenalty(b, input);
    if (suitabilityDifference !== 0) {
      return suitabilityDifference;
    }

    const concentrationDifference =
      getServingConcentrationPenalty(a, targetTotalCarbs, input) -
      getServingConcentrationPenalty(b, targetTotalCarbs, input);
    if (concentrationDifference !== 0) {
      return concentrationDifference;
    }

    const brandDifference =
      getBrandPreferencePenalty(a, input) - getBrandPreferencePenalty(b, input);
    if (brandDifference !== 0) {
      return brandDifference;
    }

    if (mode === "lowest-cost") {
      return estimateTotalCost(a, targetTotalCarbs) - estimateTotalCost(b, targetTotalCarbs);
    }

    if (mode === "simple") {
      const portionDifference =
        estimatePortions(a, targetTotalCarbs) - estimatePortions(b, targetTotalCarbs);
      if (portionDifference !== 0) {
        return portionDifference;
      }

      return b.carbsGrams - a.carbsGrams;
    }

    return b.carbsPerDollar - a.carbsPerDollar;
  });
}

function getBrandPreferencePenalty(
  product: ProductWithMetrics,
  input: EffortAdvisorInput,
) {
  const preferredBrand = input.typeBrandPreferences?.[product.type];
  return preferredBrand && product.brand !== preferredBrand ? 1 : 0;
}

function parsePreferredTypes(question: string) {
  const normalizedQuestion = normalizeQuestion(question);
  const explicitTypes = TYPE_KEYWORDS
    .filter(([type, pattern]) => {
      if (isTypeExcluded(question, type)) {
        return false;
      }

      return pattern.test(normalizedQuestion);
    })
    .map(([type]) => type);

  return [...new Set(explicitTypes)];
}

function isTypeExcluded(question: string, type: ProductType) {
  const labels: Record<ProductType, string[]> = {
    Gel: ["gel", "gels"],
    Boisson: ["boisson", "boissons", "liquide", "liquides", "drink", "drinks", "mix", "poudre", "poudres", "bouteille", "bouteilles", "bidon", "bidons"],
    Barre: ["barre", "barres", "bar", "bars", "solide", "solides"],
    Autre: ["chew", "chews", "gomme", "gommes", "gummies", "bonbon", "bonbons", "autre", "autres"],
  };
  const labelPattern = labels[type].join("|");
  const normalizedQuestion = normalizeQuestion(question);
  const negativePattern = new RegExp(
    `\\b(?:sans|pas\\s+de|pas\\s+d|aucun|aucune|zero|0|exclure|eviter|evite|retire|enleve|pas)\\s+(?:${labelPattern})\\b`,
    "i",
  );

  return negativePattern.test(normalizedQuestion);
}

function selectProductForType(
  products: ProductWithMetrics[],
  type: ProductType,
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
  mode: EffortPreference,
) {
  const typeProducts = products.filter((product) => product.type === type);
  return rankProducts(typeProducts, targetTotalCarbs, mode, input)[0] ?? null;
}

function canAddProductToPlan(
  selections: ProductWithMetrics[],
  candidate: ProductWithMetrics,
) {
  const sameTypeProducts = selections.filter(
    (selection) => selection.type === candidate.type,
  );

  if (sameTypeProducts.length === 0) {
    return true;
  }

  if (candidate.type !== "Boisson") {
    return false;
  }

  const neutralDrinkCount = sameTypeProducts.filter(isNeutralCarbAdditive).length;
  const regularDrinkCount = sameTypeProducts.length - neutralDrinkCount;

  if (isNeutralCarbAdditive(candidate)) {
    return neutralDrinkCount === 0;
  }

  return regularDrinkCount === 0;
}

function isNeutralCarbAdditive(product: ProductWithMetrics) {
  const label = `${product.brand} ${product.name}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  return /(?:upika.*carb-?boost|naak.*boost drink mix)/i.test(label);
}

function parseDurationMinutes(question: string) {
  const normalizedQuestion = normalizeQuestion(question);
  const colonDuration = normalizedQuestion.match(/\b(\d{1,2})\s*[:]\s*(\d{1,2})\b/);
  if (colonDuration) {
    return Number.parseInt(colonDuration[1], 10) * 60 +
      Number.parseInt(colonDuration[2], 10);
  }

  const compactDuration = normalizedQuestion.match(/\b(\d{1,2})h(\d{1,2})\b/i);
  if (compactDuration) {
    return Number.parseInt(compactDuration[1], 10) * 60 +
      Number.parseInt(compactDuration[2], 10);
  }

  const hoursMinutes = normalizedQuestion.match(
    new RegExp(
      `\\b(${NUMBER_TOKEN})\\s*(?:h|hr|hrs|heure|heures)\\s*(?:et\\s*)?(demie|demi|quart|trois\\s+quart|${NUMBER_TOKEN})?\\s*(?:min|mins|minute|minutes)?\\b`,
      "i",
    ),
  );
  if (hoursMinutes) {
    const hours = parseFlexibleNumber(hoursMinutes[1]) ?? 0;
    const rawMinutes = hoursMinutes[2];
    const minutes = parseDurationMinuteSuffix(rawMinutes);
    return Math.round(hours * 60 + minutes);
  }

  const plainHours = normalizedQuestion.match(
    new RegExp(`\\b(?:pendant|duree|sortie|ride|course|entrainement|effort)?\\s*(${NUMBER_TOKEN})\\s*(?:h|hr|hrs|heure|heures)\\b`, "i"),
  );
  if (plainHours) {
    const hours = parseFlexibleNumber(plainHours[1]);
    if (hours !== null) {
      return Math.round(hours * 60);
    }
  }

  const minutes = normalizedQuestion.match(
    new RegExp(`\\b(${NUMBER_TOKEN})\\s*(?:min|mins|minute|minutes)\\b`, "i"),
  );
  if (minutes) {
    const parsedMinutes = parseFlexibleNumber(minutes[1]);
    return parsedMinutes === null ? null : Math.round(parsedMinutes);
  }

  return null;
}

function parseCarbsPerHour(question: string, durationMinutes: number | null = null) {
  const normalizedQuestion = normalizeQuestion(question);
  const hourlyRange = normalizedQuestion.match(
    /\b(\d{2,3})\s*(?:-|a|à|to)\s*(\d{2,3})\s*(?:g|grammes?|glucides?|carbs?)\s*(?:\/\s*h|par\s*(?:heure|h)|a\s+l[' ]?heure|heure|h\b)/i,
  );
  if (hourlyRange) {
    return Math.round(
      (Number.parseInt(hourlyRange[1], 10) + Number.parseInt(hourlyRange[2], 10)) / 2,
    );
  }

  const hourlyMatch = normalizedQuestion.match(
    /\b(\d{2,3})\s*(?:g|grammes?|gr|glucides?|carbs?)\s*(?:\/\s*h|par\s*(?:heure|h)|a\s+l[' ]?heure|a\s+lheure|heure|h\b|chaque\s+heure)\b/i,
  );
  if (hourlyMatch) {
    return Number.parseInt(hourlyMatch[1], 10);
  }

  const reversedHourlyMatch = normalizedQuestion.match(
    /\b(?:par\s*(?:heure|h)|a\s+l[' ]?heure|a\s+lheure|chaque\s+heure)\D{0,20}(\d{2,3})\s*(?:g|grammes?|gr|glucides?|carbs?)?\b/i,
  );
  if (reversedHourlyMatch) {
    return Number.parseInt(reversedHourlyMatch[1], 10);
  }

  const contextMatch = normalizedQuestion.match(
    /\b(?:cible|objectif|vise|viser|veux|voudrais|prendre|absorber|manger|boire|besoin|plan|glucides?|carbs?|hydrates?)\D{0,36}(\d{2,3})\s*(?:g|grammes?|gr|glucides?|carbs?)?\b/i,
  );
  if (contextMatch) {
    return Number.parseInt(contextMatch[1], 10);
  }

  const totalMatch = normalizedQuestion.match(
    /\b(?:total|en\s+tout|sur\s+la\s+sortie|pour\s+l[' ]?effort|pendant\s+l[' ]?effort)\D{0,28}(\d{2,4})\s*(?:g|grammes?|gr|glucides?|carbs?)\b/i,
  );
  if (totalMatch && durationMinutes) {
    return Math.round(Number.parseInt(totalMatch[1], 10) / (durationMinutes / 60));
  }

  return null;
}

function parsePreference(question: string): EffortPreference {
  if (/\b(budget|pas cher|moins cher|minimum)\b/i.test(question)) {
    return "lowest-cost";
  }

  if (/\b(simple|facile|moins de produits)\b/i.test(question)) {
    return "simple";
  }

  if (/\b(mix|mixte|varié|varie)\b/i.test(question)) {
    return "mixed";
  }

  return "best-value";
}

function parseEffortContext(question: string): EffortContext | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(course|competition|compete|marathon|semi|half|triathlon|ironman|epreuve|epreuve|race day)\b/i.test(normalizedQuestion)) {
    return "race";
  }

  if (/\b(entrainement|training|sortie|long run|longue sortie|brick|tempo|seance|session|ride)\b/i.test(normalizedQuestion)) {
    return "training";
  }

  return null;
}

function parseGutTrainingStatus(question: string): GutTrainingStatus | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(gut train|gut-trained|entraine le tube digestif|entraine l intestin|deja teste|deja pratique|habitue a 90|habitue a 100|habitue a 120|tolere bien)\b/i.test(normalizedQuestion)) {
    return "gut-trained";
  }

  return null;
}

function parseSportProfile(question: string): SportProfile | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(trail|ultra trail|sentier|montagne)\b/i.test(normalizedQuestion)) {
    return "trail";
  }

  if (/\b(velo|bike|cycling|cyclisme|ride|gravel)\b/i.test(normalizedQuestion)) {
    return "cycling";
  }

  if (/\b(triathlon|half ironman|ironman|70\.3)\b/i.test(normalizedQuestion)) {
    return "triathlon";
  }

  if (/\b(course a pied|running|run|marathon|semi|10k|5k)\b/i.test(normalizedQuestion)) {
    return "running";
  }

  return null;
}

function parseIntensityLevel(question: string): IntensityLevel | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(facile|easy|endurance fondamentale|recovery|recup)\b/i.test(normalizedQuestion)) {
    return "easy";
  }

  if (/\b(tempo|seuil|hard|dur|intense|fractionne|intervalles)\b/i.test(normalizedQuestion)) {
    return "hard";
  }

  if (/\b(allure course|race pace|competition|race day|objectif chrono)\b/i.test(normalizedQuestion)) {
    return "race-pace";
  }

  if (/\b(steady|regulier|continu|sortie longue)\b/i.test(normalizedQuestion)) {
    return "steady";
  }

  return null;
}

function parseHeatProfile(question: string): HeatProfile | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(chaud|canicule|hot|humid|humide|soleil|heat)\b/i.test(normalizedQuestion)) {
    return "hot";
  }

  if (/\b(frais|cool|cold|cold weather|froi[dt])\b/i.test(normalizedQuestion)) {
    return "cool";
  }

  return null;
}

function parseAidStations(question: string): AidStationAccess | null {
  const normalizedQuestion = normalizeQuestion(question);

  if (/\b(sans ravito|self supported|autonomie|autonome|pas de ravito)\b/i.test(normalizedQuestion)) {
    return "self-supported";
  }

  if (/\b(ravitos frequents|frequent aid|souvent|beaucoup de ravitos)\b/i.test(normalizedQuestion)) {
    return "frequent";
  }

  if (/\b(ravito|aid station|points d eau|points d'eau)\b/i.test(normalizedQuestion)) {
    return "regular";
  }

  return null;
}

function parseDesiredTypeCounts(question: string) {
  const normalizedQuestion = normalizeQuestion(question);
  const counts: Partial<Record<ProductType, number>> = {};
  const patterns: Array<[ProductType, RegExp[]]> = [
    [
      "Gel",
      [
        new RegExp(`\\b(?:x\\s*)?(${NUMBER_TOKEN})\\s*(?:gels?)\\b`, "i"),
        new RegExp(`\\b(?:gels?)\\s*(?:x|fois|de)?\\s*(${NUMBER_TOKEN})\\b`, "i"),
      ],
    ],
    [
      "Boisson",
      [
        new RegExp(`\\b(?:x\\s*)?(${NUMBER_TOKEN})\\s*(?:boissons?|bouteilles?|drinks?|mix|bidons?|flasques?)\\b`, "i"),
        new RegExp(`\\b(?:boissons?|bouteilles?|drinks?|mix|bidons?|flasques?)\\s*(?:x|fois|de)?\\s*(${NUMBER_TOKEN})\\b`, "i"),
      ],
    ],
    [
      "Barre",
      [
        new RegExp(`\\b(?:x\\s*)?(${NUMBER_TOKEN})\\s*(?:barres?|bars?)\\b`, "i"),
        new RegExp(`\\b(?:barres?|bars?)\\s*(?:x|fois|de)?\\s*(${NUMBER_TOKEN})\\b`, "i"),
      ],
    ],
    [
      "Autre",
      [
        new RegExp(`\\b(?:x\\s*)?(${NUMBER_TOKEN})\\s*(?:autres?|chews?|gommes?|gummies|bonbons?)\\b`, "i"),
        new RegExp(`\\b(?:autres?|chews?|gommes?|gummies|bonbons?)\\s*(?:x|fois|de)?\\s*(${NUMBER_TOKEN})\\b`, "i"),
      ],
    ],
  ];

  for (const [type, typePatterns] of patterns) {
    if (isTypeExcluded(question, type)) {
      counts[type] = 0;
      continue;
    }

    for (const pattern of typePatterns) {
      const match = normalizedQuestion.match(pattern);
      if (!match) {
        continue;
      }

      const parsedCount = parseFlexibleNumber(match[1]);
      if (parsedCount !== null) {
        counts[type] = clamp(Math.round(parsedCount), 0, 12);
        break;
      }
    }
  }

  return counts;
}

function parseMaxDrinkPortionsPerHour(question: string) {
  const normalizedQuestion = normalizeQuestion(question);
  const match = normalizedQuestion.match(
    new RegExp(
      `\\b(?:max|maxi|maximum|limite|limiter)\\s*(?:a|à)?\\s*(${NUMBER_TOKEN})\\s*(?:portions?\\s*)?(?:de\\s*)?(?:boissons?|bouteilles?|bidons?|drink|drinks|mix)\\s*(?:\\/\\s*h|par\\s*(?:heure|h)|a\\s+l[' ]?heure|heure|h)\\b`,
      "i",
    ),
  );

  if (!match) {
    return null;
  }

  const parsed = parseFlexibleNumber(match[1]);
  return parsed === null ? null : clamp(parsed, 0, 6);
}

function formatMissingInfoPrompt(missingInfo: MissingAdvisorInfo[]) {
  const details = missingInfo.map((entry) => {
    if (entry === "duration") {
      return "la durée de l'effort";
    }

    if (entry === "targetCarbsPerHour") {
      return "la cible de glucides par heure";
    }

    return "le type de produit souhaité";
  });

  return [
    "Il me manque quelques détails pour générer un plan utile.",
    `Précise ${formatList(details)}, par exemple: “3 h, 80 g/h, gels et boisson, sans caféine”.`,
  ].join(" ");
}

function formatList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

function normalizeTypeCounts(
  counts: EffortAdvisorInput["desiredTypeCounts"],
) {
  const normalized: Partial<Record<ProductType, number>> = {};

  for (const type of PRODUCT_TYPES) {
    const count = counts?.[type];
    if (count === undefined || !Number.isFinite(count)) {
      continue;
    }

    normalized[type] = clamp(Math.round(count), 0, 12);
  }

  return normalized;
}

function buildAssumptions(
  input: EffortAdvisorInput,
  durationMinutes: number,
  targetCarbsPerHour: number,
  requestedTargetCarbsPerHour: number,
  carbProfile: CarbRecommendationProfile,
) {
  const assumptions = [
    `Durée: ${formatDuration(durationMinutes)}.`,
    `Cible: ${targetCarbsPerHour} g de glucides par heure.`,
    `Sport: ${formatSportProfile(input.sport ?? "neutral")} · Intensité: ${formatIntensity(input.intensity ?? "steady")} · Température: ${formatHeatProfile(input.heat ?? "mild")}.`,
    `Boisson limitée à ${formatNumber(input.maxDrinkPortionsPerHour ?? DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR)} portions/h, avec un maximum de ${DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE} portions par bidon de ${DRINK_BOTTLE_ML} ml, et souvent seulement 1 portion par bidon pour les mixes déjà très concentrés.`,
    carbProfile.note,
  ];

  if (requestedTargetCarbsPerHour !== targetCarbsPerHour) {
    assumptions.push(
      `La cible demandée (${requestedTargetCarbsPerHour} g/h) a été ramenée à ${targetCarbsPerHour} g/h pour rester dans une plage réaliste pour ce contexte.`,
    );
  }

  if ((input.context ?? "neutral") === "race") {
    assumptions.push("Contexte interprété comme course: le moteur favorise davantage les formats faciles à consommer en mouvement.");
  } else if ((input.context ?? "neutral") === "training") {
    assumptions.push("Contexte interprété comme entraînement: le moteur garde une marge plus conservatrice sur l'apport horaire élevé.");
  }

  if ((input.gutTrainingStatus ?? "standard") === "gut-trained") {
    assumptions.push("Tolérance digestive avancée présumée: les apports élevés sont davantage acceptés, mais restent pénalisés s'ils deviennent peu réalistes en pratique.");
  } else {
    assumptions.push("Sans indication de gut training, les stratégies très élevées en glucides sont limitées pour rester réalistes.");
  }

  if ((input.aidStations ?? "regular") === "self-supported") {
    assumptions.push("Logistique en autonomie: le moteur pénalise davantage les plans trop fragmentés ou difficiles à transporter.");
  } else if ((input.aidStations ?? "regular") === "frequent") {
    assumptions.push("Ravitos fréquents: les recharges liquides sont un peu plus acceptables qu'en autonomie complète.");
  }

  if (input.caffeine === "avoid") {
    assumptions.push("Caféine évitée quand le nom du produit l'indique.");
  }

  if (input.preferredTypes && input.preferredTypes.length > 0) {
    assumptions.push(`Types privilégiés: ${input.preferredTypes.join(", ")}.`);
  }

  const counts = normalizeTypeCounts(input.desiredTypeCounts);
  const countLabels = PRODUCT_TYPES
    .filter((type) => counts[type] !== undefined)
    .map((type) => `${counts[type]} ${type.toLowerCase()}${(counts[type] ?? 0) > 1 ? "s" : ""}`);
  if (countLabels.length > 0) {
    assumptions.push(`Portions demandées: ${countLabels.join(", ")}.`);
  }

  const brandLabels = PRODUCT_TYPES
    .filter((type) => input.typeBrandPreferences?.[type])
    .map((type) => `${type}: ${input.typeBrandPreferences?.[type]}`);
  if (brandLabels.length > 0) {
    assumptions.push(`Marques préférées: ${brandLabels.join(", ")}.`);
  }

  return assumptions;
}

function formatAdvisorAnswer(
  targetTotalCarbs: number,
  targetCarbsPerHour: number,
  durationHours: number,
  plans: EffortAdvisorPlan[],
  context: EffortContext,
  carbProfile: CarbRecommendationProfile,
  sport: SportProfile,
  intensity: IntensityLevel,
) {
  const bestPlan = plans[0];
  if (!bestPlan || bestPlan.items.length === 0) {
    return "Aucun plan n'est disponible avec les critères actuels.";
  }

  const firstItem = bestPlan.items[0];
  const base = `Pour ${durationHours.toString().replace(".", ",")} h à ${targetCarbsPerHour} g/h, vise environ ${targetTotalCarbs} g de glucides.`;
  const pacing = `Repère pratique: environ ${formatNumber(round(targetCarbsPerHour / 3))} g toutes les 20 minutes.`;
  const contextLine =
    context === "race"
      ? `Plage réaliste d'après la littérature pour ce contexte: ${carbProfile.min}-${carbProfile.max} g/h.`
      : `Plage pratique d'après la littérature pour cette durée: ${carbProfile.min}-${carbProfile.max} g/h.`;
  const framing = `Lecture terrain: ${formatSportProfile(sport)}, intensité ${formatIntensity(intensity).toLowerCase()}.`;

  if (bestPlan.items.length > 1) {
    return [
      base,
      contextLine,
      framing,
      pacing,
      `Le plan recommandé combine ${formatPlanItems(bestPlan.items)} pour ${formatNumber(bestPlan.totalCarbs)} g, environ ${formatMoney(bestPlan.totalCost)} $.`,
      `Détaillants recommandés: ${formatSellers(bestPlan.items)}.`,
    ].join("\n\n");
  }

  return [
    base,
    contextLine,
    framing,
    pacing,
    `Le meilleur départ est ${firstItem.brand} ${firstItem.name}: ${formatPortions(firstItem.portions)}, ${formatNumber(firstItem.totalCarbs)} g, environ ${formatMoney(firstItem.totalCost)} $.`,
    `Détaillant recommandé: ${firstItem.seller}.`,
  ].join("\n\n");
}

function describePlanFit(
  totalCarbs: number,
  targetTotalCarbs: number,
  items: EffortAdvisorItem[],
  durationHours: number,
) {
  const difference = round(totalCarbs - targetTotalCarbs);
  const rhythm = describePlanRhythm(items, durationHours);
  if (difference === 0) {
    return rhythm
      ? `Atteint exactement la cible de glucides. ${rhythm}`
      : "Atteint exactement la cible de glucides.";
  }

  if (difference > 0) {
    return rhythm
      ? `Dépasse la cible de ${difference} g. ${rhythm}`
      : `Dépasse la cible de ${difference} g.`;
  }

  return rhythm
    ? `Reste ${Math.abs(difference)} g sous la cible. ${rhythm}`
    : `Reste ${Math.abs(difference)} g sous la cible.`;
}

function dedupePlans(plans: EffortAdvisorPlan[]) {
  return plans.filter((plan, index, allPlans) => {
    const signature = plan.items
      .map((item) => `${item.productId}:${item.portions}`)
      .join("|");
    return index === allPlans.findIndex((entry) =>
      entry.items.map((item) => `${item.productId}:${item.portions}`).join("|") === signature,
    );
  });
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${remainingMinutes} min`;
}

function formatPortions(value: number) {
  const label = formatNumber(value);
  return `${label} portion${value > 1 ? "s" : ""}`;
}

function formatNumber(value: number) {
  return value.toString().replace(".", ",");
}

function formatMoney(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function formatPlanItems(items: EffortAdvisorItem[]) {
  return items
    .map((item) => {
      const waterNote = item.waterMl ? ` dans environ ${item.waterMl} ml d'eau` : "";
      return `${formatPortions(item.portions)} de ${item.brand} ${item.name}${waterNote}`;
    })
    .join(", ");
}

function estimateDrinkWaterMl(
  product: ProductWithMetrics,
  portions: number,
) {
  const bottlesNeeded = Math.ceil(
    portions / getMaxDrinkPortionsPerBottle(product),
  );
  return bottlesNeeded * DRINK_BOTTLE_ML;
}

function formatSellers(items: EffortAdvisorItem[]) {
  return [...new Set(items.map((item) => item.seller))].join(", ");
}

function formatSportProfile(sport: SportProfile) {
  if (sport === "running") {
    return "course à pied";
  }

  if (sport === "cycling") {
    return "vélo";
  }

  if (sport === "trail") {
    return "trail";
  }

  if (sport === "triathlon") {
    return "triathlon";
  }

  return "endurance générale";
}

function formatIntensity(intensity: IntensityLevel) {
  if (intensity === "easy") {
    return "facile";
  }

  if (intensity === "steady") {
    return "régulière";
  }

  if (intensity === "hard") {
    return "soutenue";
  }

  return "allure course";
}

function formatHeatProfile(heat: HeatProfile) {
  if (heat === "cool") {
    return "fraîche";
  }

  if (heat === "hot") {
    return "chaude";
  }

  return "tempérée";
}

function formatAidStations(aidStations: AidStationAccess) {
  if (aidStations === "self-supported") {
    return "autonomie complète";
  }

  if (aidStations === "frequent") {
    return "ravitos fréquents";
  }

  return "ravitos réguliers";
}

function describePlanRhythm(
  items: EffortAdvisorItem[],
  durationHours: number,
) {
  if (items.length === 0 || durationHours <= 0) {
    return "";
  }

  const rhythmNotes = items.map((item) => {
    const portionsPerHour = round(item.portions / durationHours);
    if (item.type === "Boisson") {
      const minutesBetween = Math.max(
        20,
        Math.round((durationHours * 60) / item.portions / 5) * 5,
      );
      return `1 portion de boisson toutes les ${minutesBetween} min`;
    }

    if (item.portions < 1) {
      return `${formatNumber(item.portions)} portion de ${item.type.toLowerCase()} sur l'effort`;
    }

    const minutesBetween = Math.max(
      15,
      Math.round((durationHours * 60) / item.portions / 5) * 5,
    );
    return `1 ${item.type.toLowerCase()} toutes les ${minutesBetween} min`;
  });

  return `Rythme indicatif: ${rhythmNotes.join(" + ")}.`;
}

function buildAdvisorWarnings(
  input: EffortAdvisorInput,
  plan: EffortAdvisorPlan,
  targetTotalCarbs: number,
  carbProfile: CarbRecommendationProfile,
) {
  const warnings: string[] = [];
  const difference = plan.totalCarbs - targetTotalCarbs;
  const drinkItems = plan.items.filter((item) => item.type === "Boisson");
  const nonDrinkItems = plan.items.filter((item) => item.type !== "Boisson");
  const durationHours = Math.max(1, round(input.durationMinutes / 60));

  if (difference > Math.max(20, Math.round(targetTotalCarbs * 0.12))) {
    warnings.push("Le meilleur plan disponible dépasse sensiblement la cible. Mieux vaut réduire une prise ou choisir un format plus petit.");
  }

  if (difference < -Math.max(20, Math.round(targetTotalCarbs * 0.12))) {
    warnings.push("Le plan reste nettement sous la cible. Il est cohérent seulement si tu assumes volontairement une stratégie plus conservatrice.");
  }

  if (
    (input.sport ?? "neutral") === "running" &&
    input.targetCarbsPerHour >= 80 &&
    (input.gutTrainingStatus ?? "standard") !== "gut-trained"
  ) {
    warnings.push("En course à pied, 80 g/h ou plus sans gut training reste ambitieux. À réserver à des sorties déjà testées.");
  }

  if ((input.heat ?? "mild") === "hot" && nonDrinkItems.length > drinkItems.length) {
    warnings.push("Par temps chaud, le plan manque probablement de part liquide. Vérifie que l'hydratation réelle suit.");
  }

  if (
    (input.aidStations ?? "regular") === "self-supported" &&
    plan.items.reduce((sum, item) => sum + item.portions, 0) >= durationHours * 2.5
  ) {
    warnings.push("Plan assez chargé à transporter en autonomie complète. Vérifie le volume et l'accès réel aux produits pendant l'effort.");
  }

  if (
    (input.sport ?? "neutral") === "trail" &&
    (input.heat ?? "mild") === "hot" &&
    (input.aidStations ?? "regular") === "self-supported"
  ) {
    warnings.push("Trail chaud en autonomie: la stratégie doit rester simple, tolérable et facilement transportable. Évite de dépendre d'un protocole trop dense.");
  }

  if (carbProfile.tier === "advanced") {
    warnings.push("Stratégie avancée: elle doit être répétée à l'entraînement avant d'être utilisée en course.");
  }

  return warnings;
}

function buildStrategyNotes(
  input: EffortAdvisorInput,
  plan: EffortAdvisorPlan,
  durationHours: number,
  targetCarbsPerHour: number,
): EffortAdvisorStrategyNote[] {
  const notes: EffortAdvisorStrategyNote[] = [];
  const drinkCarbs = plan.items
    .filter((item) => item.type === "Boisson")
    .reduce((sum, item) => sum + item.totalCarbs, 0);
  const drinkShare = plan.totalCarbs > 0 ? drinkCarbs / plan.totalCarbs : 0;

  notes.push({
    title: "Niveau de risque",
    detail:
      targetCarbsPerHour >= 90
        ? "Apport élevé: le succès dépend surtout de la tolérance digestive, du fractionnement et de la dilution réelle."
        : targetCarbsPerHour >= 70
          ? "Apport soutenu mais courant en endurance longue si la prise est régulière."
          : "Apport modéré: généralement plus facile à tenir sans dérive digestive.",
  });

  notes.push({
    title: "Logique du plan",
    detail:
      drinkShare >= 0.7
        ? "Le plan est majoritairement liquide pour simplifier la digestion et stabiliser l'apport horaire."
        : drinkShare >= 0.35
          ? "Le plan mixe liquide et prises plus denses pour équilibrer confort digestif et logistique."
          : "Le plan repose surtout sur des prises unitaires. Il faut être discipliné sur le timing pour éviter les trous.",
  });

  notes.push({
    title: "Transport",
    detail: `Configuration pensée pour ${formatAidStations(input.aidStations ?? "regular")}, sur ${formatNumber(durationHours)} h d'effort.`,
  });

  if ((input.sport ?? "neutral") === "running" || (input.sport ?? "neutral") === "trail") {
    notes.push({
      title: "Spécificité terrain",
      detail:
        "En appuis répétés, les blocs très denses sont plus risqués. La priorité reste la régularité et des prises faciles à avaler.",
    });
  } else if ((input.sport ?? "neutral") === "cycling") {
    notes.push({
      title: "Spécificité terrain",
      detail:
        "À vélo, l'accès aux bidons rend les stratégies liquides plus réalistes, mais la dilution doit rester crédible sur chaque bidon.",
    });
  }

  return notes;
}

function buildExecutionPlan(
  input: EffortAdvisorInput,
  plan: EffortAdvisorPlan,
  targetCarbsPerHour: number,
  durationMinutes: number,
) {
  if (plan.items.length === 0) {
    return [];
  }

  const intervalMinutes = chooseExecutionInterval(targetCarbsPerHour, input);
  const steps: EffortAdvisorExecutionStep[] = [];
  const totalSlots = Math.max(1, Math.ceil(durationMinutes / intervalMinutes));
  const slotCarbsTarget = round(targetCarbsPerHour * (intervalMinutes / 60));
  const scheduledActions = schedulePlanActions(plan.items, totalSlots);

  for (let slot = 0; slot < totalSlots; slot += 1) {
    const minute = Math.min(durationMinutes, slot * intervalMinutes);
    const label =
      minute === 0
        ? "Départ"
        : `${Math.floor(minute / 60)} h ${String(minute % 60).padStart(2, "0")}`;
    const slotActions = scheduledActions[slot] ?? [];
    const actionParts = slotActions.map((action) =>
      formatExecutionAction(action.item, action.increment),
    );
    const carbsAllocated = round(
      slotActions.reduce(
        (sum, action) => sum + action.item.carbsPerPortion * action.increment,
        0,
      ),
    );

    steps.push({
      minute,
      label,
      carbsTarget: Math.max(slotCarbsTarget, carbsAllocated),
      action:
        actionParts.length > 0
          ? actionParts.join(" + ")
          : "Rythme stable, pas de prise supplémentaire sur ce créneau.",
      hydration: describeHydrationForStep(input, slotActions, intervalMinutes),
    });
  }

  return condenseExecutionPlan(steps);
}

function buildPreRaceChecklist(
  input: EffortAdvisorInput,
  plan: EffortAdvisorPlan,
  targetCarbsPerHour: number,
) {
  const checklist = [
    "Tester la stratégie complète au moins une fois sur une séance comparable avant la course.",
    "Préparer les portions dans l'ordre réel d'utilisation pour éviter les oublis.",
  ];

  if (plan.items.some((item) => item.type === "Boisson")) {
    checklist.push("Pré-mélanger les bidons et vérifier la concentration réelle de chaque boisson avant de partir.");
  }

  if ((input.heat ?? "mild") === "hot") {
    checklist.push("Prévoir plus d'eau que la base du plan si la chaleur ou l'humidité montent pendant l'effort.");
  }

  if ((input.aidStations ?? "regular") === "self-supported") {
    checklist.push("Vérifier que tout le volume prévu est transportable sans dépendre d'un ravito externe.");
  }

  if (
    targetCarbsPerHour >= 85 &&
    (input.gutTrainingStatus ?? "standard") !== "gut-trained"
  ) {
    checklist.push("Réduire légèrement la cible ou fractionner davantage si cette charge n'a jamais été tolérée à l'entraînement.");
  }

  return checklist;
}

function chooseExecutionInterval(
  targetCarbsPerHour: number,
  input: EffortAdvisorInput,
) {
  if ((input.sport ?? "neutral") === "running" || targetCarbsPerHour >= 85) {
    return 20;
  }

  if (targetCarbsPerHour >= 60) {
    return 30;
  }

  return 40;
}

function getExecutionPriority(item: EffortAdvisorItem) {
  if (item.type === "Boisson") {
    return 4;
  }

  if (item.type === "Gel") {
    return 3;
  }

  if (item.type === "Autre") {
    return 2;
  }

  return 1;
}

function getExecutionPortionIncrement(item: EffortAdvisorItem) {
  if (item.type === "Boisson") {
    return 0.5;
  }

  if (item.type === "Barre" || item.type === "Autre") {
    return 0.5;
  }

  return 1;
}

function formatExecutionAction(
  item: EffortAdvisorItem,
  increment: number,
) {
  const formattedIncrement = formatNumber(increment);
  if (increment >= 1) {
    return `${formattedIncrement} portion de ${item.brand} ${item.name}`;
  }

  return `${formattedIncrement} portion de ${item.brand} ${item.name}`;
}

function describeHydrationForStep(
  input: EffortAdvisorInput,
  slotActions: Array<{ item: EffortAdvisorItem; increment: number }>,
  intervalMinutes: number,
) {
  const drinkEntries = slotActions.filter((entry) => entry.item.type === "Boisson");
  if (drinkEntries.length === 0) {
    return intervalMinutes <= 20
      ? "Quelques gorgées d'eau selon la soif."
      : "Hydratation libre selon la soif et la température.";
  }

  if ((input.heat ?? "mild") === "hot") {
    return "Boire régulièrement, sans attendre la soif, surtout si la prise du créneau est dense.";
  }

  return "Associer la prise à quelques gorgées d'eau ou à la boisson prévue sur ce créneau.";
}

function schedulePlanActions(
  items: EffortAdvisorItem[],
  totalSlots: number,
) {
  const schedule = Array.from({ length: totalSlots }, () => [] as Array<{
    item: EffortAdvisorItem;
    increment: number;
  }>);

  const sortedItems = [...items].sort(
    (a, b) => getExecutionPriority(b) - getExecutionPriority(a),
  );

  for (const item of sortedItems) {
    const baseIncrement = getExecutionPortionIncrement(item);
    const increments: number[] = [];
    let remaining = item.portions;

    while (remaining > 0.01) {
      const nextIncrement =
        remaining >= baseIncrement ? baseIncrement : round(remaining);
      increments.push(nextIncrement);
      remaining = round(remaining - nextIncrement);
    }

    increments.forEach((increment, index) => {
      const preferredSlot =
        increments.length === 1
          ? Math.max(0, Math.floor(totalSlots / 2) - 1)
          : Math.min(
              totalSlots - 1,
              Math.max(
                0,
                Math.round(((index + 0.5) * totalSlots) / increments.length) - 1,
              ),
            );
      const slotIndex = findBestScheduleSlot(schedule, preferredSlot, item);
      schedule[slotIndex].push({ item, increment });
    });
  }

  return schedule;
}

function findBestScheduleSlot(
  schedule: Array<Array<{ item: EffortAdvisorItem; increment: number }>>,
  preferredSlot: number,
  item: EffortAdvisorItem,
) {
  let bestSlot = preferredSlot;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let slot = 0; slot < schedule.length; slot += 1) {
    const distancePenalty = Math.abs(slot - preferredSlot) * 3;
    const existingActions = schedule[slot] ?? [];
    const sameTypePenalty = existingActions.some(
      (action) => action.item.type === item.type,
    )
      ? 2
      : 0;
    const loadPenalty = existingActions.length * 4;
    const score = distancePenalty + sameTypePenalty + loadPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  }

  return bestSlot;
}

function condenseExecutionPlan(steps: EffortAdvisorExecutionStep[]) {
  return steps.filter((step, index) => {
    if (index === 0 || index === steps.length - 1) {
      return true;
    }

    return step.action !== steps[index - 1]?.action || index % 2 === 0;
  });
}

function normalizeQuestion(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFlexibleNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const normalized = normalizeQuestion(value);
  if (NUMBER_WORDS[normalized] !== undefined) {
    return NUMBER_WORDS[normalized];
  }

  if (normalized === "demi" || normalized === "demie") {
    return 0.5;
  }

  if (normalized === "quart") {
    return 0.25;
  }

  const parsed = Number.parseFloat(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDurationMinuteSuffix(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const normalized = normalizeQuestion(value);
  if (normalized === "demi" || normalized === "demie") {
    return 30;
  }

  if (normalized === "quart") {
    return 15;
  }

  if (normalized === "trois quart") {
    return 45;
  }

  const parsed = parseFlexibleNumber(normalized);
  if (parsed === null) {
    return 0;
  }

  return parsed <= 0.99 ? Math.round(parsed * 60) : Math.round(parsed);
}

function parseNumber(value: string) {
  const number = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function getCarbRecommendationProfile(
  durationMinutes: number,
  context: EffortContext,
  gutTrainingStatus: GutTrainingStatus,
  sport: SportProfile,
  intensity: IntensityLevel,
  heat: HeatProfile,
): CarbRecommendationProfile {
  const sportPenalty =
    sport === "running" ? 10 : sport === "trail" ? 7 : sport === "triathlon" ? 4 : 0;
  const intensityAdjustment =
    intensity === "easy" ? -5 : intensity === "hard" ? 5 : intensity === "race-pace" ? 8 : 0;
  const heatPenalty = heat === "hot" ? 8 : heat === "cool" ? 0 : 3;

  if (durationMinutes <= 75) {
    return {
      min: 0,
      max: Math.max(20, 30 - Math.round(sportPenalty / 2)),
      suggested: 20,
      tier: "conservative",
      note:
        "Référence littérature: sur les efforts courts, de petites quantités de glucides ou même une stratégie minimale peuvent suffire; un gros apport horaire n'est généralement pas nécessaire.",
    };
  }

  if (durationMinutes <= 150) {
    const adjustedMax = clamp(
      60 - sportPenalty + Math.max(0, intensityAdjustment - heatPenalty / 2),
      40,
      65,
    );
    return {
      min: 30,
      max: adjustedMax,
      suggested: clamp(adjustedMax - 10, 35, 55),
      tier: adjustedMax >= 55 ? "standard" : "conservative",
      note:
        "Référence littérature: pour environ 1-2,5 h, une plage de 30-60 g/h est la stratégie la plus classique et la plus réaliste.",
    };
  }

  if (durationMinutes <= 240) {
    const baselineMax = context === "race" ? 90 : 75;
    const adjustedMax = clamp(
      baselineMax - sportPenalty - Math.round(heatPenalty / 2) + intensityAdjustment,
      context === "race" ? 55 : 50,
      baselineMax,
    );
    return {
      min: 45,
      max: adjustedMax,
      suggested: clamp(adjustedMax - (context === "race" ? 10 : 12), 50, 78),
      tier: adjustedMax >= 80 ? "advanced" : "standard",
      note:
        context === "race"
          ? "Référence littérature: pour les efforts prolongés, 60-90 g/h devient réaliste en course, surtout avec des glucides multiples."
          : "Référence littérature: à l'entraînement long, rester autour de 45-75 g/h est souvent plus réaliste qu'un plafond directement poussé à 90 g/h.",
    };
  }

  const longFormMax =
    context === "race" && gutTrainingStatus === "gut-trained" ? 120 : 90;
  const adjustedLongMax = clamp(
    longFormMax - sportPenalty - Math.round(heatPenalty / 2) + intensityAdjustment,
    gutTrainingStatus === "gut-trained" ? 70 : 60,
    longFormMax,
  );
  return {
    min: 60,
    max: adjustedLongMax,
    suggested: clamp(
      adjustedLongMax -
        (context === "race" && gutTrainingStatus === "gut-trained" ? 18 : 15),
      65,
      95,
    ),
    tier:
      context === "race" && gutTrainingStatus === "gut-trained" && adjustedLongMax >= 95
        ? "advanced"
        : "standard",
    note:
      context === "race" && gutTrainingStatus === "gut-trained"
        ? "Référence littérature: sur les très longues courses, 90 g/h ou plus peut être toléré avec gut training; 120 g/h reste une stratégie avancée, pas un défaut."
        : "Référence littérature: sur les efforts très longs, 60-90 g/h est le plafond pratique le plus réaliste sans tolérance digestive spécifiquement entraînée.",
  };
}

function isAutomaticRecommendationCandidate(
  product: ProductWithMetrics,
  input: EffortAdvisorInput,
) {
  const label = `${product.brand} ${product.name}`.toLowerCase();
  const sport = input.sport ?? "neutral";
  const aidStations = input.aidStations ?? "regular";

  if (product.carbsGrams >= 150) {
    return false;
  }

  if (
    product.type === "Gel" &&
    (/\bflow\b|\bflask\b|\bbottle\b|\bpouch\b/.test(label) ||
      product.carbsGrams >= 120)
  ) {
    return false;
  }

  if (
    (input.context ?? "neutral") !== "race" &&
    product.type === "Boisson" &&
    product.carbsGrams >= 80 &&
    round(input.durationMinutes / 60) <= 2
  ) {
    return false;
  }

  if (
    aidStations === "self-supported" &&
    product.type === "Boisson" &&
    product.carbsGrams >= 80 &&
    round(input.durationMinutes / 60) >= 4 &&
    sport !== "cycling"
  ) {
    return false;
  }

  if (
    sport === "running" &&
    product.type === "Barre" &&
    input.targetCarbsPerHour >= 70 &&
    round(input.durationMinutes / 60) >= 2
  ) {
    return false;
  }

  return true;
}

function buildMixedCandidatePool(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
) {
  const rankedUnique: ProductWithMetrics[] = [];
  const typeCounts: Partial<Record<ProductType, number>> = {};

  for (const product of rankProducts(products, targetTotalCarbs, "best-value", input)) {
    const countForType = typeCounts[product.type] ?? 0;
    const limitForType = product.type === "Boisson" ? 3 : 2;

    if (countForType >= limitForType) {
      continue;
    }

    rankedUnique.push(product);
    typeCounts[product.type] = countForType + 1;

    if (rankedUnique.length >= 7) {
      break;
    }
  }

  return rankedUnique;
}

function buildSelectionSets(products: ProductWithMetrics[]) {
  const selectionSets: ProductWithMetrics[][] = [];

  for (let i = 0; i < products.length; i += 1) {
    selectionSets.push([products[i]]);

    for (let j = i + 1; j < products.length; j += 1) {
      const pair = [products[i], products[j]];
      if (isValidSelectionSet(pair)) {
        selectionSets.push(pair);
      }

      for (let k = j + 1; k < products.length; k += 1) {
        const trio = [products[i], products[j], products[k]];
        if (isValidSelectionSet(trio)) {
          selectionSets.push(trio);
        }
      }
    }
  }

  return selectionSets;
}

function isValidSelectionSet(products: ProductWithMetrics[]) {
  const selections: ProductWithMetrics[] = [];

  for (const product of products) {
    if (!canAddProductToPlan(selections, product)) {
      return false;
    }

    selections.push(product);
  }

  return true;
}

function allocatePlanPortions(
  selections: AdvisorSelection[],
  targetTotalCarbs: number,
  maxDrinkPortions: number,
  durationHours: number,
  input: EffortAdvisorInput,
) {
  const plan = selections.map<PortionAllocation>((selection) => ({
    product: selection.product,
    portions: selection.portions ?? 0,
  }));
  const lockedProductIds = new Set(
    selections
      .filter((selection) => selection.portions !== undefined)
      .map((selection) => selection.product.id),
  );

  let currentScore = scorePortionPlan(plan, targetTotalCarbs, input);

  while (true) {
    let bestCandidate: PortionAllocation[] | null = null;
    let bestScore = currentScore;

    for (const entry of plan) {
      if (lockedProductIds.has(entry.product.id)) {
        continue;
      }

      const nextPortions = round(entry.portions + getPortionStep(entry.product));
      const cappedPortions = clampPortionsForPracticality(
        entry.product,
        nextPortions,
        maxDrinkPortions,
        durationHours,
        input.context ?? "neutral",
        input.targetCarbsPerHour,
      );

      if (cappedPortions <= entry.portions) {
        continue;
      }

      const candidatePlan = plan.map((candidate) =>
        candidate.product.id === entry.product.id
          ? { ...candidate, portions: cappedPortions }
          : candidate,
      );
      const candidateScore = scorePortionPlan(
        candidatePlan,
        targetTotalCarbs,
        input,
      );

      if (candidateScore < bestScore) {
        bestScore = candidateScore;
        bestCandidate = candidatePlan;
      }
    }

    if (!bestCandidate) {
      break;
    }

    plan.splice(0, plan.length, ...bestCandidate);
    currentScore = bestScore;
  }

  return plan;
}

function scorePortionPlan(
  plan: PortionAllocation[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
) {
  const totalCarbs = round(
    plan.reduce((sum, entry) => sum + entry.product.carbsGrams * entry.portions, 0),
  );
  const totalCost = round(
    plan.reduce((sum, entry) => sum + entry.product.cheapestOffer.price * entry.portions, 0),
  );
  const totalPortions = round(plan.reduce((sum, entry) => sum + entry.portions, 0));
  const overshoot = Math.max(0, totalCarbs - targetTotalCarbs);
  const shortfall = Math.max(0, targetTotalCarbs - totalCarbs);
  const tolerance = Math.max(10, Math.round(targetTotalCarbs * 0.05));
  const effectiveOvershoot = Math.max(0, overshoot - tolerance);
  const effectiveShortfall = Math.max(0, shortfall - tolerance);
  const concentrationPenalty = plan.reduce(
    (sum, entry) =>
      sum + getServingConcentrationPenalty(entry.product, targetTotalCarbs, input),
    0,
  );
  const activeProductCount = plan.filter((entry) => entry.portions > 0).length;
  const tinyPortionPenalty = plan.reduce((sum, entry) => {
    if (entry.portions <= 0 || entry.portions >= 0.75) {
      return sum;
    }

    return sum + (entry.product.type === "Boisson" ? 8 : 14);
  }, 0);

  return round(
    effectiveOvershoot * 3 +
      effectiveShortfall * 1.2 +
      totalCost * 0.45 +
      totalPortions * 2 +
      activeProductCount * 4 +
      concentrationPenalty +
      tinyPortionPenalty,
  );
}

function scorePlan(
  plan: EffortAdvisorPlan,
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
) {
  const overshoot = Math.max(0, plan.totalCarbs - targetTotalCarbs);
  const shortfall = Math.max(0, targetTotalCarbs - plan.totalCarbs);
  const tolerance = Math.max(10, Math.round(targetTotalCarbs * 0.05));
  const effectiveOvershoot = Math.max(0, overshoot - tolerance);
  const effectiveShortfall = Math.max(0, shortfall - tolerance);
  const portions = plan.items.reduce((sum, item) => sum + item.portions, 0);
  const concentrationPenalty = plan.items.reduce((sum, item) => {
    const product = getProducts(input.targetCarbsPerHour).find((entry) => entry.id === item.productId);
    return sum +
      (product
        ? getServingConcentrationPenalty(product, targetTotalCarbs, input)
        : 0);
  }, 0);
  const tinyPortionPenalty = plan.items.reduce((sum, item) => {
    if (item.portions >= 0.75) {
      return sum;
    }

    return sum + (item.type === "Boisson" ? 8 : 14);
  }, 0);

  return round(
    effectiveOvershoot * 3 +
      effectiveShortfall * 1.2 +
      plan.totalCost * 0.45 +
      portions * 2 +
      plan.items.length * 4 +
      concentrationPenalty +
      tinyPortionPenalty,
  );
}

function getPortionStep(product: ProductWithMetrics) {
  return product.type === "Boisson" || product.type === "Barre" ? 0.5 : 1;
}

function getPracticalityPenalty(
  product: ProductWithMetrics,
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
) {
  const durationHours = round(input.durationMinutes / 60);
  const maxDrinkPortions = getMaxDrinkPortionsForDuration(input, durationHours);
  const requiredPortions = estimatePortionsForCarbs(
    product,
    targetTotalCarbs,
    maxDrinkPortions,
    durationHours,
    input.context ?? "neutral",
    input.targetCarbsPerHour,
  );
  const requiredCarbs = round(requiredPortions * product.carbsGrams);
  const shortfall = Math.max(0, targetTotalCarbs - requiredCarbs);
  const portionPenalty = Math.max(0, requiredPortions - getMaxPracticalPortions(
    product,
    durationHours,
    input.context ?? "neutral",
    input.targetCarbsPerHour,
    maxDrinkPortions,
  ));

  return round(shortfall + portionPenalty * 50);
}

function getServingConcentrationPenalty(
  product: ProductWithMetrics,
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
) {
  const durationHours = Math.max(1, round(input.durationMinutes / 60));
  const targetPerHour = input.targetCarbsPerHour;
  const shareOfTarget = product.carbsGrams / Math.max(targetTotalCarbs, 1);
  const label = `${product.brand} ${product.name}`.toLowerCase();

  if (product.carbsGrams >= 150 || /\bflow\b|\bflask\b|\bbottle\b/.test(label)) {
    return 500;
  }

  if (product.type === "Gel" && product.carbsGrams >= 90) {
    return 70;
  }

  if (
    product.type !== "Boisson" &&
    product.carbsGrams > targetPerHour &&
    durationHours <= 4
  ) {
    return 25;
  }

  if (product.type === "Barre" && product.carbsGrams >= 60) {
    return (input.context ?? "neutral") === "race" ? 20 : 8;
  }

  if (shareOfTarget >= 0.55 && product.type !== "Boisson") {
    return 18;
  }

  return 0;
}

function getFuelFormPenalty(
  product: ProductWithMetrics,
  input: EffortAdvisorInput,
) {
  const context = input.context ?? "neutral";
  const targetCarbsPerHour = input.targetCarbsPerHour;
  const durationHours = round(input.durationMinutes / 60);
  const sport = input.sport ?? "neutral";
  const heat = input.heat ?? "mild";
  const aidStations = input.aidStations ?? "regular";

  if (context === "race") {
    if (product.type === "Boisson") {
      let score = targetCarbsPerHour >= 60 ? -3 : -1;
      if (sport === "running" && heat === "hot") {
        score -= 1;
      }
      if (aidStations === "self-supported" && product.carbsGrams >= 80) {
        score += 2;
      }
      return score;
    }

    if (product.type === "Gel") {
      let score = targetCarbsPerHour >= 60 ? -2 : -1;
      if (sport === "running" || sport === "trail") {
        score -= 1;
      }
      if (heat === "hot" && targetCarbsPerHour >= 80) {
        score += 1;
      }
      return score;
    }

    if (product.type === "Barre") {
      return durationHours <= 3 || targetCarbsPerHour >= 70 || sport === "running"
        ? 4
        : 1;
    }

    return sport === "running" ? 1 : 0;
  }

  if (context === "training") {
    if (product.type === "Barre" && durationHours >= 2.5 && targetCarbsPerHour <= 60) {
      return -1;
    }

    if (product.type === "Boisson" && targetCarbsPerHour >= 60) {
      return sport === "cycling" ? -3 : -2;
    }

    if (product.type === "Gel" && sport === "running" && durationHours >= 3) {
      return -1;
    }
  }

  return 0;
}

function getMaxPracticalPortions(
  product: ProductWithMetrics,
  durationHours: number,
  context: EffortContext,
  targetCarbsPerHour: number,
  maxDrinkPortions: number,
) {
  if (product.type === "Boisson") {
    return maxDrinkPortions;
  }

  if (product.type === "Gel") {
    const perHour = targetCarbsPerHour >= 80 ? 3 : 2;
    return perHour * durationHours;
  }

  if (product.type === "Barre") {
    const perHour =
      context === "race"
        ? targetCarbsPerHour >= 70
          ? 0.5
          : 1
        : durationHours >= 3
          ? 1
          : 0.75;
    return round(perHour * durationHours * 2) / 2;
  }

  const perHour = context === "race" ? 1.5 : 2;
  return round(perHour * durationHours * 2) / 2;
}

function getMaxDrinkPortionsPerBottle(product: ProductWithMetrics) {
  if (product.type !== "Boisson") {
    return DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE;
  }

  if (product.carbsGrams >= 60) {
    return 1;
  }

  if (product.carbsGrams >= 40) {
    return 1.5;
  }

  return DEFAULT_MAX_DRINK_PORTIONS_PER_BOTTLE;
}

function clampPortionsForPracticality(
  product: ProductWithMetrics,
  portions: number,
  maxDrinkPortions: number,
  durationHours: number,
  context: EffortContext,
  targetCarbsPerHour: number,
) {
  const cap = getMaxPracticalPortions(
    product,
    durationHours,
    context,
    targetCarbsPerHour,
    maxDrinkPortions,
  );

  return Math.min(portions, cap);
}

function inferHourlyTarget(targetTotalCarbs: number) {
  if (targetTotalCarbs <= 30) {
    return 30;
  }

  if (targetTotalCarbs <= 90) {
    return 45;
  }

  if (targetTotalCarbs <= 180) {
    return 60;
  }

  return 75;
}
