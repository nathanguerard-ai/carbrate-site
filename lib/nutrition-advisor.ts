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
  question?: string;
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
  ["Gel", /\b(gel|gels)\b/i],
  ["Boisson", /\b(boisson|drink|mix|poudre|bouteille)\b/i],
  ["Barre", /\b(barre|bar|bars)\b/i],
  ["Autre", /\b(autre|autres|chew|chews|gomme|gummies)\b/i],
];
const PRODUCT_TYPES: ProductType[] = ["Gel", "Boisson", "Barre", "Autre"];

type AdvisorSelection = {
  product: ProductWithMetrics;
  portions?: number;
};

export function parseAdvisorQuestion(question: string): EffortAdvisorInput {
  const durationMinutes = parseDurationMinutes(question) ?? 120;
  const targetCarbsPerHour = parseCarbsPerHour(question) ?? DEFAULT_TARGET_CARBS;
  const preferredTypes = TYPE_KEYWORDS
    .filter(([, pattern]) => pattern.test(question))
    .map(([type]) => type);
  const desiredTypeCounts = parseDesiredTypeCounts(question);

  return {
    durationMinutes,
    targetCarbsPerHour,
    preference: parsePreference(question),
    caffeine: /\b(sans|éviter|eviter|pas de|aucune?)\s+(caféine|cafeine)\b/i.test(question)
      ? "avoid"
      : "any",
    preferredTypes,
    desiredTypeCounts,
    question,
  };
}

export function buildEffortAdvisorResult(
  input: EffortAdvisorInput,
): EffortAdvisorResult {
  const durationMinutes = clamp(input.durationMinutes, 30, 24 * 60);
  const targetCarbsPerHour = clamp(input.targetCarbsPerHour, 20, 140);
  const durationHours = round(durationMinutes / 60);
  const targetTotalCarbs = Math.round(durationHours * targetCarbsPerHour);
  const products = getAdvisorProducts(input);
  const assumptions = buildAssumptions(input, durationMinutes, targetCarbsPerHour);
  const customPlan = buildRequestedCompositionPlan(products, targetTotalCarbs, input);
  const mixedPlan = buildMixedPlan(products, targetTotalCarbs, input);
  const budgetPlan = buildSingleProductPlan(
    "Option budget",
    products,
    targetTotalCarbs,
    "lowest-cost",
    input,
  );
  const ratioPlan = buildSingleProductPlan(
    "Option meilleur ratio",
    products,
    targetTotalCarbs,
    "best-value",
    input,
  );
  const simplePlan = buildSingleProductPlan(
    "Option simple",
    products,
    targetTotalCarbs,
    "simple",
    input,
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
): EffortAdvisorPlan {
  const ranked = rankProducts(products, targetTotalCarbs, mode, input);
  const product = ranked[0] ?? products[0];

  return buildPlanFromSelections(
    title,
    targetTotalCarbs,
    product ? [{ product }] : [],
  );
}

function buildMixedPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
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
  );
}

function buildRequestedCompositionPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  input: EffortAdvisorInput,
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

    if ((requestedPortions ?? 0) <= 0) {
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
      selections.push({ product, portions: requestedPortions });
    }
  }

  const fixedCarbs = selections.reduce(
    (sum, selection) => sum + selection.product.carbsGrams * (selection.portions ?? 0),
    0,
  );
  const autoTypes = PRODUCT_TYPES.filter((type) => counts[type] === undefined);

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

  return buildPlanFromSelections("Option personnalisée", targetTotalCarbs, selections);
}

function buildPlanFromSelections(
  title: string,
  targetTotalCarbs: number,
  selections: AdvisorSelection[],
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

function estimatePortionsForCarbs(product: ProductWithMetrics, targetCarbs: number) {
  const step = product.type === "Boisson" || product.type === "Barre" ? 0.5 : 1;
  return Math.max(step, Math.ceil(targetCarbs / product.carbsGrams / step) * step);
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
  const hoursMinutes = question.match(/(\d+(?:[.,]\d+)?)\s*h(?:eures?)?\s*(\d{1,2})?/i);
  if (hoursMinutes) {
    const hours = parseNumber(hoursMinutes[1]) ?? 0;
    const minutes = Number.parseInt(hoursMinutes[2] ?? "0", 10);
    return Math.round(hours * 60 + minutes);
  }

  const minutes = question.match(/(\d{2,3})\s*(?:min|minutes)\b/i);
  if (minutes) {
    return Number.parseInt(minutes[1], 10);
  }

  return null;
}

function parseCarbsPerHour(question: string) {
  const match = question.match(/(\d{2,3})\s*g\s*(?:\/|par)?\s*h/i);
  return match ? Number.parseInt(match[1], 10) : null;
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
  const counts: Partial<Record<ProductType, number>> = {};
  const patterns: Array<[ProductType, RegExp]> = [
    ["Gel", /\b(\d+)\s*gels?\b/i],
    ["Boisson", /\b(\d+)\s*(?:boissons?|bouteilles?|drink|mix)\b/i],
    ["Barre", /\b(\d+)\s*barres?\b/i],
    ["Autre", /\b(\d+)\s*(?:autres?|chews?|gommes?|gummies)\b/i],
  ];

  for (const [type, pattern] of patterns) {
    const match = question.match(pattern);
    if (match) {
      counts[type] = clamp(Number.parseInt(match[1], 10), 0, 12);
    }
  }

  return counts;
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
    .map((item) => `${formatPortions(item.portions)} de ${item.brand} ${item.name}`)
    .join(", ");
}

function formatSellers(items: EffortAdvisorItem[]) {
  return [...new Set(items.map((item) => item.seller))].join(", ");
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
