import {
  DEFAULT_TARGET_CARBS,
  ProductType,
  ProductWithMetrics,
  getOfferVerificationStatus,
  getProducts,
} from "@/lib/product-offer-catalog";

export type EffortPreference = "best-value" | "lowest-cost" | "simple" | "mixed";
export type CaffeinePreference = "any" | "avoid" | "ok";

export type EffortAdvisorInput = {
  durationMinutes: number;
  targetCarbsPerHour: number;
  preference?: EffortPreference;
  caffeine?: CaffeinePreference;
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

export type EffortAdvisorResult = {
  durationMinutes: number;
  durationHours: number;
  targetCarbsPerHour: number;
  targetTotalCarbs: number;
  assumptions: string[];
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
export const DRINK_WATER_ML_PER_PORTION = 500;
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
  const targetCarbsPerHour = clamp(input.targetCarbsPerHour, 20, 140);
  const durationHours = round(durationMinutes / 60);
  const targetTotalCarbs = Math.round(durationHours * targetCarbsPerHour);
  const maxDrinkPortions = getMaxDrinkPortionsForDuration(input, durationHours);
  const products = getAdvisorProducts(input);
  const assumptions = buildAssumptions(input, durationMinutes, targetCarbsPerHour);
  const customPlan = buildRequestedCompositionPlan(products, targetTotalCarbs, input, maxDrinkPortions);
  const mixedPlan = buildMixedPlan(products, targetTotalCarbs, input, maxDrinkPortions);
  const budgetPlan = buildSingleProductPlan(
    "Option budget",
    products,
    targetTotalCarbs,
    "lowest-cost",
    input,
    maxDrinkPortions,
  );
  const ratioPlan = buildSingleProductPlan(
    "Option meilleur ratio",
    products,
    targetTotalCarbs,
    "best-value",
    input,
    maxDrinkPortions,
  );
  const simplePlan = buildSingleProductPlan(
    "Option simple",
    products,
    targetTotalCarbs,
    "simple",
    input,
    maxDrinkPortions,
  );
  const plans = dedupePlans(
    (customPlan
      ? [customPlan, budgetPlan, mixedPlan, ratioPlan, simplePlan]
      : [mixedPlan, budgetPlan, ratioPlan, simplePlan]
    ).filter((plan): plan is EffortAdvisorPlan => plan !== null),
  ).slice(0, 4);

  return {
    durationMinutes,
    durationHours,
    targetCarbsPerHour,
    targetTotalCarbs,
    assumptions,
    plans,
    answer: formatAdvisorAnswer(targetTotalCarbs, targetCarbsPerHour, durationHours, plans),
  };
}

function getAdvisorProducts(input: EffortAdvisorInput) {
  const preferredTypes = input.preferredTypes ?? [];
  const hasRequestedComposition =
    Object.keys(normalizeTypeCounts(input.desiredTypeCounts)).length > 0;

  const candidates = getProducts(input.targetCarbsPerHour)
    .filter((product) => {
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
  );
}

function buildMixedPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
  maxDrinkPortions: number,
): EffortAdvisorPlan {
  const rankedProducts = [
    ...rankProducts(products, targetTotalCarbs, "best-value", input),
    ...rankProducts(products, targetTotalCarbs, "simple", input),
    ...rankProducts(products, targetTotalCarbs, "lowest-cost", input),
  ];
  const selections: ProductWithMetrics[] = [];

  for (const product of rankedProducts) {
    if (selections.length >= 3) {
      break;
    }

    if (selections.some((selection) => selection.id === product.id)) {
      continue;
    }

    if (!canAddProductToPlan(selections, product)) {
      continue;
    }

    selections.push(product);
  }

  return buildPlanFromSelections(
    "Option mixte",
    targetTotalCarbs,
    selections.map((product) => ({ product })),
    maxDrinkPortions,
  );
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
        portions: clampRequestedPortions(product, requestedCount, maxDrinkPortions),
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
  );
}

function buildPlanFromSelections(
  title: string,
  targetTotalCarbs: number,
  selections: AdvisorSelection[],
  maxDrinkPortions: number,
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

  let remainingCarbs = targetTotalCarbs;
  let flexibleSelectionsLeft = selections.filter(
    (selection) => selection.portions === undefined,
  ).length;
  const items = selections.map((selection) => {
    const { product } = selection;
    const portions = selection.portions ?? estimatePortionsForCarbs(
      product,
      flexibleSelectionsLeft <= 1
        ? remainingCarbs
        : Math.max(product.carbsGrams, remainingCarbs / flexibleSelectionsLeft),
      maxDrinkPortions,
    );
    if (selection.portions === undefined) {
      flexibleSelectionsLeft -= 1;
    }

    const totalCarbs = round(product.carbsGrams * portions);
    remainingCarbs = Math.max(0, remainingCarbs - totalCarbs);

    return buildAdvisorItem(product, portions);
  });
  const totalCarbs = round(items.reduce((sum, item) => sum + item.totalCarbs, 0));
  const totalCost = round(items.reduce((sum, item) => sum + item.totalCost, 0));

  return {
    title,
    summary: describePlanFit(totalCarbs, targetTotalCarbs),
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
        ? Math.round(portions * DRINK_WATER_ML_PER_PORTION)
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
) {
  const step = product.type === "Boisson" || product.type === "Barre" ? 0.5 : 1;
  const portions = Math.max(step, Math.ceil(targetCarbs / product.carbsGrams / step) * step);

  if (product.type !== "Boisson") {
    return portions;
  }

  return Math.min(portions, maxDrinkPortions);
}

function clampRequestedPortions(
  product: ProductWithMetrics,
  requestedPortions: number,
  maxDrinkPortions: number,
) {
  if (product.type !== "Boisson") {
    return requestedPortions;
  }

  return Math.min(requestedPortions, maxDrinkPortions);
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
) {
  const assumptions = [
    `Durée: ${formatDuration(durationMinutes)}.`,
    `Cible: ${targetCarbsPerHour} g de glucides par heure.`,
    `Boisson limitée à ${formatNumber(input.maxDrinkPortionsPerHour ?? DEFAULT_MAX_DRINK_PORTIONS_PER_HOUR)} portions/h; une portion correspond à environ ${DRINK_WATER_ML_PER_PORTION} ml d'eau.`,
  ];

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
) {
  const bestPlan = plans[0];
  if (!bestPlan || bestPlan.items.length === 0) {
    return "Aucun plan n'est disponible avec les critères actuels.";
  }

  const firstItem = bestPlan.items[0];
  const base = `Pour ${durationHours.toString().replace(".", ",")} h à ${targetCarbsPerHour} g/h, vise environ ${targetTotalCarbs} g de glucides.`;

  if (bestPlan.items.length > 1) {
    return [
      base,
      `Le plan recommandé combine ${formatPlanItems(bestPlan.items)} pour ${formatNumber(bestPlan.totalCarbs)} g, environ ${formatMoney(bestPlan.totalCost)} $.`,
      `Détaillants recommandés: ${formatSellers(bestPlan.items)}.`,
    ].join("\n\n");
  }

  return [
    base,
    `Le meilleur départ est ${firstItem.brand} ${firstItem.name}: ${formatPortions(firstItem.portions)}, ${formatNumber(firstItem.totalCarbs)} g, environ ${formatMoney(firstItem.totalCost)} $.`,
    `Détaillant recommandé: ${firstItem.seller}.`,
  ].join("\n\n");
}

function describePlanFit(totalCarbs: number, targetTotalCarbs: number) {
  const difference = round(totalCarbs - targetTotalCarbs);
  if (difference === 0) {
    return "Atteint exactement la cible de glucides.";
  }

  if (difference > 0) {
    return `Dépasse la cible de ${difference} g.`;
  }

  return `Reste ${Math.abs(difference)} g sous la cible.`;
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

function formatSellers(items: EffortAdvisorItem[]) {
  return [...new Set(items.map((item) => item.seller))].join(", ");
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
