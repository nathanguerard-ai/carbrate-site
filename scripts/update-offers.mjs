import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(projectRoot, "data", "catalog.json");
const outputPath = path.join(projectRoot, "data", "generated-offers.json");
const cachePath = path.join(projectRoot, "data", "source-cache.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 4500;

const enableLiveFetch =
  process.argv.includes("--live") || process.env.CARBRATE_ENABLE_NETWORK === "1";

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
  if (cached && !isCacheExpired(cached.fetchedAt)) {
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
    const carbsResolution = await resolveProductCarbs(product, cache, stats);
    const offers = [];

    for (const offer of product.offers) {
      if (offer.country !== "CA") {
        continue;
      }

      const priceResolution = await resolveOfferPrice(offer, cache, stats);
      if (priceResolution.price === null) {
        continue;
      }

      offers.push({
        seller: offer.seller,
        price: priceResolution.price,
        productUrl: offer.productUrl,
        priceSource: priceResolution.source,
        priceConfidence: priceResolution.confidence,
      });
    }

    if (offers.length === 0) {
      for (const offer of product.offers) {
        if (offer.country !== "CA") {
          continue;
        }

        offers.push({
          seller: offer.seller,
          price: offer.fallbackPrice,
          productUrl: offer.productUrl,
          priceSource: "catalog-fallback",
          priceConfidence: "fallback",
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
    `Mode: ${stats.mode}, fetched: ${stats.pagesFetched}, cache hits: ${stats.pagesFromCache}, live prices: ${stats.offerPricesFromLive}, fallback prices: ${stats.offerPricesFromFallback}`,
  );
}

async function resolveProductCarbs(product, cache, stats) {
  const sourceUrls = [
    ...(product.nutritionSources ?? []).map((source) => source.url),
    ...product.offers.map((offer) => offer.productUrl),
  ];
  const uniqueUrls = [...new Set(sourceUrls.filter(Boolean))];

  const liveCandidates = [];

  for (const url of uniqueUrls) {
    const pageSignals = await getPageSignals(url, cache, stats);
    if (!pageSignals) {
      continue;
    }

    for (const candidate of pageSignals.carbCandidates ?? []) {
      liveCandidates.push({ ...candidate, url });
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

async function resolveOfferPrice(offer, cache, stats) {
  const pageSignals = await getPageSignals(offer.productUrl, cache, stats);
  const candidates = pageSignals?.priceCandidates ?? [];
  const servingCandidates = pageSignals?.servingCandidates ?? [];
  const liveUnitCount = chooseBestServingCandidate(servingCandidates, offer);
  const effectiveUnitCount = Number.isFinite(offer.unitCount) ? offer.unitCount : (liveUnitCount ?? 1);
  const liveCandidate = chooseBestPriceCandidate(candidates, { ...offer, unitCount: effectiveUnitCount });

  if (liveCandidate) {
    stats.offerPricesFromLive += 1;
    return {
      price: round(liveCandidate.value),
      source: liveCandidate.url ?? offer.productUrl,
      confidence: liveCandidate.confidence ?? "live",
    };
  }

  stats.offerPricesFromFallback += 1;
  return {
    price: offer.fallbackPrice,
    source: "catalog-fallback",
    confidence: "fallback",
  };
}

async function getPageSignals(url, cache, stats) {
  const cached = cache.pages?.[url];
  if (cached && !isCacheExpired(cached.fetchedAt)) {
    stats.pagesFromCache += 1;
    return cached;
  }

  // Since we prefetched, if not cached, return null
  return cached ?? null;
}

function extractPageSignals(url, html) {
  const normalizedHtml = html.replace(/\s+/g, " ");
  const text = stripHtml(html);

  return {
    title: extractTitle(html),
    priceCandidates: extractPriceCandidates(normalizedHtml).map((candidate) => ({
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
  };
}

function extractPriceCandidates(html) {
  const candidates = [];
  const jsonLdMatches = [
    ...html.matchAll(/"price"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi),
    ...html.matchAll(/"price"\s*:\s*(\d+(?:[.,]\d+)?)/gi),
    ...html.matchAll(/"salePrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi),
    ...html.matchAll(/"salePrice"\s*:\s*(\d+(?:[.,]\d+)?)/gi),
    ...html.matchAll(/"offerPrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi),
    ...html.matchAll(/"offerPrice"\s*:\s*(\d+(?:[.,]\d+)?)/gi),
  ];
  const metaMatches = [
    ...html.matchAll(
      /(?:product:price:amount|price" content=|price\" content=\")\s*[:=]?\s*"?(\d+(?:[.,]\d+)?)/gi,
    ),
    ...html.matchAll(
      /(?:sale:price|discounted.price|offer.price)[^0-9]*(\d+(?:[.,]\d+)?)/gi,
    ),
  ];
  const currencyMatches = [
    ...html.matchAll(/"priceCurrency"\s*:\s*"([A-Z]{3})"/gi),
    ...html.matchAll(/(?:currency|Currency)\s*[:=]\s*"([A-Z]{3})"/g),
  ];
  const textMatches = [
    ...html.matchAll(/\$\s*(\d+(?:[.,]\d+)?)/g),
    ...html.matchAll(/(\d+(?:[.,]\d+)?)\s*\$/g),
    ...html.matchAll(/(?:prix de vente|sale price|discounted|offre)[^0-9]*\$?\s*(\d+(?:[.,]\d+)?)/gi),
  ];

  const currencies = currencyMatches.map((match) => match[1].toUpperCase());
  const assumedCurrency = currencies.includes("CAD")
    ? "CAD"
    : currencies[0] ?? null;

  for (const match of [...jsonLdMatches, ...metaMatches, ...textMatches]) {
    const value = parseDecimal(match[1]);
    if (value === null || value <= 0) {
      continue;
    }

    candidates.push({
      value,
      currency: assumedCurrency,
      confidence: "live",
    });
  }

  return dedupeNumberCandidates(candidates);
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
    /(?:servings?|portions?|servings per container)[^0-9]{0,20}(\d+(?:[.,]\d+)?)/gi,
    /(\d+(?:[.,]\d+)?)\s*(?:servings?|portions?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const rawValue = match[1];
      const value = parseDecimal(rawValue);
      if (value === null || value <= 0 || value > 1000) {
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

function chooseBestPriceCandidate(candidates, offer) {
  if (candidates.length === 0) {
    return null;
  }

  const normalized = candidates
    .map((candidate) => {
      const unitCount = Number.isFinite(offer.unitCount) ? offer.unitCount : 1;
      const normalizedValue = candidate.value / unitCount;
      return {
        ...candidate,
        value: round(normalizedValue),
      };
    })
    .filter((candidate) => candidate.value > 0)
    .filter((candidate) => !candidate.currency || candidate.currency === "CAD");

  if (normalized.length === 0) {
    return null;
  }

  const baseline = offer.fallbackPrice;
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return normalized.sort((a, b) => a.value - b.value)[0];
  }

  const ranked = normalized
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs(candidate.value - baseline),
      ratio: candidate.value / baseline,
    }))
    .filter((candidate) => candidate.ratio >= 0.45 && candidate.ratio <= 2.25)
    .sort((a, b) => a.distance - b.distance || a.value - b.value);

  return ranked[0] ?? null;
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

function chooseBestServingCandidate(candidates, offer) {
  if (candidates.length === 0) {
    return null;
  }

  const positive = candidates.filter((candidate) => candidate.value > 0);
  if (positive.length === 0) {
    return null;
  }

  // If catalog has unitCount, prefer close matches
  if (Number.isFinite(offer.unitCount)) {
    return positive
      .map((candidate) => ({
        ...candidate,
        distance: Math.abs(candidate.value - offer.unitCount),
      }))
      .sort((a, b) => a.distance - b.distance || a.value - b.value)[0];
  }

  // Otherwise, take the most common or first
  return positive.sort((a, b) => a.value - b.value)[0];
}

function dedupeNumberCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((candidate) => [
        `${candidate.value}:${candidate.currency ?? "na"}`,
        candidate,
      ]),
    ).values(),
  ];
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
  console.error("Error in update-offers script:", error);
  process.exit(1);
}
