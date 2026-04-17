import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(projectRoot, "data", "product-catalog.json");
const outputPath = path.join(projectRoot, "data", "generated-product-offers.json");
const cachePath = path.join(projectRoot, "data", "product-page-cache.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 4500;
const MIN_UNIT_PRICE = 0.5;
const MAX_UNIT_PRICE = 20;
const MAX_PACKAGE_PRICE = 250;
const MAX_AUTO_UNIT_COUNT = 60;
const COMMON_UNIT_COUNTS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 18, 20, 24, 25, 30];

const enableLiveFetch =
  process.argv.includes("--live") || process.env.CARBRATE_ENABLE_NETWORK === "1";
const forceRefresh =
  process.argv.includes("--force") || process.env.CARBRATE_FORCE_REFRESH === "1";

async function prefetchUrls(urls, cache, stats) {
  const concurrencyLimit = 5; // Limit to 5 concurrent fetches
  const chunks = [];
  for (let i = 0; i < urls.length; i += concurrencyLimit) {
    chunks.push(urls.slice(i, i + concurrencyLimit));
  }

  for (const chunk of chunks) {
    await Promise.allSettled(chunk.map(url => prefetchUrl(url, cache, stats)));
  }
}

async function prefetchUrl(url, cache, stats) {
  const cached = cache.pages?.[url];
  if (cached && !forceRefresh && !isCacheExpired(cached.fetchedAt)) {
    return; // Already cached and fresh
  }

  if (!enableLiveFetch) {
    return;
  }

  const html = await fetchHtml(url);
  if (!html) {
    return;
  }

  const pageSignals = extractPageSignals(url, html);
  const nextEntry = {
    fetchedAt: new Date().toISOString(),
    ...pageSignals,
  };

  cache.pages[url] = nextEntry;
  stats.pagesFetched += 1;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const cache = await readJson(cachePath, { pages: {} });
  const products = [];
  const stats = {
    mode: enableLiveFetch ? "live" : "cached",
    pagesFetched: 0,
    pagesFromCache: 0,
    offerPricesFromLive: 0,
    offerPricesFromFallback: 0,
    offerPricesSkipped: 0,
    unitCountsFromLive: 0,
    unitCountsFromCatalog: 0,
    unitCountsInferredFromPrice: 0,
    unitCountsDefaulted: 0,
    carbsFromLive: 0,
    carbsFromCatalog: 0,
  };

  // Collect all unique URLs to prefetch
  const allUrls = new Set();
  for (const product of catalog.products) {
    const sourceUrls = [
      ...(product.nutritionSources ?? []).map((source) => source.url),
      ...product.offers.map((offer) => offer.productUrl),
    ];
    sourceUrls.filter(Boolean).forEach(url => allUrls.add(url));
  }

  // Prefetch all URLs in parallel with concurrency limit
  await prefetchUrls([...allUrls], cache, stats);

  for (const product of catalog.products) {
    const productSignals = await getProductSignals(product, cache, stats);
    const offerPackages = product.offers.map((offer) => {
      const pageSignals = productSignals.byUrl.get(offer.productUrl);
      return {
        offer,
        pageSignals,
        packageCandidate: choosePackagePriceCandidate(
          pageSignals?.priceCandidates ?? [],
        ),
      };
    });
    const singleUnitPrice = inferSingleUnitPrice(offerPackages);
    const productUnitResolution = resolveProductUnitCount(
      product,
      productSignals.signals,
      offerPackages,
      singleUnitPrice,
    );
    const carbsResolution = resolveProductCarbs(product, productSignals.signals, stats);
    const offers = [];

    for (const offer of product.offers) {
      if (offer.country !== "CA") {
        continue;
      }

      const pageSignals = productSignals.byUrl.get(offer.productUrl);
      const priceResolution = resolveOfferPrice(
        product,
        offer,
        pageSignals,
        productUnitResolution,
        singleUnitPrice,
        stats,
      );
      if (priceResolution.price === null) {
        stats.offerPricesSkipped += 1;
        continue;
      }

      offers.push({
        seller: offer.seller,
        price: priceResolution.price,
        packagePrice: priceResolution.packagePrice,
        unitCount: priceResolution.unitCount,
        unitCountSource: priceResolution.unitCountSource,
        unitCountConfidence: priceResolution.unitCountConfidence,
        productUrl: offer.productUrl,
        priceSource: priceResolution.source,
        priceConfidence: priceResolution.confidence,
        verificationStatus: priceResolution.verificationStatus,
        verificationLabel: priceResolution.verificationLabel,
        verificationReason: priceResolution.verificationReason,
        lastCheckedAt: priceResolution.lastCheckedAt,
      });
    }

    if (offers.length === 0) {
      for (const offer of product.offers) {
        if (offer.country !== "CA") {
          continue;
        }

        const fallbackUnitCount =
          Number.isFinite(offer.unitCount) && offer.unitCount > 0
            ? offer.unitCount
            : 1;

        offers.push({
          seller: offer.seller,
          price: offer.fallbackPrice,
          packagePrice: round(offer.fallbackPrice * fallbackUnitCount),
          unitCount: fallbackUnitCount,
          unitCountSource: "catalog-fallback",
          unitCountConfidence: "fallback",
          productUrl: offer.productUrl,
          priceSource: "catalog-fallback",
          priceConfidence: "fallback",
          verificationStatus: "fallback",
          verificationLabel: "Prix de secours",
          verificationReason:
            "Aucun prix fiable n'a pu être extrait; le catalogue sert de valeur temporaire.",
          lastCheckedAt: new Date().toISOString(),
        });
      }
    }

    products.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      type: product.type,
      carbsGrams: carbsResolution.carbsGrams,
      carbsSource: carbsResolution.source,
      offers,
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        analysis: stats,
        products,
      },
      null,
      2,
    ),
  );

  await writeFile(cachePath, JSON.stringify(cache, null, 2));

  console.log(`Updated ${products.length} products in ${outputPath}`);
  console.log(
    `Mode: ${stats.mode}, fetched: ${stats.pagesFetched}, cache hits: ${stats.pagesFromCache}, live prices: ${stats.offerPricesFromLive}, fallback prices: ${stats.offerPricesFromFallback}, skipped prices: ${stats.offerPricesSkipped}`,
  );
}

async function getProductSignals(product, cache, stats) {
  const sourceUrls = [
    ...(product.nutritionSources ?? []).map((source) => source.url),
    ...product.offers.map((offer) => offer.productUrl),
  ];
  const uniqueUrls = [...new Set(sourceUrls.filter(Boolean))];
  const signals = [];
  const byUrl = new Map();

  for (const url of uniqueUrls) {
    const pageSignals = await getPageSignals(url, cache, stats);
    if (!pageSignals) {
      continue;
    }

    const enrichedSignals = enrichPageSignals(url, pageSignals);
    signals.push(enrichedSignals);
    byUrl.set(url, enrichedSignals);
  }

  return { signals, byUrl };
}

function resolveProductCarbs(product, productSignals, stats) {
  const liveCandidates = [];

  for (const pageSignals of productSignals) {
    for (const candidate of pageSignals.carbCandidates ?? []) {
      liveCandidates.push({ ...candidate, url: pageSignals.url });
    }
  }

  const chosenLiveCandidate = chooseBestCarbCandidate(
    liveCandidates,
    product.carbsGrams,
  );

  if (chosenLiveCandidate) {
    stats.carbsFromLive += 1;
    return {
      carbsGrams: chosenLiveCandidate.value,
      source: chosenLiveCandidate.url,
    };
  }

  stats.carbsFromCatalog += 1;
  return {
    carbsGrams: product.carbsGrams,
    source: "catalog",
  };
}

function resolveOfferPrice(
  product,
  offer,
  pageSignals,
  productUnitResolution,
  singleUnitPrice,
  stats,
) {
  const candidates = pageSignals?.priceCandidates ?? [];
  const packageCandidate = choosePackagePriceCandidate(candidates);
  const unitResolution = resolveOfferUnitCount(
    product,
    offer,
    pageSignals,
    productUnitResolution,
    packageCandidate,
    singleUnitPrice,
  );
  const liveCandidate = chooseBestPriceCandidate(candidates, {
    ...offer,
    unitCount: unitResolution.unitCount,
  });

  trackUnitCountStats(unitResolution, stats);

  if (liveCandidate && isReliableUnitPrice(liveCandidate.value)) {
    const verification = buildOfferVerification({
      priceConfidence: liveCandidate.confidence ?? "live",
      priceSource: liveCandidate.url ?? offer.productUrl,
      packagePrice: liveCandidate.packagePrice,
      unitCount: unitResolution.unitCount,
      unitCountSource: unitResolution.source,
      unitCountConfidence: unitResolution.confidence,
    });

    stats.offerPricesFromLive += 1;
    return {
      price: round(liveCandidate.value),
      packagePrice: round(liveCandidate.packagePrice),
      unitCount: unitResolution.unitCount,
      unitCountSource: unitResolution.source,
      unitCountConfidence: unitResolution.confidence,
      source: liveCandidate.url ?? offer.productUrl,
      confidence: liveCandidate.confidence ?? "live",
      ...verification,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  if (Number.isFinite(offer.fallbackPrice) && offer.fallbackPrice > 0) {
    const fallbackUnitCount =
      Number.isFinite(offer.unitCount) && offer.unitCount > 0
        ? offer.unitCount
        : unitResolution.unitCount;

    stats.offerPricesFromFallback += 1;
    return {
      price: offer.fallbackPrice,
      packagePrice: round(offer.fallbackPrice * fallbackUnitCount),
      unitCount: fallbackUnitCount,
      unitCountSource: Number.isFinite(offer.unitCount)
        ? "catalog-unit-count"
        : unitResolution.source,
      unitCountConfidence: Number.isFinite(offer.unitCount)
        ? "catalog"
        : unitResolution.confidence,
      source: "catalog-fallback",
      confidence: "fallback",
      verificationStatus: "fallback",
      verificationLabel: "Prix de secours",
      verificationReason:
        "Aucun prix live fiable n'a été retenu; le catalogue sert de valeur temporaire.",
      lastCheckedAt: new Date().toISOString(),
    };
  }

  return {
    price: null,
    packagePrice: null,
    unitCount: unitResolution.unitCount,
    unitCountSource: unitResolution.source,
    unitCountConfidence: unitResolution.confidence,
    source: null,
    confidence: "missing",
    verificationStatus: "review",
    verificationLabel: "À vérifier",
    verificationReason: "Aucun prix utilisable n'a été détecté pour cette offre.",
    lastCheckedAt: new Date().toISOString(),
  };
}

function buildOfferVerification({
  priceConfidence,
  priceSource,
  packagePrice,
  unitCount,
  unitCountSource,
  unitCountConfidence,
}) {
  if (priceConfidence === "fallback") {
    return {
      verificationStatus: "fallback",
      verificationLabel: "Prix de secours",
      verificationReason:
        "Le prix vient du catalogue parce que l'extraction live n'a pas donné un résultat fiable.",
    };
  }

  if (
    unitCountConfidence === "default" &&
    Number.isFinite(packagePrice) &&
    packagePrice > MAX_UNIT_PRICE
  ) {
    return {
      verificationStatus: "review",
      verificationLabel: "À vérifier",
      verificationReason:
        "Le prix ressemble à un paquet, mais le nombre de portions n'a pas été confirmé.",
    };
  }

  if (priceConfidence === "live-text") {
    return {
      verificationStatus: "estimated",
      verificationLabel: "Prix estimé",
      verificationReason:
        "Le prix vient d'une page live, mais une partie du calcul a été déduite automatiquement.",
    };
  }

  if (
    unitCountConfidence === "inferred" &&
    isTrustedInferredUnitCount({
      packagePrice,
      unitCount,
      unitCountSource,
    })
  ) {
    return {
      verificationStatus: "verified",
      verificationLabel: "Prix vérifié",
      verificationReason:
        "Le prix vient d'une page vendeur et le format de portion a été confirmé par une déduction cohérente entre le prix de boîte et le prix unitaire.",
    };
  }

  if (unitCountConfidence === "inferred") {
    return {
      verificationStatus: "estimated",
      verificationLabel: "Prix estimé",
      verificationReason:
        "Le prix vient d'une page live, mais une partie du calcul a été déduite automatiquement.",
    };
  }

  if (priceSource && unitCountConfidence !== "default") {
    return {
      verificationStatus: "verified",
      verificationLabel: "Prix vérifié",
      verificationReason:
        "Le prix et le format de portion ont été trouvés sur une page vendeur ou confirmés par le catalogue.",
    };
  }

  return {
    verificationStatus: "estimated",
    verificationLabel: "Prix estimé",
    verificationReason:
      "Le prix est live, mais le format exact de portion reste moins explicite.",
  };
}

function isTrustedInferredUnitCount({ packagePrice, unitCount, unitCountSource }) {
  if (
    !Number.isFinite(packagePrice) ||
    !Number.isFinite(unitCount) ||
    packagePrice <= MAX_UNIT_PRICE ||
    unitCount <= 1
  ) {
    return false;
  }

  if (
    unitCountSource !== "price-peer-inference" &&
    unitCountSource !== "package-price-inference"
  ) {
    return false;
  }

  const unitPrice = packagePrice / unitCount;
  return isReliableUnitPrice(unitPrice) && COMMON_UNIT_COUNTS.includes(unitCount);
}

async function getPageSignals(url, cache, stats) {
  const cached = cache.pages?.[url];
  if (cached) {
    stats.pagesFromCache += 1;
    return cached;
  }

  return null;
}

function extractPageSignals(url, html) {
  const normalizedHtml = html.replace(/\s+/g, " ");
  const text = stripHtml(html);

  return {
    title: extractTitle(html),
    priceCandidates: extractPriceCandidates(normalizedHtml, url).map((candidate) => ({
      ...candidate,
      url,
    })),
    carbCandidates: extractCarbCandidates(text).map((candidate) => ({
      ...candidate,
      url,
    })),
    servingCandidates: extractServingCandidates(text).map((candidate) => ({
      ...candidate,
      url,
    })),
    packageCountCandidates: extractPackageCountCandidates(
      `${extractTitle(html) ?? ""} ${decodeUrlForSignals(url)} ${text}`,
    )
      .concat(
        extractSinglePackageCountCandidates(
          `${extractTitle(html) ?? ""} ${decodeUrlForSignals(url)}`,
        ),
      )
      .concat(extractOdooSingleFormatCandidates(normalizedHtml, url))
      .map((candidate) => ({
        ...candidate,
        url,
      })),
  };
}

function enrichPageSignals(url, pageSignals) {
  const title = pageSignals.title ?? null;
  const locationText = `${title ?? ""} ${decodeUrlForSignals(url)}`;

  return {
    ...pageSignals,
    url,
    packageCountCandidates: dedupeNumberCandidates([
      ...(pageSignals.packageCountCandidates ?? []),
      ...extractPackageCountCandidates(locationText).map((candidate) => ({
        ...candidate,
        url,
      })),
      ...extractSinglePackageCountCandidates(locationText).map((candidate) => ({
        ...candidate,
        url,
      })),
    ]),
  };
}

function extractPriceCandidates(html, url) {
  const candidates = [];
  const derivedCandidates = extractOdooSelectedVariantPriceCandidates(html, url);
  const jsonLdMatches = [
    ...tagMatches(html.matchAll(/"price"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi), "structured"),
    ...tagMatches(html.matchAll(/"price"\s*:\s*(\d+(?:[.,]\d+)?)/gi), "structured"),
    ...tagMatches(html.matchAll(/"salePrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi), "structured"),
    ...tagMatches(html.matchAll(/"salePrice"\s*:\s*(\d+(?:[.,]\d+)?)/gi), "structured"),
    ...tagMatches(html.matchAll(/"offerPrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi), "structured"),
    ...tagMatches(html.matchAll(/"offerPrice"\s*:\s*(\d+(?:[.,]\d+)?)/gi), "structured"),
    ...tagMatches(html.matchAll(/itemprop=["']price["'][^>]*>\s*(\d+(?:[.,]\d+)?)/gi), "structured"),
  ];
  const metaMatches = [
    ...tagMatches(html.matchAll(
      /(?:product:price:amount|price" content=|price\" content=\")\s*[:=]?\s*"?(\d+(?:[.,]\d+)?)/gi,
    ), "meta"),
    ...tagMatches(html.matchAll(
      /(?:sale:price|discounted.price|offer.price)[^0-9]*(\d+(?:[.,]\d+)?)/gi,
    ), "meta"),
  ];
  const currencyMatches = [
    ...html.matchAll(/"priceCurrency"\s*:\s*"([A-Z]{3})"/gi),
    ...html.matchAll(/(?:currency|Currency)\s*[:=]\s*"([A-Z]{3})"/g),
  ];
  const textMatches = [
    ...tagMatches(html.matchAll(/\$\s*(\d+(?:[.,]\d+)?)/g), "text"),
    ...tagMatches(html.matchAll(/(\d+(?:[.,]\d+)?)\s*\$/g), "text"),
    ...tagMatches(
      html.matchAll(/(?:prix de vente|sale price|discounted|offre)[^0-9]*\$?\s*(\d+(?:[.,]\d+)?)/gi),
      "text",
    ),
  ];

  const currencies = currencyMatches.map((match) => match[1].toUpperCase());
  const assumedCurrency = currencies.includes("CAD")
    ? "CAD"
    : currencies[0] ?? null;

  for (const candidate of derivedCandidates) {
    candidates.push({
      ...candidate,
      currency: candidate.currency ?? assumedCurrency,
    });
  }

  for (const match of [...jsonLdMatches, ...metaMatches, ...textMatches]) {
    const value = parseDecimal(match[1]);
    if (value === null || value <= 0) {
      continue;
    }

    for (const normalizedValue of normalizeMoneyValues(value)) {
      candidates.push({
        value: normalizedValue,
        currency: assumedCurrency,
        confidence: match.source === "text" ? "live-text" : "live",
        sourceType: match.source,
      });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function extractOdooSelectedVariantPriceCandidates(html, url) {
  const basePrice = extractOdooBasePrice(html);
  if (basePrice === null) {
    return [];
  }

  const selectedAttributeIds = getOdooAttributeValueIds(url);
  if (selectedAttributeIds.size === 0) {
    return [];
  }

  let selectedExtras = 0;
  for (const inputMatch of html.matchAll(/<input\b[^>]*>/gi)) {
    const inputTag = inputMatch[0];
    const attributeId = getHtmlAttribute(inputTag, "data-attribute-value-id");
    if (!attributeId || !selectedAttributeIds.has(attributeId)) {
      continue;
    }

    const nearbyHtml = html.slice(inputMatch.index, inputMatch.index + 900);
    const extraMatch = nearbyHtml.match(/variant_price_extra[\s\S]{0,180}?oe_currency_value[^>]*>\s*(\d+(?:[.,]\d+)?)/i);
    const extraValue = extraMatch ? parseDecimal(extraMatch[1]) : null;
    if (Number.isFinite(extraValue)) {
      selectedExtras += extraValue;
    }
  }

  const selectedPrice = round(basePrice + selectedExtras);
  return [
    {
      value: selectedPrice,
      currency: null,
      confidence: "live",
      sourceType: "structured",
    },
  ];
}

function extractOdooBasePrice(html) {
  const itemPropMatch = html.match(/itemprop=["']price["'][^>]*>\s*(\d+(?:[.,]\d+)?)/i);
  if (itemPropMatch) {
    return parseDecimal(itemPropMatch[1]);
  }

  const priceMatch = html.match(/class=["'][^"']*\boe_price\b[^"']*["'][\s\S]{0,160}?oe_currency_value[^>]*>\s*(\d+(?:[.,]\d+)?)/i);
  return priceMatch ? parseDecimal(priceMatch[1]) : null;
}

function extractOdooSingleFormatCandidates(html, url) {
  const selectedAttributeIds = getOdooAttributeValueIds(url);
  const candidates = [];

  for (const inputMatch of html.matchAll(/<input\b[^>]*>/gi)) {
    const inputTag = inputMatch[0];
    if (getHtmlAttribute(inputTag, "data-attribute_name") !== "Format") {
      continue;
    }

    const attributeId = getHtmlAttribute(inputTag, "data-attribute-value-id");
    const isSelected =
      (attributeId && selectedAttributeIds.has(attributeId)) ||
      /checked=["']True["']/i.test(inputTag);
    if (!isSelected || !/data-is_single=["']True["']/i.test(inputTag)) {
      continue;
    }

    candidates.push({
      value: 1,
      confidence: "live",
      sourceType: "single",
    });
  }

  return candidates;
}

function getOdooAttributeValueIds(url) {
  try {
    const hash = new URL(url).hash;
    const match = hash.match(/attribute_values=([^&]+)/i);
    if (!match) {
      return new Set();
    }

    return new Set(match[1].split(/[^0-9]+/).filter(Boolean));
  } catch {
    return new Set();
  }
}

function getHtmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1] ?? null;
}

function tagMatches(matches, source) {
  return [...matches].map((match) => Object.assign(match, { source }));
}

function extractCarbCandidates(text) {
  const candidates = [];
  const patterns = [
    /(carbohydrates?|carbohydrate|glucides?)[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*g/gi,
    /(\d+(?:[.,]\d+)?)\s*g[^a-z]{0,20}(carbohydrates?|carbohydrate|glucides?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawValue = match[2] ?? match[1];
      const value = parseDecimal(rawValue);
      if (value === null || value <= 0 || value > 200) {
        continue;
      }

      candidates.push({
        value,
        confidence: "live",
      });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function extractServingCandidates(text) {
  const candidates = [];
  const patterns = [
    {
      pattern: /(?:servings? per container|portions? par contenant|nombre de portions|servings?|portions?)[^0-9]{0,24}(\d+(?:[.,]\d+)?)/gi,
      sourceType: "serving-label",
    },
    {
      pattern: /(\d+(?:[.,]\d+)?)\s*(?:servings?|portions?)(?!\s*(?:of|de)?\s*(?:carb|glucide))/gi,
      sourceType: "serving-count",
    },
  ];

  for (const { pattern, sourceType } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawValue = match[1];
      const value = parseDecimal(rawValue);
      if (value === null || value <= 0 || value > MAX_AUTO_UNIT_COUNT) {
        continue;
      }

      candidates.push({
        value,
        confidence: "live",
        sourceType,
      });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function extractPackageCountCandidates(text) {
  const normalizedText = normalizeSignalText(text);
  const candidates = [];
  const patterns = [
    {
      pattern: /(?:box|case|pack|paquet|boite|bundle)\s*(?:of|de)?\s*(\d{1,3})\b/gi,
      sourceType: "package-label",
    },
    {
      pattern: /\b(\d{1,3})\s*(?:x|ct|count|pack|servings?|portions?|gels|bars|barres|sachets|chews|stroopwafels)\b/gi,
      sourceType: "package-count",
    },
  ];

  for (const { pattern, sourceType, fixedValue } of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const value = fixedValue ?? parseDecimal(match[1]);
      if (value === null || value <= 0 || value > MAX_AUTO_UNIT_COUNT) {
        continue;
      }

      candidates.push({
        value,
        confidence: "live",
        sourceType,
      });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function extractSinglePackageCountCandidates(locationText) {
  const normalizedText = normalizeSignalText(locationText);
  const candidates = [];
  const patterns = [
    /\b(?:single serving|single serve|sample|echantillon)\b/gi,
    /\b1\s*(?:barre|bar|gel)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      candidates.push({
        value: 1,
        confidence: "live",
        sourceType: "single",
      });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function chooseBestPriceCandidate(candidates, offer) {
  if (candidates.length === 0) {
    return null;
  }

  const normalized = candidates
    .flatMap((candidate, index) => {
      const unitCount = Number.isFinite(offer.unitCount) ? offer.unitCount : 1;
      return normalizeMoneyValues(candidate.value).map((packagePrice) => ({
        ...candidate,
        packagePrice,
        value: round(packagePrice / unitCount),
        sourceScore: getPriceSourceScore(candidate, index),
        packageScore: getPackagePriceScore(packagePrice),
      }));
    })
    .filter((candidate) => candidate.value > 0 && candidate.packagePrice <= MAX_PACKAGE_PRICE)
    .filter((candidate) => !candidate.currency || candidate.currency === "CAD");

  if (normalized.length === 0) {
    return null;
  }

  const ranked = normalized
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.sourceScore +
        candidate.packageScore +
        getUnitPriceScore(candidate.value),
    }))
    .filter((candidate) => isReliableUnitPrice(candidate.value))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.sourceScore - a.sourceScore ||
        a.packagePrice - b.packagePrice,
    );

  return ranked[0] ?? null;
}

function choosePackagePriceCandidate(candidates) {
  const normalized = candidates
    .flatMap((candidate, index) =>
      normalizeMoneyValues(candidate.value).map((value) => ({
        ...candidate,
        value,
        sourceScore: getPriceSourceScore(candidate, index),
        packageScore: getPackagePriceScore(value),
      })),
    )
    .filter((candidate) => candidate.value > 0 && candidate.value <= MAX_PACKAGE_PRICE)
    .filter((candidate) => !candidate.currency || candidate.currency === "CAD")
    .map((candidate) => ({
      ...candidate,
      score: candidate.sourceScore + candidate.packageScore,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.sourceScore - a.sourceScore ||
        a.value - b.value,
    );

  return normalized[0] ?? null;
}

function chooseBestCarbCandidate(candidates, fallbackValue) {
  if (candidates.length === 0) {
    return null;
  }

  const positive = candidates.filter((candidate) => candidate.value > 0);
  if (positive.length === 0) {
    return null;
  }

  if (!Number.isFinite(fallbackValue)) {
    return positive.sort((a, b) => a.value - b.value)[0];
  }

  return positive
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - fallbackValue),
    }))
    .sort((a, b) => a.distance - b.distance || a.value - b.value)[0];
}

function resolveProductUnitCount(product, productSignals, offerPackages, singleUnitPrice) {
  const candidates = [];

  for (const pageSignals of productSignals) {
    candidates.push(
      ...getUnitCandidatesFromPage(pageSignals).map((candidate) => ({
        ...candidate,
        url: pageSignals.url,
      })),
    );
  }

  const packagePrices = offerPackages
    .map((entry) => entry.packageCandidate?.value)
    .filter((value) => Number.isFinite(value));
  const chosen = chooseBestUnitCount(candidates, product, packagePrices, singleUnitPrice);

  if (chosen) {
    return {
      unitCount: chosen.value,
      source: chosen.url ?? "live",
      confidence: chosen.sourceType === "single" ? "live-single" : "live",
    };
  }

  return {
    unitCount: 1,
    source: "default-single",
    confidence: "default",
  };
}

function resolveOfferUnitCount(
  product,
  offer,
  pageSignals,
  productUnitResolution,
  packageCandidate,
  singleUnitPrice,
) {
  if (Number.isFinite(offer.unitCount) && offer.unitCount > 0) {
    return {
      unitCount: offer.unitCount,
      source: "catalog-unit-count",
      confidence: "catalog",
    };
  }

  const packagePrice = packageCandidate?.value;
  const offerCandidates = getUnitCandidatesFromPage(pageSignals);
  const offerUnit = chooseBestUnitCount(
    offerCandidates,
    product,
    Number.isFinite(packagePrice) ? [packagePrice] : [],
    singleUnitPrice,
  );

  if (offerUnit) {
    return {
      unitCount: offerUnit.value,
      source: offerUnit.url ?? pageSignals?.url ?? offer.productUrl,
      confidence: offerUnit.sourceType === "single" ? "live-single" : "live",
    };
  }

  const inferredFromPeerPrice = inferUnitCountFromPeerPrice(
    packagePrice,
    singleUnitPrice,
  );
  if (inferredFromPeerPrice) {
    return {
      unitCount: inferredFromPeerPrice,
      source: "price-peer-inference",
      confidence: "inferred",
    };
  }

  if (
    productUnitResolution.unitCount > 1 &&
    Number.isFinite(packagePrice) &&
    packagePrice > MAX_UNIT_PRICE &&
    isReliableUnitPrice(packagePrice / productUnitResolution.unitCount)
  ) {
    return {
      unitCount: productUnitResolution.unitCount,
      source: productUnitResolution.source,
      confidence: productUnitResolution.confidence,
    };
  }

  const inferredFromPackagePrice = inferUnitCountFromPackagePrice(packagePrice, product);
  if (inferredFromPackagePrice) {
    return {
      unitCount: inferredFromPackagePrice,
      source: "package-price-inference",
      confidence: "inferred",
    };
  }

  return {
    unitCount: 1,
    source: "default-single",
    confidence: "default",
  };
}

function getUnitCandidatesFromPage(pageSignals) {
  if (!pageSignals) {
    return [];
  }

  return dedupeNumberCandidates([
    ...(pageSignals.packageCountCandidates ?? []).map((candidate) => ({
      ...candidate,
      sourceType: candidate.sourceType ?? "package-count",
    })),
    ...(pageSignals.servingCandidates ?? []).map((candidate) => ({
      ...candidate,
      sourceType: candidate.sourceType ?? "serving-count",
    })),
  ])
    .map((candidate) => ({
      ...candidate,
      value: Math.round(candidate.value),
    }))
    .filter((candidate) => candidate.value > 0 && candidate.value <= MAX_AUTO_UNIT_COUNT);
}

function chooseBestUnitCount(candidates, product, packagePrices, singleUnitPrice) {
  const ranked = candidates
    .filter((candidate) => Number.isFinite(candidate.value))
    .map((candidate) => ({
      ...candidate,
      score: getUnitCountScore(candidate, product, packagePrices, singleUnitPrice),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(COMMON_UNIT_COUNTS.includes(b.value)) -
          Number(COMMON_UNIT_COUNTS.includes(a.value)) ||
        a.value - b.value,
    );

  return ranked[0] ?? null;
}

function getUnitCountScore(candidate, product, packagePrices, singleUnitPrice) {
  const value = candidate.value;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AUTO_UNIT_COUNT) {
    return -Infinity;
  }

  const isServingSignal =
    candidate.sourceType === "serving-label" ||
    candidate.sourceType === "serving-count";
  const isPackageSignal =
    candidate.sourceType === "package-label" ||
    candidate.sourceType === "package-count" ||
    candidate.sourceType === "single";

  if (isServingSignal && product.type !== "Boisson") {
    return -Infinity;
  }

  let score = 0;
  if (candidate.sourceType === "single") {
    score += value === 1 ? 12 : -8;
  } else if (candidate.sourceType === "package-label") {
    score += 10;
  } else if (candidate.sourceType === "package-count") {
    score += 8;
  } else if (candidate.sourceType === "serving-label") {
    score += 7;
  } else if (candidate.sourceType === "serving-count") {
    score += 4;
  } else {
    score += 2;
  }

  if (COMMON_UNIT_COUNTS.includes(value)) {
    score += 2;
  }

  if (value === product.carbsGrams && !isPackageSignal) {
    score -= 5;
  }

  if (value === product.caffeineMg && !isPackageSignal) {
    score -= 5;
  }

  let hasPriceEvidence = packagePrices.length === 0;
  for (const packagePrice of packagePrices) {
    if (!Number.isFinite(packagePrice) || packagePrice <= 0) {
      continue;
    }

    const unitPrice = packagePrice / value;
    if (
      unitPrice >= getMinimumPlausibleUnitPrice(product) &&
      unitPrice <= MAX_UNIT_PRICE
    ) {
      hasPriceEvidence = true;
      score += 4;
    }

    if (unitPrice >= 1.5 && unitPrice <= 12) {
      score += 3;
    }

    if (Number.isFinite(singleUnitPrice) && singleUnitPrice > 0) {
      const estimatedCount = packagePrice / singleUnitPrice;
      const ratio = value / estimatedCount;
      if (ratio >= 0.75 && ratio <= 1.35) {
        score += 6;
      }
    }
  }

  if (isServingSignal && !hasPriceEvidence) {
    return -Infinity;
  }

  if (isPackageSignal && packagePrices.length > 0 && !hasPriceEvidence) {
    return -Infinity;
  }

  if (value === 1 && candidate.sourceType !== "single") {
    score -= 3;
  }

  return score;
}

function inferSingleUnitPrice(offerPackages) {
  const unitLikePrices = offerPackages
    .filter((entry) => {
      const value = entry.packageCandidate?.value;
      if (!Number.isFinite(value) || value <= 0 || value > MAX_UNIT_PRICE) {
        return false;
      }

      const locationText = normalizeSignalText(`${entry.pageSignals?.title ?? ""} ${decodeUrlForSignals(entry.offer.productUrl)}`);
      return (
        /(?:single serving|single serve|sample|echantillon|1\s*barre|1\s*bar|1\s*gel)/i.test(locationText) ||
        !/(?:box|boite|case|pack|paquet|bundle)/i.test(locationText)
      );
    })
    .map((entry) => entry.packageCandidate.value)
    .sort((a, b) => a - b);

  if (unitLikePrices.length === 0) {
    return null;
  }

  return unitLikePrices[Math.floor(unitLikePrices.length / 2)];
}

function inferUnitCountFromPeerPrice(packagePrice, singleUnitPrice) {
  if (
    !Number.isFinite(packagePrice) ||
    !Number.isFinite(singleUnitPrice) ||
    packagePrice <= MAX_UNIT_PRICE ||
    singleUnitPrice <= 0
  ) {
    return null;
  }

  const estimated = packagePrice / singleUnitPrice;
  const nearestCommon = COMMON_UNIT_COUNTS
    .map((count) => ({
      count,
      distance: Math.abs(count - estimated) / estimated,
    }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearestCommon && nearestCommon.distance <= 0.25) {
    return nearestCommon.count;
  }

  const rounded = Math.round(estimated);
  if (rounded > 1 && rounded <= MAX_AUTO_UNIT_COUNT) {
    return rounded;
  }

  return null;
}

function inferUnitCountFromPackagePrice(packagePrice, product) {
  if (!Number.isFinite(packagePrice) || packagePrice <= MAX_UNIT_PRICE) {
    return null;
  }

  const targetUnitPrice = getExpectedUnitPrice(product);
  const best = COMMON_UNIT_COUNTS
    .map((count) => {
      const unitPrice = packagePrice / count;
      return {
        count,
        unitPrice,
        distance: Math.abs(unitPrice - targetUnitPrice) / targetUnitPrice,
      };
    })
    .filter((candidate) => isReliableUnitPrice(candidate.unitPrice))
    .sort((a, b) => a.distance - b.distance || a.count - b.count)[0];

  if (best && best.distance <= 0.45) {
    return best.count;
  }

  return null;
}

function getMinimumPlausibleUnitPrice(product) {
  if (product.type === "Gel" || product.type === "Barre" || product.type === "Autre") {
    return 1.25;
  }

  return MIN_UNIT_PRICE;
}

function getExpectedUnitPrice(product) {
  if (product.carbsGrams >= 80) {
    return 8;
  }

  if (product.type === "Gel") {
    return product.carbsGrams >= 40 ? 7 : 5;
  }

  if (product.type === "Barre" || product.type === "Autre") {
    return product.carbsGrams >= 50 ? 4.5 : 3.75;
  }

  if (product.type === "Boisson") {
    return product.carbsGrams >= 60 ? 5.5 : 3.5;
  }

  return 4;
}

function trackUnitCountStats(unitResolution, stats) {
  if (unitResolution.confidence === "catalog") {
    stats.unitCountsFromCatalog += 1;
    return;
  }

  if (unitResolution.confidence === "inferred") {
    stats.unitCountsInferredFromPrice += 1;
    return;
  }

  if (unitResolution.confidence === "default") {
    stats.unitCountsDefaulted += 1;
    return;
  }

  stats.unitCountsFromLive += 1;
}

function dedupeNumberCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((candidate) => [
        `${candidate.value}:${candidate.currency ?? "na"}:${candidate.sourceType ?? "na"}`,
        candidate,
      ]),
    ).values(),
  ];
}

function normalizeMoneyValues(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return [];
  }

  const values = [round(value)];
  if (Number.isInteger(value) && value >= 1000) {
    values.push(round(value / 100));
  }

  return [...new Set(values)].filter(
    (candidate) => candidate > 0 && candidate <= MAX_PACKAGE_PRICE,
  );
}

function getPriceSourceScore(candidate, index) {
  const sourceType = candidate.sourceType;
  if (sourceType === "structured") {
    return 20 - index * 0.01;
  }

  if (sourceType === "meta") {
    return 16 - index * 0.01;
  }

  if (sourceType === "text") {
    return 8 - index * 0.01;
  }

  return 12 - index * 0.5;
}

function getPackagePriceScore(value) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_PACKAGE_PRICE) {
    return -Infinity;
  }

  let score = 0;
  if (value >= MIN_UNIT_PRICE && value <= MAX_UNIT_PRICE) {
    score += 4;
  }

  if (value < 1.25) {
    score -= 5;
  }

  if (value > MAX_UNIT_PRICE && value <= MAX_PACKAGE_PRICE) {
    score += 3;
  }

  if (value > 100) {
    score -= 3;
  }

  if (Number.isInteger(value) && [30, 35, 40, 50, 60, 99, 100, 109, 160, 200].includes(value)) {
    score -= 3;
  }

  return score;
}

function getUnitPriceScore(value) {
  if (!isReliableUnitPrice(value)) {
    return -Infinity;
  }

  if (value >= 1.5 && value <= 10) {
    return 2;
  }

  return 0;
}

function isReliableUnitPrice(value) {
  return Number.isFinite(value) && value >= MIN_UNIT_PRICE && value <= MAX_UNIT_PRICE;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const match = html.match(/<title>(.*?)<\/title>/i);
  return match?.[1]?.trim() ?? null;
}

function decodeUrlForSignals(url) {
  try {
    const parsedUrl = new URL(url);
    return decodeURIComponent(parsedUrl.pathname)
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return url.replace(/[-_/]+/g, " ");
  }
}

function normalizeSignalText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDecimal(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(",", ".").replace(/[^\d.]/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCacheExpired(timestamp) {
  if (!timestamp) {
    return true;
  }

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) || Date.now() - date.getTime() > CACHE_MAX_AGE_MS;
}

async function readJson(filePath, fallbackValue) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallbackValue;
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

try {
  await main();
} catch (error) {
  console.error("Error in refresh-product-offers script:", error);
  process.exit(1);
}
