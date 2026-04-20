import generatedOffers from "@/data/generated-product-offers.json";

export const DEFAULT_TARGET_CARBS = 60;

export type ProductType = "Gel" | "Boisson" | "Barre" | "Autre";
export type OfferVerificationStatus =
  | "verified"
  | "estimated"
  | "fallback"
  | "review";

export type Offer = {
  seller: string;
  price: number;
  packagePrice?: number;
  unitCount?: number;
  unitCountSource?: string;
  unitCountConfidence?: string;
  productUrl: string;
  priceSource?: string;
  priceConfidence?: string;
  verificationStatus?: OfferVerificationStatus;
  verificationLabel?: string;
  verificationReason?: string;
  lastCheckedAt?: string;
};

export type Product = {
  id: string;
  name: string;
  brand: string;
  type: ProductType;
  carbsGrams: number;
  carbsSource?: string;
  officialProductUrl?: string;
  offers: Offer[];
};

export type ProductWithMetrics = Product & {
  cheapestOffer: Offer;
  offerCount: number;
  carbsPerDollar: number;
  costForTargetGrams: number;
};

export type PortionRecommendationItem = {
  productId: string;
  name: string;
  brand: string;
  type: ProductType;
  portions: number;
  carbsGrams: number;
  totalCarbs: number;
  unitPrice: number;
  totalPrice: number;
};

export type PortionRecommendation = {
  totalCarbs: number;
  totalCost: number;
  differenceFromTarget: number;
  deltaFromTarget: number;
  portionCount: number;
  distinctProductCount: number;
  distinctTypeCount: number;
  matchLabel: string;
  items: PortionRecommendationItem[];
};

export type OfferAssuranceSummary = {
  totalOffers: number;
  verifiedOffers: number;
  estimatedOffers: number;
  fallbackOffers: number;
  reviewOffers: number;
  verifiedProductCount: number;
  reviewProducts: ProductWithMetrics[];
};

export type ProductBrandCount = {
  brand: string;
  count: number;
};

type GeneratedCatalog = {
  updatedAt: string;
  products: Product[];
};

type RecommendationSelection = {
  product: ProductWithMetrics;
  portionMultiplier: number;
};

const catalog = generatedOffers as GeneratedCatalog;

export function getProducts(
  targetGrams = DEFAULT_TARGET_CARBS,
): ProductWithMetrics[] {
  return catalog.products
    .map((product) => {
      const validOffers = product.offers.filter(isValidOffer);
      const cheapestOffer = choosePrimaryOffer(validOffers);
      if (!cheapestOffer || !Number.isFinite(product.carbsGrams) || product.carbsGrams <= 0) {
        return null;
      }

      return {
        ...product,
        offers: validOffers,
        cheapestOffer,
        offerCount: validOffers.length,
        carbsPerDollar: round(product.carbsGrams / cheapestOffer.price),
        costForTargetGrams: round(
          (targetGrams / product.carbsGrams) * cheapestOffer.price,
        ),
      };
    })
    .filter((product): product is ProductWithMetrics => product !== null)
    .sort((a, b) => b.carbsPerDollar - a.carbsPerDollar);
}

export function getCatalogUpdatedAt() {
  return catalog.updatedAt;
}

export function getOfferAssuranceSummary(
  products = getProducts(DEFAULT_TARGET_CARBS),
): OfferAssuranceSummary {
  const offers = products.flatMap((product) => product.offers);
  const countByStatus = (status: OfferVerificationStatus) =>
    offers.filter((offer) => getOfferVerificationStatus(offer) === status).length;
  const reviewProducts = products.filter((product) =>
    product.offers.some((offer) =>
      ["fallback", "review"].includes(getOfferVerificationStatus(offer)),
    ),
  );

  return {
    totalOffers: offers.length,
    verifiedOffers: countByStatus("verified"),
    estimatedOffers: countByStatus("estimated"),
    fallbackOffers: countByStatus("fallback"),
    reviewOffers: countByStatus("review"),
    verifiedProductCount: products.filter(
      (product) => getOfferVerificationStatus(product.cheapestOffer) === "verified",
    ).length,
    reviewProducts,
  };
}

export function getOfferVerificationStatus(
  offer: Offer,
): OfferVerificationStatus {
  if (offer.verificationStatus) {
    return offer.verificationStatus;
  }

  if (offer.priceConfidence === "fallback") {
    return "fallback";
  }

  if (offer.priceConfidence === "live-text") {
    return "estimated";
  }

  if (
    offer.unitCountConfidence === "inferred" &&
    offer.priceConfidence === "live" &&
    Number.isFinite(offer.packagePrice) &&
    Number.isFinite(offer.unitCount) &&
    (offer.packagePrice ?? 0) > 20 &&
    (offer.unitCount ?? 0) > 1
  ) {
    return "verified";
  }

  if (
    Number.isFinite(offer.packagePrice) &&
    Number.isFinite(offer.unitCount) &&
    (offer.unitCount ?? 1) > 1
  ) {
    return "verified";
  }

  return offer.priceConfidence === "live" ? "verified" : "estimated";
}

export function getOfferVerificationLabel(offer: Offer) {
  return offer.verificationLabel ?? labelForVerificationStatus(
    getOfferVerificationStatus(offer),
  );
}

function choosePrimaryOffer(offers: Offer[]) {
  return [...offers].sort((a, b) => {
    const availabilityDifference =
      getOfferAvailabilityRank(a) - getOfferAvailabilityRank(b);
    if (availabilityDifference !== 0) {
      return availabilityDifference;
    }

    const priceDifference = a.price - b.price;
    if (priceDifference !== 0) {
      return priceDifference;
    }

    const statusDifference =
      getOfferStatusRank(a) - getOfferStatusRank(b);
    if (statusDifference !== 0) {
      return statusDifference;
    }

    return (b.unitCount ?? 1) - (a.unitCount ?? 1);
  })[0];
}

function getOfferAvailabilityRank(offer: Offer) {
  const status = getOfferVerificationStatus(offer);
  if (status === "fallback") {
    return 1;
  }

  if (status === "review") {
    return 2;
  }

  return 0;
}

function getOfferStatusRank(offer: Offer) {
  const status = getOfferVerificationStatus(offer);
  if (status === "verified") {
    return 0;
  }

  if (status === "estimated") {
    return 1;
  }

  return 2;
}

export function getPortionRecommendations(
  products: ProductWithMetrics[],
  targetGrams: number,
  limit = 3,
) {
  if (products.length === 0) {
    return [];
  }

  const candidateProducts = getRecommendationCandidates(products);
  const maxCarbs = Math.max(...candidateProducts.map((product) => product.carbsGrams));
  const upperBound = targetGrams + Math.max(20, maxCarbs / 2);
  const maxPortionCount = Math.min(
    4,
    Math.max(
      2,
      Math.ceil(
        targetGrams /
          Math.max(...candidateProducts.map((product) => product.carbsGrams)),
      ) + 1,
    ),
  );
  const rawPlans: PortionRecommendation[] = [];

  function explore(
    startIndex: number,
    selections: RecommendationSelection[],
    totalCarbs: number,
    totalCost: number,
    portionCount: number,
  ) {
    if (selections.length > 0) {
      rawPlans.push(
        buildRecommendation(
          selections,
          totalCarbs,
          totalCost,
          targetGrams,
        ),
      );
    }

    if (portionCount >= maxPortionCount) {
      return;
    }

    for (let index = startIndex; index < candidateProducts.length; index += 1) {
      const product = candidateProducts[index];
      for (const portionMultiplier of getAllowedPortionMultipliers(product)) {
        const nextTotalCarbs = round(totalCarbs + product.carbsGrams * portionMultiplier);
        if (nextTotalCarbs > upperBound) {
          continue;
        }

        const nextPortionCount = round(portionCount + portionMultiplier);
        if (nextPortionCount > maxPortionCount) {
          continue;
        }

        const distinctProducts = new Set([
          ...selections.map((selection) => selection.product.id),
          product.id,
        ]);
        if (distinctProducts.size > 3) {
          continue;
        }

        explore(
          index,
          [...selections, { product, portionMultiplier }],
          nextTotalCarbs,
          round(totalCost + product.cheapestOffer.price * portionMultiplier),
          nextPortionCount,
        );
      }
    }
  }

  explore(0, [], 0, 0, 0);

  const uniquePlans = rawPlans
    .sort(compareRecommendations)
    .filter((plan, index, allPlans) => {
      const signature = getRecommendationSignature(plan);
      return (
        index ===
        allPlans.findIndex(
          (entry) => getRecommendationSignature(entry) === signature,
        )
      );
    });
  const focusedPlans = getFocusedRecommendationPool(uniquePlans, limit);

  const selectedPlans: PortionRecommendation[] = [];

  const bestOverall = focusedPlans[0];
  if (bestOverall) {
    selectedPlans.push(bestOverall);
  }

  const bestMixed = focusedPlans.find(
    (plan) =>
      plan.distinctProductCount > 1 &&
      plan.distinctTypeCount >= 1 &&
      !selectedPlans.some(
        (selectedPlan) =>
          getRecommendationSignature(selectedPlan) ===
          getRecommendationSignature(plan),
      ),
  );
  if (bestMixed) {
    selectedPlans.push(bestMixed);
  }

  const bestSimple = focusedPlans.find(
    (plan) =>
      (plan.distinctProductCount === 1 || plan.portionCount === 1) &&
      !selectedPlans.some(
        (selectedPlan) =>
          getRecommendationSignature(selectedPlan) ===
          getRecommendationSignature(plan),
      ),
  );
  if (bestSimple) {
    selectedPlans.push(bestSimple);
  }

  for (const plan of focusedPlans) {
    if (selectedPlans.length >= limit) {
      break;
    }

    if (
      selectedPlans.some(
        (selectedPlan) =>
          getRecommendationSignature(selectedPlan) === getRecommendationSignature(plan),
      )
    ) {
      continue;
    }

    selectedPlans.push(plan);
  }

  return selectedPlans
    .sort(compareRecommendations)
    .slice(0, limit);
}

export function clampTargetGrams(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_TARGET_CARBS;
  }

  return Math.min(180, Math.max(30, Math.round(value)));
}

export function getProductTypes() {
  const typeOrder: ProductType[] = ["Gel", "Boisson", "Barre", "Autre"];
  const availableTypes = new Set(catalog.products.map((product) => product.type));

  return typeOrder.filter((type) => availableTypes.has(type));
}

export function getProductBrands() {
  return getSortedBrands(
    [...new Set(catalog.products.map((product) => product.brand))],
  );
}

export function getProductBrandCounts(
  products = getProducts(DEFAULT_TARGET_CARBS),
): ProductBrandCount[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    counts.set(product.brand, (counts.get(product.brand) ?? 0) + 1);
  }

  return getSortedBrands([...counts.keys()]).map((brand) => ({
    brand,
    count: counts.get(brand) ?? 0,
  }));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function getSortedBrands(brands: string[]) {
  const brandPriority = new Map([
    ["Carbs Fuel", 0],
  ]);

  return [...brands].sort((a, b) => {
    const priorityDifference =
      (brandPriority.get(a) ?? Number.MAX_SAFE_INTEGER) -
      (brandPriority.get(b) ?? Number.MAX_SAFE_INTEGER);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    return a.localeCompare(b, "fr-CA");
  });
}

function labelForVerificationStatus(status: OfferVerificationStatus) {
  if (status === "verified") {
    return "Prix vérifié";
  }

  if (status === "estimated") {
    return "Prix estimé";
  }

  if (status === "fallback") {
    return "Prix de secours";
  }

  return "À vérifier";
}

function isValidOffer(offer: Offer) {
  return (
    Number.isFinite(offer.price) &&
    offer.price > 0 &&
    offer.price <= 50 &&
    typeof offer.productUrl === "string" &&
    offer.productUrl.length > 0
  );
}

function getRecommendationCandidates(products: ProductWithMetrics[]) {
  const realisticProducts = products.filter(isQuickRecommendationCandidate);
  const byRatio = [...realisticProducts]
    .sort((a, b) => b.carbsPerDollar - a.carbsPerDollar)
    .slice(0, 24);
  const byCost = [...realisticProducts]
    .sort((a, b) => a.costForTargetGrams - b.costForTargetGrams)
    .slice(0, 18);
  const byPrice = [...realisticProducts]
    .sort((a, b) => a.cheapestOffer.price - b.cheapestOffer.price)
    .slice(0, 16);
  const byCarbs = [...realisticProducts]
    .sort((a, b) => b.carbsGrams - a.carbsGrams)
    .slice(0, 12);

  return [...new Map([...byRatio, ...byCost, ...byPrice, ...byCarbs].map((product) => [product.id, product])).values()];
}

function isQuickRecommendationCandidate(product: ProductWithMetrics) {
  const label = `${product.brand} ${product.name}`.toLowerCase();

  if (product.carbsGrams >= 150) {
    return false;
  }

  if (
    product.type === "Gel" &&
    (product.carbsGrams >= 120 ||
      /\bflow\b|\bflask\b|\bbottle\b|\bpouch\b/.test(label))
  ) {
    return false;
  }

  if (product.type === "Barre" && product.carbsGrams >= 70) {
    return false;
  }

  return true;
}

function buildRecommendation(
  selections: RecommendationSelection[],
  totalCarbs: number,
  totalCost: number,
  targetGrams: number,
): PortionRecommendation {
  const grouped = new Map<string, ProductWithMetrics & { portions: number }>();

  for (const selection of selections) {
    const { product, portionMultiplier } = selection;
    const existing = grouped.get(product.id);
    if (existing) {
      existing.portions = round(existing.portions + portionMultiplier);
      continue;
    }

    grouped.set(product.id, { ...product, portions: portionMultiplier });
  }

  const items = [...grouped.values()]
    .map((product) => ({
      productId: product.id,
      name: product.name,
      brand: product.brand,
      type: product.type,
      portions: product.portions,
      carbsGrams: product.carbsGrams,
      totalCarbs: product.carbsGrams * product.portions,
      unitPrice: product.cheapestOffer.price,
      totalPrice: round(product.cheapestOffer.price * product.portions),
    }))
    .sort((a, b) => b.totalCarbs - a.totalCarbs || a.totalPrice - b.totalPrice);

  const distinctTypes = new Set(items.map((item) => item.type)).size;

  return {
    totalCarbs,
    totalCost: round(totalCost),
    differenceFromTarget: Math.abs(totalCarbs - targetGrams),
    deltaFromTarget: totalCarbs - targetGrams,
    portionCount: round(
      items.reduce((sum, item) => sum + item.portions, 0),
    ),
    distinctProductCount: items.length,
    distinctTypeCount: distinctTypes,
    matchLabel: getMatchLabel(totalCarbs, targetGrams),
    items,
  };
}

function compareRecommendations(a: PortionRecommendation, b: PortionRecommendation) {
  const aTier = getRecommendationTier(a.deltaFromTarget, a.differenceFromTarget);
  const bTier = getRecommendationTier(b.deltaFromTarget, b.differenceFromTarget);

  return (
    aTier - bTier ||
    a.totalCost - b.totalCost ||
    a.differenceFromTarget - b.differenceFromTarget ||
    a.portionCount - b.portionCount ||
    a.distinctProductCount - b.distinctProductCount ||
    b.distinctTypeCount - a.distinctTypeCount
  );
}

function getRecommendationTier(
  deltaFromTarget: number,
  differenceFromTarget: number,
) {
  if (differenceFromTarget === 0) {
    return 0;
  }

  if (deltaFromTarget > 0 && differenceFromTarget <= 5) {
    return 1;
  }

  if (deltaFromTarget < 0 && differenceFromTarget <= 5) {
    return 2;
  }

  if (deltaFromTarget > 0 && differenceFromTarget <= 15) {
    return 3;
  }

  if (deltaFromTarget < 0 && differenceFromTarget <= 10) {
    return 4;
  }

  if (deltaFromTarget > 0 && differenceFromTarget <= 25) {
    return 5;
  }

  if (deltaFromTarget < 0 && differenceFromTarget <= 20) {
    return 6;
  }

  if (deltaFromTarget > 0) {
    return 7;
  }

  return 8;
}

function getAllowedPortionMultipliers(product: ProductWithMetrics) {
  return product.type === "Boisson" || product.type === "Barre"
    ? [0.5, 1]
    : [1];
}

function getFocusedRecommendationPool(
  plans: PortionRecommendation[],
  limit: number,
) {
  const nearTargetPlans = plans.filter((plan) => plan.differenceFromTarget <= 15);
  if (nearTargetPlans.length >= limit) {
    return nearTargetPlans;
  }

  const acceptablePlans = plans.filter((plan) => plan.differenceFromTarget <= 25);
  if (acceptablePlans.length >= limit) {
    return acceptablePlans;
  }

  return plans;
}

function getRecommendationSignature(plan: PortionRecommendation) {
  return plan.items.map((item) => `${item.productId}:${item.portions}`).join("|");
}

function getMatchLabel(totalCarbs: number, targetGrams: number) {
  if (totalCarbs === targetGrams) {
    return "exact";
  }

  if (totalCarbs > targetGrams) {
    return `+${totalCarbs - targetGrams} g`;
  }

  return `-${targetGrams - totalCarbs} g`;
}
