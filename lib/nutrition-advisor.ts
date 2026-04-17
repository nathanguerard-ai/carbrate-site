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
  ["Bonbon", /\b(bonbon|chew|chews|gomme|gummies)\b/i],
];

export function parseAdvisorQuestion(question: string): EffortAdvisorInput {
  const durationMinutes = parseDurationMinutes(question) ?? 120;
  const targetCarbsPerHour = parseCarbsPerHour(question) ?? DEFAULT_TARGET_CARBS;
  const preferredTypes = TYPE_KEYWORDS
    .filter(([, pattern]) => pattern.test(question))
    .map(([type]) => type);

  return {
    durationMinutes,
    targetCarbsPerHour,
    preference: parsePreference(question),
    caffeine: /\b(sans|éviter|eviter|pas de|aucune?)\s+(caféine|cafeine)\b/i.test(question)
      ? "avoid"
      : "any",
    preferredTypes,
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
  const plans = dedupePlans([
    buildSingleProductPlan("Option budget", products, targetTotalCarbs, "lowest-cost"),
    buildSingleProductPlan("Option meilleur ratio", products, targetTotalCarbs, "best-value"),
    buildSingleProductPlan("Option simple", products, targetTotalCarbs, "simple"),
    buildMixedPlan(products, targetTotalCarbs),
  ]).slice(0, 4);

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

  const candidates = getProducts(input.targetCarbsPerHour)
    .filter((product) => {
      if (preferredTypes.length > 0 && !preferredTypes.includes(product.type)) {
        return false;
      }

      if (input.caffeine === "avoid" && /caf|caffeine|caféine/i.test(product.name)) {
        return false;
      }

      return getOfferVerificationStatus(product.cheapestOffer) !== "review";
    })
    .sort((a, b) => b.carbsPerDollar - a.carbsPerDollar);
  const reliableCandidates = candidates.filter(
    (product) => getOfferVerificationStatus(product.cheapestOffer) !== "fallback",
  );

  return reliableCandidates.length > 0 ? reliableCandidates : candidates;
}

function buildSingleProductPlan(
  title: string,
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
  mode: EffortPreference,
): EffortAdvisorPlan {
  const ranked = [...products].sort((a, b) => {
    if (mode === "lowest-cost") {
      return estimateTotalCost(a, targetTotalCarbs) - estimateTotalCost(b, targetTotalCarbs);
    }

    if (mode === "simple") {
      return estimatePortions(a, targetTotalCarbs) - estimatePortions(b, targetTotalCarbs);
    }

    return b.carbsPerDollar - a.carbsPerDollar;
  });
  const product = ranked[0] ?? products[0];

  return buildPlanFromSelections(title, targetTotalCarbs, product ? [product] : []);
}

function buildMixedPlan(
  products: ProductWithMetrics[],
  targetTotalCarbs: number,
): EffortAdvisorPlan {
  const byRatio = products[0];
  const byCarbs = [...products].sort((a, b) => b.carbsGrams - a.carbsGrams)[0];
  const byCost = [...products].sort(
    (a, b) => estimateTotalCost(a, targetTotalCarbs) - estimateTotalCost(b, targetTotalCarbs),
  )[0];
  const selections = [...new Map(
    [byRatio, byCarbs, byCost]
      .filter(Boolean)
      .map((product) => [product.id, product]),
  ).values()];

  return buildPlanFromSelections("Option mixte", targetTotalCarbs, selections);
}

function buildPlanFromSelections(
  title: string,
  targetTotalCarbs: number,
  products: ProductWithMetrics[],
): EffortAdvisorPlan {
  if (products.length === 0) {
    return {
      title,
      summary: "Aucun produit fiable ne correspond à cette demande.",
      totalCarbs: 0,
      totalCost: 0,
      items: [],
    };
  }

  let remainingCarbs = targetTotalCarbs;
  const items = products.map((product, index) => {
    const isLast = index === products.length - 1;
    const share = isLast
      ? remainingCarbs
      : Math.max(product.carbsGrams, targetTotalCarbs / products.length);
    const portions = estimatePortionsForCarbs(product, share);
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

  return [
    `Pour ${durationHours.toString().replace(".", ",")} h à ${targetCarbsPerHour} g/h, vise environ ${targetTotalCarbs} g de glucides.`,
    `Le meilleur départ est ${firstItem.brand} ${firstItem.name}: ${formatPortions(firstItem.portions)}, ${firstItem.totalCarbs} g, environ ${firstItem.totalCost.toFixed(2)} $.`,
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

  return `${hours} h ${remainingMinutes}`;
}

function formatPortions(value: number) {
  const label = value.toString().replace(".", ",");
  return `${label} portion${value > 1 ? "s" : ""}`;
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
