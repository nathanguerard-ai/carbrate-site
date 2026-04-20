import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(projectRoot, "data", "product-catalog.json");
const brandDiscoveryPath = path.join(projectRoot, "data", "brand-discovery.json");
const canadianRetailersPath = path.join(projectRoot, "data", "canadian-retailers.json");
const discoveredCatalogPath = path.join(projectRoot, "data", "discovered-product-catalog.json");
const outputPath = path.join(projectRoot, "data", "generated-product-offers.json");
const cachePath = path.join(projectRoot, "data", "product-page-cache.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 4500;
const SEARCH_TIMEOUT_MS = 6000;
const MIN_UNIT_PRICE = 0.5;
const MAX_UNIT_PRICE = 20;
const MAX_PACKAGE_PRICE = 250;
const MAX_AUTO_UNIT_COUNT = 60;
const COMMON_UNIT_COUNTS = [2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 18, 20, 24, 25, 30];
const STRONG_PACKAGE_SOURCE_TYPES = new Set([
  "url-package-label",
  "title-package-label",
  "url-package-count",
  "title-package-count",
  "odoo-format",
]);
const PACKAGE_SOURCE_TYPES = new Set([
  ...STRONG_PACKAGE_SOURCE_TYPES,
  "package-label",
  "package-count",
  "single",
]);
const SERVING_SOURCE_TYPES = new Set(["serving-label", "serving-count"]);
const execFileAsync = promisify(execFile);

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

  if (isBlockedOrEmptyHtml(html)) {
    return;
  }

  const pageSignals = extractPageSignals(url, html);
  if (cached && isCacheRegression(cached, pageSignals)) {
    return;
  }

  const nextEntry = {
    fetchedAt: new Date().toISOString(),
    ...pageSignals,
  };

  cache.pages[url] = nextEntry;
  stats.pagesFetched += 1;
}

async function main() {
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const brandDiscovery = await readJson(brandDiscoveryPath, { brands: [] });
  const canadianRetailers = await readJson(canadianRetailersPath, { retailers: [] });
  const brandConfigByBrand = new Map((brandDiscovery.brands ?? []).map((entry) => [entry.brand, entry]));
  const discoveredCatalogSnapshot = await readJson(discoveredCatalogPath, { products: [] });
  const cache = await readJson(cachePath, { pages: {}, searches: {} });
  const discoveredCatalog = await enrichCatalogWithDiscoveredProducts(
    {
      products: [
        ...catalog.products,
        ...(discoveredCatalogSnapshot.products ?? []),
      ],
    },
    brandDiscovery,
    cache,
    enableLiveFetch ? statsForDiscovery() : null,
  );
  const offerDiscoveredCatalog = await enrichCatalogWithDiscoveredOffers(
    discoveredCatalog.products,
    brandDiscovery,
    canadianRetailers,
    cache,
    discoveredCatalog.discoveryStats,
  );
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
    discoveredProductsAdded: discoveredCatalog.discoveryStats.discoveredProductsAdded,
    discoveredProductsSkipped: discoveredCatalog.discoveryStats.discoveredProductsSkipped,
    discoveredProductsMerged: discoveredCatalog.discoveryStats.discoveredProductsMerged,
    discoveredBrandsScanned: discoveredCatalog.discoveryStats.discoveredBrandsScanned,
    discoveryPagesFetched: discoveredCatalog.discoveryStats.discoveryPagesFetched,
    discoveredOfferUrlsAdded: discoveredCatalog.discoveryStats.discoveredOfferUrlsAdded,
    searchQueriesRun: discoveredCatalog.discoveryStats.searchQueriesRun,
    retailerSearchQueriesRun: discoveredCatalog.discoveryStats.retailerSearchQueriesRun,
  };

  // Collect all unique URLs to prefetch
  const allUrls = new Set();
  for (const product of offerDiscoveredCatalog.products) {
    const sourceUrls = [
      ...(product.nutritionSources ?? []).map((source) => source.url),
      ...product.offers.map((offer) => offer.productUrl),
    ];
    sourceUrls.filter(Boolean).forEach(url => allUrls.add(url));
  }

  // Prefetch all URLs in parallel with concurrency limit
  await prefetchUrls([...allUrls], cache, stats);

  for (const product of offerDiscoveredCatalog.products) {
    const productSignals = await getProductSignals(product, cache, stats);
    const offerPackages = product.offers.map((offer) => {
      const pageSignals = productSignals.byUrl.get(offer.productUrl);
      return {
        offer,
        pageSignals,
        packageCandidate: choosePackagePriceCandidate(
          pageSignals?.priceCandidates ?? [],
          {
            ...product,
            ...offer,
          },
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
      officialProductUrl: getOfficialProductUrl(product, brandConfigByBrand.get(product.brand)),
      offers,
    });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    discoveredCatalogPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        products: discoveredCatalog.products.filter((product) =>
          !catalog.products.some((entry) => entry.id === product.id),
        ),
      },
      null,
      2,
    ),
  );
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

function statsForDiscovery() {
  return {
    discoveredProductsAdded: 0,
    discoveredProductsSkipped: 0,
    discoveredProductsMerged: 0,
    discoveredBrandsScanned: 0,
    discoveryPagesFetched: 0,
    discoveredOfferUrlsAdded: 0,
    searchQueriesRun: 0,
    retailerSearchQueriesRun: 0,
  };
}

async function enrichCatalogWithDiscoveredProducts(catalog, discoveryConfig, cache, discoveryStats) {
  if (!enableLiveFetch || !Array.isArray(discoveryConfig?.brands) || discoveryConfig.brands.length === 0) {
    return {
      products: catalog.products,
      discoveryStats: discoveryStats ?? statsForDiscovery(),
    };
  }

  const products = [...catalog.products];
  const existingIds = new Set(products.map((product) => product.id));
  const existingUrls = new Set(
    products.flatMap((product) => [
      ...(product.nutritionSources ?? []).map((source) => normalizeComparableUrl(source.url)),
      ...product.offers.map((offer) => normalizeComparableUrl(offer.productUrl)),
    ]),
  );

  for (const brandConfig of discoveryConfig.brands) {
    discoveryStats.discoveredBrandsScanned += 1;
    const discoveredProducts = await discoverProductsForBrand(brandConfig, cache, discoveryStats);

    for (const discoveredProduct of discoveredProducts) {
      const comparableOfferUrls = (discoveredProduct.offers ?? []).map((offer) =>
        normalizeComparableUrl(offer.productUrl),
      );
      const comparableNutritionUrls = (discoveredProduct.nutritionSources ?? []).map((source) =>
        normalizeComparableUrl(source.url),
      );
      const knownUrl =
        comparableOfferUrls.some((url) => existingUrls.has(url)) ||
        comparableNutritionUrls.some((url) => existingUrls.has(url));
      const existingIndex = products.findIndex(
        (product) =>
          product.id === discoveredProduct.id ||
          (product.brand === discoveredProduct.brand &&
            normalizeProductLabel(product.name) === normalizeProductLabel(discoveredProduct.name)),
      );

      if (existingIndex >= 0) {
        products[existingIndex] = mergeCatalogProducts(products[existingIndex], discoveredProduct);
        discoveryStats.discoveredProductsMerged += 1;
        for (const url of comparableOfferUrls.concat(comparableNutritionUrls)) {
          existingUrls.add(url);
        }
        existingIds.add(products[existingIndex].id);
        continue;
      }

      if (knownUrl || existingIds.has(discoveredProduct.id)) {
        discoveryStats.discoveredProductsSkipped += 1;
        continue;
      }

      products.push(discoveredProduct);
      discoveryStats.discoveredProductsAdded += 1;
      existingIds.add(discoveredProduct.id);
      for (const url of comparableOfferUrls.concat(comparableNutritionUrls)) {
        existingUrls.add(url);
      }
    }
  }

  return {
    products,
    discoveryStats,
  };
}

async function enrichCatalogWithDiscoveredOffers(
  products,
  discoveryConfig,
  retailerConfig,
  cache,
  discoveryStats,
) {
  if (!enableLiveFetch || !Array.isArray(products) || products.length === 0) {
    return { products, discoveryStats };
  }

  const configsByBrand = new Map(
    (discoveryConfig.brands ?? []).map((entry) => [entry.brand, entry]),
  );

  const nextProducts = [];
  for (const product of products) {
    const brandConfig = configsByBrand.get(product.brand);
    if (!brandConfig) {
      nextProducts.push(product);
      continue;
    }

    const discoveredOffers = await discoverOffersForProduct(
      product,
      brandConfig,
      retailerConfig,
      cache,
      discoveryStats,
    );
    if (discoveredOffers.length === 0) {
      nextProducts.push(product);
      continue;
    }

    const mergedOffers = dedupeByUrl(
      [...(product.offers ?? []), ...discoveredOffers],
      "productUrl",
    );
    discoveryStats.discoveredOfferUrlsAdded += Math.max(
      0,
      mergedOffers.length - (product.offers?.length ?? 0),
    );
    nextProducts.push({
      ...product,
      offers: mergedOffers,
    });
  }

  return { products: nextProducts, discoveryStats };
}

async function discoverOffersForProduct(
  product,
  brandConfig,
  retailerConfig,
  cache,
  discoveryStats,
) {
  const queries = buildProductSearchQueries(product);
  const resultUrls = new Set();
  const officialUrl = getOfficialProductUrl(product, brandConfig);
  if (officialUrl) {
    resultUrls.add(officialUrl);
  }

  const directRetailerResults = await searchKnownRetailersForProduct(
    product,
    brandConfig,
    retailerConfig,
    cache,
    discoveryStats,
  );
  for (const result of directRetailerResults) {
    resultUrls.add(result.url);
  }

  for (const query of queries) {
    const results = await searchProductUrls(query, cache, discoveryStats);
    for (const result of results) {
      if (!isLikelyCanadianOfferUrl(result.url, brandConfig, retailerConfig)) {
        continue;
      }

      if (!isLikelySearchResultMatch(product, result.title ?? "", result.url)) {
        continue;
      }

      resultUrls.add(result.url);
    }
  }

  const knownUrls = new Set(
    (product.offers ?? []).map((offer) => normalizeComparableUrl(offer.productUrl)),
  );
  const discoveredOffers = [];
  for (const url of resultUrls) {
    const normalizedUrl = normalizeComparableUrl(url);
    if (knownUrls.has(normalizedUrl)) {
      continue;
    }

    discoveredOffers.push({
      seller: sellerFromUrl(url),
      productUrl: url,
      country: "CA",
    });
  }

  return discoveredOffers;
}

async function discoverProductsForBrand(brandConfig, cache, discoveryStats) {
  const productUrls = new Set();

  for (const collectionUrl of brandConfig.collectionUrls ?? []) {
    const html = await fetchHtml(collectionUrl);
    if (!html) {
      continue;
    }

    discoveryStats.discoveryPagesFetched += 1;
    for (const productUrl of extractProductUrlsFromCollectionHtml(html, collectionUrl, brandConfig)) {
      productUrls.add(productUrl);
    }
  }

  const discoveredProducts = [];
  for (const productUrl of productUrls) {
    const discoveredProduct = await buildDiscoveredProduct(brandConfig, productUrl, cache);
    if (discoveredProduct) {
      discoveredProducts.push(discoveredProduct);
    } else {
      discoveryStats.discoveredProductsSkipped += 1;
    }
  }

  return discoveredProducts;
}

function buildProductSearchQueries(product) {
  const label = `${product.brand} ${product.name}`.trim();
  return [
    `"${label}" Canada`,
    `"${label}" Canada box`,
    `"${label}" Canada pack`,
  ];
}

async function searchKnownRetailersForProduct(
  product,
  brandConfig,
  retailerConfig,
  cache,
  discoveryStats,
) {
  const retailers = [...(retailerConfig?.retailers ?? [])]
    .filter((retailer) => retailer?.searchUrlTemplate)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const results = [];

  for (const retailer of retailers) {
    const query = buildRetailerSearchQuery(product);
    const links = await searchRetailerProductUrls(
      retailer,
      query,
      product,
      brandConfig,
      cache,
      discoveryStats,
    );
    results.push(...links);
  }

  return dedupeByUrl(results, "url");
}

function buildRetailerSearchQuery(product) {
  return `${product.brand} ${product.name}`.trim();
}

async function searchRetailerProductUrls(
  retailer,
  query,
  product,
  brandConfig,
  cache,
  discoveryStats,
) {
  const cacheKey = `retailer:${retailer.seller}:${query}`;
  const cached = cache.searches?.[cacheKey];
  if (cached && !forceRefresh && !isCacheExpired(cached.fetchedAt)) {
    return cached.results ?? [];
  }

  const searchUrl = retailer.searchUrlTemplate.replace("{query}", encodeURIComponent(query));
  const html = await fetchHtml(searchUrl, { timeoutMs: SEARCH_TIMEOUT_MS });
  if (!html) {
    return cached?.results ?? [];
  }

  const results = extractRetailerProductResults(html, searchUrl, retailer, brandConfig)
    .filter((result) => isLikelySearchResultMatch(product, result.title ?? "", result.url));
  cache.searches ??= {};
  cache.searches[cacheKey] = {
    fetchedAt: new Date().toISOString(),
    results,
  };
  discoveryStats.retailerSearchQueriesRun += 1;
  return results;
}

async function searchProductUrls(query, cache, discoveryStats) {
  const cacheKey = `ddg:${query}`;
  const cached = cache.searches?.[cacheKey];
  if (cached && !forceRefresh && !isCacheExpired(cached.fetchedAt)) {
    return cached.results ?? [];
  }

  const html = await fetchSearchHtml(query);
  if (!html) {
    return cached?.results ?? [];
  }

  const results = extractDuckDuckGoResults(html);
  cache.searches ??= {};
  cache.searches[cacheKey] = {
    fetchedAt: new Date().toISOString(),
    results,
  };
  discoveryStats.searchQueriesRun += 1;
  return results;
}

async function fetchSearchHtml(query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const url = new URL("https://duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const response = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    const url = new URL("https://duckduckgo.com/html/");
    url.searchParams.set("q", query);
    return fetchHtmlWithCurl(url.toString(), SEARCH_TIMEOUT_MS);
  } finally {
    clearTimeout(timeout);
  }
}

function extractDuckDuckGoResults(html) {
  const results = [];
  for (const match of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = decodeDuckDuckGoUrl(match[1]);
    if (!url) {
      continue;
    }

    results.push({
      url,
      title: stripHtml(match[2]),
    });
  }

  return results;
}

function decodeDuckDuckGoUrl(url) {
  try {
    const resolved = new URL(url, "https://duckduckgo.com");
    const redirect = resolved.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : resolved.toString();
  } catch {
    return null;
  }
}

function isLikelyCanadianOfferUrl(url, brandConfig, retailerConfig = null) {
  try {
    const parsedUrl = new URL(url);
    if (brandConfig.allowedHosts?.includes(parsedUrl.hostname)) {
      return true;
    }

    if ((retailerConfig?.retailers ?? []).some((retailer) =>
      retailer.allowedHosts?.includes(parsedUrl.hostname),
    )) {
      return true;
    }

    if (parsedUrl.hostname.endsWith(".ca")) {
      return true;
    }

    return /\/ca\//i.test(parsedUrl.pathname) || /\/ca\//i.test(parsedUrl.toString());
  } catch {
    return false;
  }
}

function isLikelySearchResultMatch(product, title, url) {
  const haystack = normalizeSignalText(`${title} ${decodeUrlForSignals(url)}`).toLowerCase();
  const brandTokens = normalizeSignalText(product.brand)
    .toLowerCase()
    .split(/\s+/)
    .filter(isSignificantProductToken)
    .slice(0, 3);
  const nameTokens = normalizeSignalText(product.name)
    .toLowerCase()
    .split(/\s+/)
    .filter(isSignificantProductToken)
    .slice(0, 5);
  const matchedBrandTokens = brandTokens.filter((token) => haystack.includes(token));
  const matchedNameTokens = nameTokens.filter((token) => haystack.includes(token));
  const hasBrandMatch = brandTokens.length === 0 || matchedBrandTokens.length >= 1;
  const requiredNameMatches =
    nameTokens.length >= 3 ? 2 : Math.min(1, nameTokens.length);

  return hasBrandMatch && matchedNameTokens.length >= requiredNameMatches;
}

function isSignificantProductToken(token) {
  return token.length >= 3 || /^\d{2,3}$/.test(token);
}

function sellerFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractProductUrlsFromCollectionHtml(html, baseUrl, brandConfig) {
  const productUrls = new Set();

  for (const link of extractAnchorLinks(html, baseUrl)) {
    const candidate = link.url;
    if (!candidate) {
      continue;
    }

    if (!isAllowedDiscoveryProductUrl(candidate, brandConfig)) {
      continue;
    }

    productUrls.add(candidate);
  }

  return [...productUrls];
}

function extractRetailerProductResults(html, baseUrl, retailer, brandConfig) {
  const productPathPrefixes =
    retailer.productPathPrefixes ??
    brandConfig?.productPathPrefixes ??
    ["/products/", "/en/products/", "/fr/products/", "/shop/", "/product/"];

  return extractAnchorLinks(html, baseUrl)
    .filter((link) => isAllowedRetailerProductUrl(link.url, retailer, productPathPrefixes))
    .map((link) => ({
      url: link.url,
      title: link.title,
      seller: retailer.seller,
      priority: retailer.priority ?? 0,
    }));
}

function extractAnchorLinks(html, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolveUrl(baseUrl, match[1]);
    if (!url) {
      continue;
    }

    links.push({
      url,
      title: stripHtml(match[2] ?? ""),
    });
  }

  return links;
}

function isAllowedRetailerProductUrl(url, retailer, productPathPrefixes) {
  try {
    const parsedUrl = new URL(url);
    const hostAllowed =
      (retailer.allowedHosts ?? []).length === 0 ||
      retailer.allowedHosts.includes(parsedUrl.hostname);
    if (!hostAllowed) {
      return false;
    }

    if (/\b(search|collections?|blogs?|pages?|cart|account)\b/i.test(parsedUrl.pathname)) {
      return false;
    }

    return productPathPrefixes.some((prefix) => parsedUrl.pathname.startsWith(prefix));
  } catch {
    return false;
  }
}

function isAllowedDiscoveryProductUrl(url, brandConfig) {
  try {
    const parsedUrl = new URL(url);
    const hostAllowed =
      (brandConfig.allowedHosts ?? []).length === 0 ||
      brandConfig.allowedHosts.includes(parsedUrl.hostname);
    if (!hostAllowed) {
      return false;
    }

    const pathAllowed =
      (brandConfig.productPathPrefixes ?? []).length === 0 ||
      brandConfig.productPathPrefixes.some((prefix) => parsedUrl.pathname.startsWith(prefix));
    if (!pathAllowed) {
      return false;
    }

    return !(brandConfig.excludePathPatterns ?? []).some((pattern) =>
      parsedUrl.pathname.includes(pattern),
    );
  } catch {
    return false;
  }
}

async function buildDiscoveredProduct(brandConfig, productUrl, cache) {
  const pageSignals = await ensurePageSignals(productUrl, cache, {
    pagesFetched: 0,
    pagesFromCache: 0,
  });
  if (!pageSignals) {
    return null;
  }

  const html = await fetchHtml(productUrl);
  if (!html) {
    return null;
  }

  const text = stripHtml(html);
  const title = pageSignals.title ?? extractTitle(html);
  const name = cleanDiscoveredProductName(title, brandConfig.brand);
  const type = inferProductType(name, productUrl, text);
  const carbsGrams = chooseDiscoveredCarbValue(extractCarbCandidates(text), name, type);
  if (!name || !type || !Number.isFinite(carbsGrams) || carbsGrams <= 0) {
    return null;
  }

  const caffeineMg = chooseOptionalNutrientValue(extractCaffeineCandidates(text));
  const sodiumMg = chooseOptionalNutrientValue(extractSodiumCandidates(text));
  const packageCandidate = choosePackagePriceCandidate(pageSignals.priceCandidates ?? [], {
    brand: brandConfig.brand,
    name,
    type,
    carbsGrams,
  });
  const unitCountCandidate = chooseBestUnitCount(
    getUnitCandidatesFromPage(pageSignals),
    { type, carbsGrams, caffeineMg, sodiumMg },
    Number.isFinite(packageCandidate?.value) ? [packageCandidate.value] : [],
    null,
  );
  const unitCount = unitCountCandidate?.value ?? 1;
  const fallbackPrice = Number.isFinite(packageCandidate?.value)
    ? round(packageCandidate.value / unitCount)
    : null;
  if (!Number.isFinite(fallbackPrice) || fallbackPrice <= 0) {
    return null;
  }

  return {
    id: slugifyProductId(brandConfig.brand, name),
    name,
    brand: brandConfig.brand,
    type,
    carbsGrams,
    sodiumMg: Number.isFinite(sodiumMg) ? sodiumMg : null,
    caffeineMg: Number.isFinite(caffeineMg) ? caffeineMg : null,
    nutritionSources: [
      {
        label: `${brandConfig.brand} officiel`,
        url: productUrl,
      },
    ],
    offers: [
      {
        seller: brandConfig.seller,
        productUrl,
        country: brandConfig.country ?? "CA",
        ...(unitCount > 1 ? { unitCount } : {}),
        fallbackPrice,
      },
    ],
  };
}

function mergeCatalogProducts(existingProduct, discoveredProduct) {
  const nutritionSources = dedupeByUrl([
    ...(existingProduct.nutritionSources ?? []),
    ...(discoveredProduct.nutritionSources ?? []),
  ], "url");
  const offers = dedupeByUrl([
    ...(existingProduct.offers ?? []),
    ...(discoveredProduct.offers ?? []),
  ], "productUrl");

  return {
    ...existingProduct,
    carbsGrams:
      Number.isFinite(existingProduct.carbsGrams) && existingProduct.carbsGrams > 0
        ? existingProduct.carbsGrams
        : discoveredProduct.carbsGrams,
    sodiumMg:
      existingProduct.sodiumMg ?? discoveredProduct.sodiumMg ?? null,
    caffeineMg:
      existingProduct.caffeineMg ?? discoveredProduct.caffeineMg ?? null,
    nutritionSources,
    offers,
  };
}

function getOfficialProductUrl(product, brandConfig = null) {
  const officialSource = (product.nutritionSources ?? []).find((source) =>
    /officiel|official/i.test(source.label ?? ""),
  );
  if (officialSource?.url) {
    return officialSource.url;
  }

  if (product.nutritionSources?.[0]?.url) {
    return product.nutritionSources[0].url;
  }

  const officialOffer = (product.offers ?? []).find((offer) =>
    offer.seller === brandConfig?.seller ||
    offer.productUrl.includes(brandConfig?.seller ?? "") ||
    brandConfig?.allowedHosts?.some((host) => {
      try {
        return new URL(offer.productUrl).hostname === host;
      } catch {
        return false;
      }
    }),
  );

  return officialOffer?.productUrl ?? null;
}

function dedupeByUrl(items, key) {
  return [
    ...new Map(
      items
        .filter(Boolean)
        .map((item) => [normalizeComparableUrl(item[key]), item]),
    ).values(),
  ];
}

function chooseDiscoveredCarbValue(candidates, name, type) {
  const positive = candidates
    .map((candidate) => candidate.value)
    .filter((value) => Number.isFinite(value) && value > 0)
    .filter((value) => value <= (type === "Gel" ? 350 : 200));
  if (positive.length === 0) {
    return null;
  }

  const expected = getExpectedDiscoveredCarbs(name, type);
  return positive
    .map((value) => ({
      value,
      distance: Math.abs(value - expected),
    }))
    .sort((a, b) => a.distance - b.distance || a.value - b.value)[0].value;
}

function getExpectedDiscoveredCarbs(name, type) {
  const numbers = [...String(name).matchAll(/\b(\d{2,3})\b/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isFinite(value) && value <= 320);
  if (numbers.length > 0) {
    return numbers[0];
  }

  if (type === "Boisson") {
    return 40;
  }

  if (type === "Barre" || type === "Autre") {
    return 30;
  }

  return 30;
}

function extractCaffeineCandidates(text) {
  return extractNutrientCandidates(text, ["caffeine", "cafeine", "cafeine", "cafeine"]);
}

function extractSodiumCandidates(text) {
  return extractNutrientCandidates(text, ["sodium", "sel"]);
}

function extractNutrientCandidates(text, labels) {
  const normalizedLabels = labels.join("|");
  const candidates = [];
  const patterns = [
    new RegExp(`(?:${normalizedLabels})[^0-9]{0,30}(\\d+(?:[.,]\\d+)?)\\s*mg`, "gi"),
    new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*mg[^a-z]{0,20}(?:of\\s+)?(?:${normalizedLabels})`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = parseDecimal(match[1]);
      if (value === null || value <= 0 || value > 5000) {
        continue;
      }

      candidates.push({ value });
    }
  }

  return dedupeNumberCandidates(candidates);
}

function chooseOptionalNutrientValue(candidates) {
  const value = candidates
    .map((candidate) => candidate.value)
    .filter((entry) => Number.isFinite(entry) && entry > 0)
    .sort((a, b) => a - b)[0];
  return Number.isFinite(value) ? value : null;
}

function inferProductType(name, productUrl, text) {
  const label = normalizeSignalText(`${name} ${decodeUrlForSignals(productUrl)} ${text}`).toLowerCase();
  if (/\b(drink mix|drink|boisson|hydration)\b/.test(label)) {
    return "Boisson";
  }

  if (/\b(bar|barre|waffle|solid)\b/.test(label)) {
    return "Barre";
  }

  if (/\b(gel)\b/.test(label)) {
    return "Gel";
  }

  if (/\b(chew|chews|stroopwafel)\b/.test(label)) {
    return "Autre";
  }

  return null;
}

function cleanDiscoveredProductName(rawTitle, brand) {
  if (!rawTitle) {
    return null;
  }

  let value = rawTitle
    .replace(/\s+by\s+[^|]+$/i, "")
    .replace(/\|.*$/g, "")
    .replace(/\s+-\s+\d+\s+(?:gel|gels|bar|bars|servings?|packets?|pouches?).*$/i, "")
    .replace(/\s+\(\d+\s+servings?\).*$/i, "")
    .replace(/\s+\/\s+.+$/i, "")
    .trim();

  const brandPattern = new RegExp(`^${escapeRegExp(brand)}\\s+`, "i");
  value = value.replace(brandPattern, "").trim();

  return value || null;
}

function normalizeComparableUrl(url) {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.hash = "";
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function normalizeProductLabel(value) {
  return normalizeSignalText(value).toLowerCase();
}

function resolveUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function slugifyProductId(brand, name) {
  return `${brand}-${name}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const pageSignals = await ensurePageSignals(url, cache, stats);
    if (!pageSignals) {
      continue;
    }

    const enrichedSignals = enrichPageSignals(url, pageSignals);
    signals.push(enrichedSignals);
    byUrl.set(url, enrichedSignals);
  }

  return { signals, byUrl };
}

async function ensurePageSignals(url, cache, stats) {
  const cached = cache.pages?.[url];
  if (cached && !forceRefresh && !isCacheExpired(cached.fetchedAt)) {
    stats.pagesFromCache += 1;
    return cached;
  }

  if (!enableLiveFetch) {
    if (cached) {
      stats.pagesFromCache += 1;
      return cached;
    }

    return null;
  }

  const html = await fetchHtml(url);
  if (!html || isBlockedOrEmptyHtml(html)) {
    return cached ?? null;
  }

  const pageSignals = extractPageSignals(url, html);
  if (cached && isCacheRegression(cached, pageSignals)) {
    stats.pagesFromCache += 1;
    return cached;
  }

  const nextEntry = {
    fetchedAt: new Date().toISOString(),
    ...pageSignals,
  };

  cache.pages[url] = nextEntry;
  stats.pagesFetched += 1;
  return nextEntry;
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

  if (chosenLiveCandidate && isLiveCarbCandidateCompatible(chosenLiveCandidate, product)) {
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

function isLiveCarbCandidateCompatible(candidate, product) {
  if (!candidate || !Number.isFinite(candidate.value) || candidate.value <= 0) {
    return false;
  }

  if (!Number.isFinite(product.carbsGrams) || product.carbsGrams <= 0) {
    return true;
  }

  if (candidate.value === product.carbsGrams) {
    return true;
  }

  const absoluteDifference = Math.abs(candidate.value - product.carbsGrams);

  if (absoluteDifference <= 2) {
    return true;
  }

  return false;
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
  const packageCandidate = choosePackagePriceCandidate(candidates, {
    ...product,
    ...offer,
  });
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
  const title = extractTitle(html);
  const pageContext = extractPageContextSignals(url, normalizedHtml, text, title);

  return {
    title,
    pageContext,
    priceCandidates: extractPriceCandidates(normalizedHtml, url, pageContext).map((candidate) => ({
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
    packageCountCandidates: extractLocationPackageCountCandidates(url, title)
      .concat(extractPackageCountCandidates(text))
      .concat(
        extractSinglePackageCountCandidates(
          `${title ?? ""} ${decodeUrlForSignals(url)}`,
        ),
      )
      .concat(extractOdooSingleFormatCandidates(normalizedHtml, url))
      .map((candidate) => ({
        ...candidate,
        url,
      })),
  };
}

function isBlockedOrEmptyHtml(html) {
  const text = stripHtml(html).toLowerCase();
  if (text.length < 120) {
    return true;
  }

  return /(?:access denied|forbidden|captcha|verify you are human|checking your browser|cloudflare|security check|bot detection|temporarily blocked|enable javascript)/i.test(text);
}

function isCacheRegression(cached, nextSignals) {
  const cachedPriceCount = cached.priceCandidates?.length ?? 0;
  const nextPriceCount = nextSignals.priceCandidates?.length ?? 0;
  if (cachedPriceCount > 0 && nextPriceCount === 0) {
    return true;
  }

  const cachedPackageCount = cached.packageCountCandidates?.length ?? 0;
  const nextPackageCount = nextSignals.packageCountCandidates?.length ?? 0;
  if (cachedPriceCount > 0 && cachedPackageCount > 0 && nextPackageCount === 0) {
    return true;
  }

  const cachedCarbCount = cached.carbCandidates?.length ?? 0;
  const nextCarbCount = nextSignals.carbCandidates?.length ?? 0;
  if (cachedCarbCount > 0 && nextCarbCount === 0 && nextPriceCount === 0) {
    return true;
  }

  return false;
}

function enrichPageSignals(url, pageSignals) {
  const title = pageSignals.title ?? null;
  const locationText = `${title ?? ""} ${decodeUrlForSignals(url)}`;
  const pageContext = pageSignals.pageContext ?? createFallbackPageContext(url, pageSignals);

  return {
    ...pageSignals,
    url,
    pageContext,
    priceCandidates: (pageSignals.priceCandidates ?? []).map((candidate) => ({
      ...candidate,
      url: candidate.url ?? url,
      pageContext,
      pageType: candidate.pageType ?? pageContext.pageType,
    })),
    packageCountCandidates: dedupeNumberCandidates([
      ...extractLocationPackageCountCandidates(url, title).map((candidate) => ({
        ...candidate,
        url,
      })),
      ...(pageSignals.packageCountCandidates ?? []),
      ...extractSinglePackageCountCandidates(locationText).map((candidate) => ({
        ...candidate,
        url,
      })),
    ]),
  };
}

function extractPriceCandidates(html, url, pageContext) {
  const currencies = extractCurrencyHints(html, pageContext);
  const assumedCurrency = chooseAssumedCurrency(currencies);
  const candidates = [
    ...extractOdooSelectedVariantPriceCandidates(html, url).map((candidate) =>
      enrichPriceCandidate(candidate, pageContext, {
        sourceType: candidate.sourceType ?? "structured",
        currency: candidate.currency ?? assumedCurrency,
        evidenceText: candidate.evidenceText ?? "",
      }),
    ),
    ...extractJsonLdPriceCandidates(html, url, pageContext, assumedCurrency),
    ...extractMetaPriceCandidates(html, url, pageContext, assumedCurrency),
    ...extractScriptPriceCandidates(html, url, pageContext, assumedCurrency),
    ...extractShopifyProductPriceCandidates(html, url, pageContext, assumedCurrency),
    ...extractVisiblePriceCandidates(html, url, pageContext, assumedCurrency),
  ];

  return sanitizePriceCandidates(candidates, pageContext);
}

function createFallbackPageContext(url, pageSignals) {
  const title = pageSignals?.title ?? null;
  const normalizedTitle = normalizeSignalText(title ?? "").toLowerCase();
  const decodedPath = decodeUrlForSignals(url).toLowerCase();
  const genericTitle = isGenericStoreTitle(normalizedTitle);
  const homepageLike = genericTitle || /^\/?$/.test(safePathname(url));

  return {
    title,
    canonicalUrl: null,
    canonicalPath: null,
    ogType: null,
    pageType: homepageLike ? "homepage" : "unknown",
    genericTitle,
    homepageLike,
    productLike:
      !homepageLike &&
      (decodedPath.includes("product") || decodedPath.includes("products")),
    decodedPath,
    normalizedTitle,
    productTexts: [normalizedTitle, decodedPath].filter(Boolean),
    brandHints: inferBrandHintsFromTexts([normalizedTitle, decodedPath]),
    productHints: inferProductHintsFromTexts([normalizedTitle, decodedPath]),
  };
}

function extractPageContextSignals(url, html, text, title) {
  const canonicalUrl = extractCanonicalUrl(html, url);
  const canonicalPath = canonicalUrl ? safePathname(canonicalUrl) : null;
  const ogType = extractMetaContent(html, "property", "og:type");
  const ogTitle = extractMetaContent(html, "property", "og:title");
  const ogDescription = extractMetaContent(html, "property", "og:description");
  const shopifyPageType = extractEmbeddedPageType(html);
  const jsonLdObjects = extractJsonLdObjects(html);
  const productSchemas = extractProductSchemas(jsonLdObjects);
  const structuredTitles = productSchemas
    .flatMap((schema) => [schema.name, schema.title, schema.brand?.name, schema.brand])
    .filter((value) => typeof value === "string");
  const normalizedTitle = normalizeSignalText(title ?? "").toLowerCase();
  const decodedPath = decodeUrlForSignals(url).toLowerCase();
  const canonicalDecodedPath = canonicalUrl ? decodeUrlForSignals(canonicalUrl).toLowerCase() : "";
  const genericTitle = isGenericStoreTitle(normalizedTitle);
  const homepageLike = isHomepageLikeContext({
    url,
    canonicalPath,
    ogType,
    title: normalizedTitle,
    shopifyPageType,
  });
  const productLike = isProductLikeContext({
    url,
    canonicalPath,
    ogType,
    shopifyPageType,
    structuredTitles,
    ogTitle,
    genericTitle,
  });
  const productTexts = [
    normalizedTitle,
    normalizeSignalText(ogTitle ?? "").toLowerCase(),
    normalizeSignalText(ogDescription ?? "").toLowerCase(),
    decodedPath,
    canonicalDecodedPath,
    ...structuredTitles.map((value) => normalizeSignalText(value).toLowerCase()),
  ].filter(Boolean);

  return {
    title,
    canonicalUrl,
    canonicalPath,
    ogType,
    ogTitle,
    ogDescription,
    pageType: shopifyPageType ?? inferPageTypeFromContext(homepageLike, productLike, ogType),
    genericTitle,
    homepageLike,
    productLike,
    decodedPath,
    canonicalDecodedPath,
    productTexts,
    brandHints: inferBrandHintsFromTexts(productTexts),
    productHints: inferProductHintsFromTexts(productTexts),
    productSchemas,
    textPreview: normalizeSignalText(text.slice(0, 1200)).toLowerCase(),
  };
}

function extractCurrencyHints(html, pageContext) {
  const currencies = new Set();
  for (const match of html.matchAll(/"priceCurrency"\s*:\s*"([A-Z]{3})"/gi)) {
    currencies.add(match[1].toUpperCase());
  }

  for (const match of html.matchAll(/(?:currency|Currency)\s*[:=]\s*"([A-Z]{3})"/g)) {
    currencies.add(match[1].toUpperCase());
  }

  for (const match of html.matchAll(/content=["']([A-Z]{3})["'][^>]*(?:price:currency|currency)/gi)) {
    currencies.add(match[1].toUpperCase());
  }

  if (pageContext?.canonicalUrl?.includes("/en-ca/") || pageContext?.canonicalUrl?.includes("/ca/")) {
    currencies.add("CAD");
  }

  return [...currencies];
}

function chooseAssumedCurrency(currencies) {
  if (currencies.includes("CAD")) {
    return "CAD";
  }

  return currencies[0] ?? null;
}

function extractJsonLdPriceCandidates(html, url, pageContext, assumedCurrency) {
  const jsonLdObjects = pageContext?.productSchemas?.length
    ? pageContext.productSchemas
    : extractProductSchemas(extractJsonLdObjects(html));
  const candidates = [];

  for (const schema of jsonLdObjects) {
    candidates.push(
      ...extractPricesFromJsonLdNode(schema, {
        url,
        pageContext,
        assumedCurrency,
        sourceType: "structured",
      }),
    );
  }

  for (const match of html.matchAll(/itemprop=["']price["'][^>]*>\s*(\d+(?:[.,]\d+)?)/gi)) {
    candidates.push(
      ...createPriceCandidatesFromRawValue(match[1], {
        url,
        pageContext,
        sourceType: "structured",
        assumedCurrency,
        evidenceText: getHtmlWindow(html, match.index, 220),
        semanticType: "current",
        contextLabel: "itemprop-price",
      }),
    );
  }

  return candidates;
}

function extractMetaPriceCandidates(html, url, pageContext, assumedCurrency) {
  const candidates = [];
  const metaRules = [
    {
      regex: /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      semanticType: "current",
      contextLabel: "og-product-price",
    },
    {
      regex: /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      semanticType: "current",
      contextLabel: "og-price",
    },
    {
      regex: /<meta[^>]+(?:name|property)=["'](?:sale_price|sale:price|product:sale_price)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      semanticType: "sale",
      contextLabel: "meta-sale-price",
    },
    {
      regex: /<meta[^>]+(?:name|property)=["'](?:compare_at_price|product:compare_at_price|regular_price)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
      semanticType: "compare",
      contextLabel: "meta-compare-price",
    },
  ];

  for (const rule of metaRules) {
    for (const match of html.matchAll(rule.regex)) {
      candidates.push(
        ...createPriceCandidatesFromRawValue(match[1], {
          url,
          pageContext,
          sourceType: "meta",
          assumedCurrency,
          evidenceText: match[0],
          semanticType: rule.semanticType,
          contextLabel: rule.contextLabel,
        }),
      );
    }
  }

  return candidates;
}

function extractScriptPriceCandidates(html, url, pageContext, assumedCurrency) {
  const candidates = [];
  const scriptRules = [
    {
      regex: /"price"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi,
      semanticType: "current",
      contextLabel: "json-price",
    },
    {
      regex: /"salePrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi,
      semanticType: "sale",
      contextLabel: "json-sale-price",
    },
    {
      regex: /"compareAtPrice"\s*:\s*"(\d+(?:[.,]\d+)?)"/gi,
      semanticType: "compare",
      contextLabel: "json-compare-price",
    },
    {
      regex: /(?:price_amount|priceAmount|amount)\s*[:=]\s*["']?(\d+(?:[.,]\d+)?)/gi,
      semanticType: "current",
      contextLabel: "script-amount",
    },
    {
      regex: /(?:compare_at_price|compareAtPrice)\s*[:=]\s*["']?(\d+(?:[.,]\d+)?)/gi,
      semanticType: "compare",
      contextLabel: "script-compare",
    },
    {
      regex: /(?:unit_price|unitPrice)\s*[:=]\s*["']?(\d+(?:[.,]\d+)?)/gi,
      semanticType: "unit-reference",
      contextLabel: "script-unit-price",
    },
  ];

  for (const rule of scriptRules) {
    for (const match of html.matchAll(rule.regex)) {
      candidates.push(
        ...createPriceCandidatesFromRawValue(match[1], {
          url,
          pageContext,
          sourceType: "structured",
          assumedCurrency,
          evidenceText: getHtmlWindow(html, match.index, 240),
          semanticType: rule.semanticType,
          contextLabel: rule.contextLabel,
        }),
      );
    }
  }

  return candidates;
}

function extractShopifyProductPriceCandidates(html, url, pageContext, assumedCurrency) {
  const candidates = [];
  const productJsonBlocks = [
    ...extractJsonBlocksByKey(html, "variants"),
    ...extractJsonBlocksByAssignment(html, "__st"),
    ...extractJsonBlocksByAssignment(html, "meta"),
  ];

  for (const block of productJsonBlocks) {
    const parsed = tryParseJson(block);
    if (!parsed) {
      continue;
    }

    candidates.push(
      ...extractPricesFromShopifyNode(parsed, {
        url,
        pageContext,
        assumedCurrency,
        sourceType: "structured",
      }),
    );
  }

  return candidates;
}

function extractVisiblePriceCandidates(html, url, pageContext, assumedCurrency) {
  const candidates = [];
  const textRules = [
    {
      regex: /\$\s*(\d{1,4}(?:[.,]\d{2})?)/g,
      contextLabel: "money-symbol-leading",
    },
    {
      regex: /(\d{1,4}(?:[.,]\d{2})?)\s*\$/g,
      contextLabel: "money-symbol-trailing",
    },
    {
      regex: /(?:sale price|prix de vente|now|maintenant|our price|prix)\D{0,24}\$?\s*(\d{1,4}(?:[.,]\d{2})?)/gi,
      contextLabel: "labelled-price",
    },
  ];

  for (const rule of textRules) {
    for (const match of html.matchAll(rule.regex)) {
      const evidenceText = getHtmlWindow(html, match.index, 260);
      const context = classifyPriceContextWindow(evidenceText, pageContext);
      candidates.push(
        ...createPriceCandidatesFromRawValue(match[1], {
          url,
          pageContext,
          sourceType: "text",
          assumedCurrency,
          evidenceText,
          semanticType: context.semanticType,
          contextLabel: rule.contextLabel,
          contextConfidence: context.contextConfidence,
          contextTags: context.tags,
        }),
      );
    }
  }

  return candidates;
}

function extractPricesFromJsonLdNode(node, options) {
  const candidates = [];
  const visited = new Set();

  walkObject(node, (value, key, parent) => {
    if (!isPlainObject(parent)) {
      return;
    }

    const semanticType = classifyJsonLdPriceKey(key, parent);
    if (!semanticType) {
      return;
    }

    const candidateKey = `${key}:${JSON.stringify(value)}`;
    if (visited.has(candidateKey)) {
      return;
    }
    visited.add(candidateKey);

    const currency = getFirstString(
      parent.priceCurrency,
      parent.currency,
      parent.price_currency,
      options.assumedCurrency,
    );

    candidates.push(
      ...createPriceCandidatesFromRawValue(value, {
        ...options,
        currency,
        assumedCurrency: currency ?? options.assumedCurrency,
        evidenceText: JSON.stringify(parent).slice(0, 600),
        semanticType,
        contextLabel: "jsonld",
      }),
    );
  });

  return candidates;
}

function extractPricesFromShopifyNode(node, options) {
  const candidates = [];

  walkObject(node, (value, key, parent) => {
    if (!isPlainObject(parent)) {
      return;
    }

    const semanticType = classifyShopifyPriceKey(key, parent);
    if (!semanticType) {
      return;
    }

    const currency = getFirstString(
      parent.currency,
      parent.currencyCode,
      options.assumedCurrency,
    );
    candidates.push(
      ...createPriceCandidatesFromRawValue(value, {
        ...options,
        currency,
        assumedCurrency: currency ?? options.assumedCurrency,
        evidenceText: JSON.stringify(parent).slice(0, 500),
        semanticType,
        contextLabel: "shopify-json",
      }),
    );
  });

  return candidates;
}

function sanitizePriceCandidates(candidates, pageContext) {
  const normalized = [];

  for (const candidate of candidates) {
    if (!candidate || !Number.isFinite(candidate.value)) {
      continue;
    }

    const cleaned = finalizePriceCandidate(candidate, pageContext);
    if (!cleaned) {
      continue;
    }

    normalized.push(cleaned);
  }

  return dedupeSemanticPriceCandidates(normalized);
}

function finalizePriceCandidate(candidate, pageContext) {
  const normalizedCurrency = normalizeCurrencyCode(
    candidate.currency ?? candidate.assumedCurrency ?? null,
  );
  const cleaned = {
    ...candidate,
    pageContext: candidate.pageContext ?? pageContext ?? null,
    currency: normalizedCurrency,
    evidenceText: normalizeSignalText(candidate.evidenceText ?? ""),
    contextLabel: candidate.contextLabel ?? "unknown",
    semanticType: candidate.semanticType ?? "current",
    contextConfidence: candidate.contextConfidence ?? "medium",
    contextTags: [...new Set(candidate.contextTags ?? [])],
    pageType: candidate.pageType ?? pageContext?.pageType ?? "unknown",
  };

  if (cleaned.value <= 0) {
    return null;
  }

  if (cleaned.semanticType === "shipping" || cleaned.semanticType === "savings") {
    cleaned.confidence = "live-text";
  }

  return cleaned;
}

function enrichPriceCandidate(candidate, pageContext, overrides = {}) {
  return {
    ...candidate,
    ...overrides,
    pageContext,
    pageType: pageContext?.pageType ?? "unknown",
    contextTags: [...new Set([...(candidate.contextTags ?? []), ...(overrides.contextTags ?? [])])],
    contextConfidence:
      overrides.contextConfidence ?? candidate.contextConfidence ?? "medium",
    semanticType: overrides.semanticType ?? candidate.semanticType ?? "current",
    evidenceText: overrides.evidenceText ?? candidate.evidenceText ?? "",
  };
}

function createPriceCandidatesFromRawValue(rawValue, options) {
  const parsedValues = parseMoneyValueCandidates(rawValue);
  const candidates = [];

  for (const parsed of parsedValues) {
    for (const normalizedValue of normalizeMoneyValues(parsed.value)) {
      candidates.push({
        value: normalizedValue,
        rawValue: parsed.rawValue,
        currency: normalizeCurrencyCode(parsed.currency ?? options.currency ?? options.assumedCurrency),
        confidence: options.sourceType === "text" ? "live-text" : "live",
        sourceType: options.sourceType,
        pageContext: options.pageContext ?? null,
        semanticType: options.semanticType ?? "current",
        contextLabel: options.contextLabel ?? "raw",
        contextConfidence: options.contextConfidence ?? "medium",
        contextTags: [...new Set(options.contextTags ?? [])],
        evidenceText: options.evidenceText ?? "",
        pageType: options.pageContext?.pageType ?? "unknown",
      });
    }
  }

  return candidates;
}

function parseMoneyValueCandidates(rawValue) {
  const values = [];

  if (typeof rawValue === "number") {
    values.push({
      value: rawValue,
      rawValue: String(rawValue),
      currency: null,
    });
    return values;
  }

  if (typeof rawValue !== "string") {
    return values;
  }

  const currency = detectCurrencyCode(rawValue);
  const cleaned = rawValue
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const decimalLike = parseDecimal(cleaned);
  if (decimalLike !== null) {
    values.push({ value: decimalLike, rawValue: cleaned, currency });
  }

  const moneyLike = parseLocalizedMoney(cleaned);
  if (moneyLike !== null && !values.some((entry) => nearlyEqual(entry.value, moneyLike))) {
    values.push({ value: moneyLike, rawValue: cleaned, currency });
  }

  return values;
}

function parseLocalizedMoney(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[^\d,.-]/g, "");
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return Number.parseFloat(normalized);
  }

  const lastDot = normalized.lastIndexOf(".");
  const lastComma = normalized.lastIndexOf(",");
  const decimalSeparator =
    lastDot > lastComma ? "." : lastComma > lastDot ? "," : null;

  if (!decimalSeparator) {
    return Number.parseFloat(normalized.replace(/[^\d-]/g, ""));
  }

  const pieces = normalized.split(decimalSeparator);
  const whole = pieces.slice(0, -1).join("").replace(/[^\d-]/g, "");
  const fraction = pieces.at(-1)?.replace(/[^\d]/g, "") ?? "";
  if (!whole && !fraction) {
    return null;
  }

  const parsed = Number.parseFloat(`${whole || "0"}.${fraction || "0"}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCanonicalUrl(html, requestUrl) {
  const href = extractTagAttribute(html, "link", "rel", "canonical", "href");
  if (!href) {
    return null;
  }

  return resolveUrl(requestUrl, href);
}

function extractMetaContent(html, attrName, attrValue) {
  const escaped = escapeRegExp(attrValue);
  const match = html.match(
    new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
  );
  return match?.[1] ?? null;
}

function extractEmbeddedPageType(html) {
  const matches = [
    html.match(/"pageType"\s*:\s*"([^"]+)"/i),
    html.match(/page_type["']?\s*[:=]\s*["']([^"']+)["']/i),
    html.match(/ShopifyAnalytics\.meta\s*=\s*(\{[\s\S]*?\});/i),
  ];

  for (const match of matches) {
    if (!match) {
      continue;
    }

    if (match[1]?.startsWith("{")) {
      const parsed = tryParseJson(match[1]);
      if (parsed?.page?.pageType) {
        return String(parsed.page.pageType).toLowerCase();
      }
      if (parsed?.pageType) {
        return String(parsed.pageType).toLowerCase();
      }
      continue;
    }

    return String(match[1]).toLowerCase();
  }

  return null;
}

function extractJsonLdObjects(html) {
  const objects = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = tryParseJson(match[1]);
    if (!parsed) {
      continue;
    }

    if (Array.isArray(parsed)) {
      objects.push(...parsed);
    } else {
      objects.push(parsed);
    }
  }

  return objects;
}

function extractProductSchemas(objects) {
  const results = [];
  for (const object of objects) {
    walkObject(object, (value) => {
      if (isPlainObject(value) && isProductSchemaNode(value)) {
        results.push(value);
      }
    });

    if (isPlainObject(object) && isProductSchemaNode(object)) {
      results.push(object);
    }
  }

  return dedupeObjects(results);
}

function isProductSchemaNode(node) {
  const type = getSchemaType(node);
  return type.includes("product") || type.includes("offer");
}

function getSchemaType(node) {
  const rawType = node?.["@type"];
  if (Array.isArray(rawType)) {
    return rawType.join(" ").toLowerCase();
  }

  return String(rawType ?? "").toLowerCase();
}

function isHomepageLikeContext({ url, canonicalPath, ogType, title, shopifyPageType }) {
  if (shopifyPageType === "index" || shopifyPageType === "homepage") {
    return true;
  }

  if (canonicalPath === "/" || canonicalPath === "") {
    return true;
  }

  if (safePathname(url) === "/" && !ogType) {
    return true;
  }

  return isGenericStoreTitle(title);
}

function isProductLikeContext({
  url,
  canonicalPath,
  ogType,
  shopifyPageType,
  structuredTitles,
  ogTitle,
  genericTitle,
}) {
  if (shopifyPageType === "product") {
    return true;
  }

  if (String(ogType ?? "").toLowerCase() === "product") {
    return true;
  }

  if ((canonicalPath ?? "").includes("/products/") || safePathname(url).includes("/products/")) {
    return true;
  }

  if (structuredTitles.length > 0) {
    return true;
  }

  return Boolean(ogTitle) && !genericTitle;
}

function inferPageTypeFromContext(homepageLike, productLike, ogType) {
  if (homepageLike) {
    return "homepage";
  }

  if (productLike) {
    return "product";
  }

  if (String(ogType ?? "").toLowerCase() === "website") {
    return "website";
  }

  return "unknown";
}

function isGenericStoreTitle(title) {
  if (!title) {
    return false;
  }

  return /(?:your source for|home|footwear|running|walking|training shoes|welcome|official store|shop online)/i.test(title);
}

function inferBrandHintsFromTexts(texts) {
  const brands = [
    "maurten",
    "precision",
    "hydration",
    "krono",
    "upika",
    "naak",
    "hornet",
    "watt",
  ];

  return brands.filter((brand) =>
    texts.some((text) => text.includes(brand)),
  );
}

function inferProductHintsFromTexts(texts) {
  const hints = [
    "gel",
    "drink mix",
    "drink",
    "bar",
    "chew",
    "solid",
    "caf",
    "caffeine",
    "flow",
    "electrolyte",
  ];

  return hints.filter((hint) =>
    texts.some((text) => text.includes(hint)),
  );
}

function classifyJsonLdPriceKey(key, parent) {
  const normalizedKey = String(key ?? "").toLowerCase();
  if (normalizedKey === "price" || normalizedKey === "lowprice") {
    return "current";
  }

  if (normalizedKey === "saleprice" || normalizedKey === "offerprice") {
    return "sale";
  }

  if (normalizedKey === "highprice" || normalizedKey.includes("compare")) {
    return "compare";
  }

  if (normalizedKey.includes("shipping")) {
    return "shipping";
  }

  if (normalizedKey.includes("unit")) {
    return "unit-reference";
  }

  if (
    normalizedKey.includes("price") &&
    typeof parent?.availability === "string"
  ) {
    return "current";
  }

  return normalizedKey.includes("price") ? "current" : null;
}

function classifyShopifyPriceKey(key, parent) {
  const normalizedKey = String(key ?? "").toLowerCase();
  if (normalizedKey === "price" || normalizedKey === "final_price") {
    return "current";
  }

  if (normalizedKey === "compare_at_price") {
    return "compare";
  }

  if (normalizedKey === "unit_price") {
    return "unit-reference";
  }

  if (normalizedKey === "price_min") {
    return "current";
  }

  if (normalizedKey === "price_max") {
    return "range-high";
  }

  if (normalizedKey.includes("shipping")) {
    return "shipping";
  }

  if (normalizedKey.includes("discount")) {
    return "savings";
  }

  if (normalizedKey.includes("price")) {
    return parent?.available === false ? "compare" : "current";
  }

  return null;
}

function classifyPriceContextWindow(windowText, pageContext) {
  const normalized = normalizeSignalText(windowText).toLowerCase();
  const tags = [];
  let semanticType = "current";
  let contextConfidence = "medium";

  if (/(compare at|regular price|prix regulier|regular|msrp|was |ancien prix)/i.test(normalized)) {
    semanticType = "compare";
    tags.push("compare");
  }

  if (/(save|economisez|rabais|off|discount|reduction)/i.test(normalized)) {
    semanticType = semanticType === "compare" ? semanticType : "savings";
    tags.push("savings");
  }

  if (/(shipping|livraison|free ship|expedition)/i.test(normalized)) {
    semanticType = "shipping";
    tags.push("shipping");
  }

  if (/(from |starting at|a partir de|dès)/i.test(normalized)) {
    tags.push("starting-at");
    contextConfidence = "low";
  }

  if (/(sale price|prix de vente|our price|now|maintenant|price)/i.test(normalized)) {
    semanticType = semanticType === "current" ? "current" : semanticType;
    tags.push("current-label");
    contextConfidence = "high";
  }

  if (/(sold out|rupture|out of stock)/i.test(normalized)) {
    tags.push("sold-out");
    contextConfidence = "low";
  }

  if (pageContext?.homepageLike) {
    tags.push("homepage-like");
    contextConfidence = "low";
  }

  return { semanticType, contextConfidence, tags };
}

function extractJsonBlocksByKey(html, key) {
  const blocks = [];
  const escaped = escapeRegExp(key);
  for (const match of html.matchAll(new RegExp(`"${escaped}"\\s*:\\s*(\\[[\\s\\S]*?\\]|\\{[\\s\\S]*?\\})`, "gi"))) {
    blocks.push(match[1]);
  }
  return blocks;
}

function extractJsonBlocksByAssignment(html, variableName) {
  const blocks = [];
  const escaped = escapeRegExp(variableName);
  for (const match of html.matchAll(new RegExp(`${escaped}\\s*=\\s*(\\{[\\s\\S]*?\\});`, "gi"))) {
    blocks.push(match[1]);
  }
  return blocks;
}

function tryParseJson(value) {
  if (typeof value !== "string") {
    return null;
  }

  const candidates = [value.trim(), value.trim().replace(/;$/, "")];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue.
    }
  }

  return null;
}

function walkObject(value, visitor, parent = null, key = null, seen = new Set()) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  visitor(value, key, parent);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkObject(entry, visitor, value, index, seen));
    return;
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryValue && typeof entryValue === "object") {
      walkObject(entryValue, visitor, value, entryKey, seen);
    } else {
      visitor(entryValue, entryKey, value);
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dedupeObjects(objects) {
  return [
    ...new Map(
      objects.map((object) => [JSON.stringify(object), object]),
    ).values(),
  ];
}

function getFirstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function getHtmlWindow(html, index, radius = 180) {
  if (!Number.isFinite(index)) {
    return "";
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(html.length, index + radius);
  return html.slice(start, end);
}

function extractTagAttribute(html, tagName, keyName, keyValue, attributeName) {
  const escapedTag = escapeRegExp(tagName);
  const escapedKey = escapeRegExp(keyName);
  const escapedValue = escapeRegExp(keyValue);
  const escapedAttr = escapeRegExp(attributeName);
  const regex = new RegExp(
    `<${escapedTag}[^>]+${escapedKey}=["']${escapedValue}["'][^>]+${escapedAttr}=["']([^"']+)["'][^>]*>`,
    "i",
  );
  return html.match(regex)?.[1] ?? null;
}

function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

function normalizeCurrencyCode(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === "CA$" || normalized === "$CAD") {
    return "CAD";
  }

  if (/^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }

  return normalized.includes("CAD") ? "CAD" : null;
}

function detectCurrencyCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  if (/CAD|CA\$|\$ CAD/i.test(value)) {
    return "CAD";
  }

  if (/USD|US\$|\$ US/i.test(value)) {
    return "USD";
  }

  return null;
}

function dedupeSemanticPriceCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((candidate) => [
        [
          round(candidate.value),
          candidate.currency ?? "na",
          candidate.sourceType ?? "na",
          candidate.semanticType ?? "na",
          candidate.contextLabel ?? "na",
          normalizeSignalText(candidate.evidenceText ?? "").slice(0, 120),
        ].join(":"),
        candidate,
      ]),
    ).values(),
  ];
}

function nearlyEqual(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }

  return Math.abs(a - b) <= 0.01;
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
      sourceType: "odoo-format",
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

function extractLocationPackageCountCandidates(url, title) {
  const decodedUrl = decodeUrlForSignals(url);

  return dedupeNumberCandidates([
    ...extractPackageCountCandidates(decodedUrl, "url"),
    ...extractPackageCountCandidates(title ?? "", "title"),
  ]);
}

function extractPackageCountCandidates(text, origin = "body") {
  const normalizedText = normalizeSignalText(text);
  const candidates = [];
  const patterns = [
    {
      pattern: /(?:box|case|pack|paquet|boite|boîte|bundle|caisse|format)\s*(?:of|de|d'|x)?\s*(\d{1,3})\b/gi,
      sourceType: "package-label",
    },
    {
      pattern: /\b(\d{1,3})\s*(?:x|ct|count|pack|paquet|boite|boîte|gels|bars|barres|sachets|chews|stroopwafels)\b/gi,
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
        sourceType: origin === "body" ? sourceType : `${origin}-${sourceType}`,
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
        sourceScore: getPriceSourceScore(candidate, index, offer),
        packageScore: getPackagePriceScore(packagePrice),
        semanticScore: getPriceSemanticScore(candidate, offer),
        pageScore: getPageContextScore(candidate, offer),
        evidenceScore: getEvidenceQualityScore(candidate, offer),
        noisePenalty: getPriceNoisePenalty(candidate, offer),
        matchScore: getOfferProductMatchScore(candidate, offer),
      }));
    })
    .filter((candidate) => candidate.value > 0 && candidate.packagePrice <= MAX_PACKAGE_PRICE)
    .filter((candidate) => !candidate.currency || candidate.currency === "CAD")
    .filter((candidate) => !shouldRejectPriceCandidate(candidate, offer));

  if (normalized.length === 0) {
    return null;
  }

  const ranked = normalized
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.sourceScore +
        candidate.packageScore +
        candidate.semanticScore +
        candidate.pageScore +
        candidate.evidenceScore +
        candidate.matchScore +
        candidate.noisePenalty +
        getUnitPriceScore(candidate.value, offer),
    }))
    .filter((candidate) => isReliableUnitPrice(candidate.value))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.matchScore - a.matchScore ||
        b.pageScore - a.pageScore ||
        b.sourceScore - a.sourceScore ||
        a.packagePrice - b.packagePrice,
    );

  return ranked[0] ?? null;
}

function choosePackagePriceCandidate(candidates, offer = null) {
  const normalized = candidates
    .flatMap((candidate, index) =>
      normalizeMoneyValues(candidate.value).map((value) => ({
        ...candidate,
        value,
        sourceScore: getPriceSourceScore(candidate, index, offer),
        packageScore: getPackagePriceScore(value),
        semanticScore: getPriceSemanticScore(candidate, offer),
        pageScore: getPageContextScore(candidate, offer),
        evidenceScore: getEvidenceQualityScore(candidate, offer),
        noisePenalty: getPriceNoisePenalty(candidate, offer),
        matchScore: getOfferProductMatchScore(candidate, offer),
      })),
    )
    .filter((candidate) => candidate.value > 0 && candidate.value <= MAX_PACKAGE_PRICE)
    .filter((candidate) => !candidate.currency || candidate.currency === "CAD")
    .filter((candidate) => !shouldRejectPriceCandidate(candidate, offer))
    .map((candidate) => ({
      ...candidate,
      score:
        candidate.sourceScore +
        candidate.packageScore +
        candidate.semanticScore +
        candidate.pageScore +
        candidate.evidenceScore +
        candidate.matchScore +
        candidate.noisePenalty,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.matchScore - a.matchScore ||
        b.pageScore - a.pageScore ||
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
      sourceRank: getUnitCountSourceRank(candidate),
      priceCoherence: getUnitCountPriceCoherence(
        candidate,
        product,
        packagePrices,
        singleUnitPrice,
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.sourceRank - a.sourceRank ||
        b.priceCoherence - a.priceCoherence ||
        Number(COMMON_UNIT_COUNTS.includes(b.value)) -
          Number(COMMON_UNIT_COUNTS.includes(a.value)) ||
        b.value - a.value,
    );

  return ranked[0] ?? null;
}

function getUnitCountScore(candidate, product, packagePrices, singleUnitPrice) {
  const value = candidate.value;
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AUTO_UNIT_COUNT) {
    return -Infinity;
  }

  const isServingSignal = SERVING_SOURCE_TYPES.has(candidate.sourceType);
  const isPackageSignal = PACKAGE_SOURCE_TYPES.has(candidate.sourceType);

  if (isServingSignal && product.type !== "Boisson") {
    return -Infinity;
  }

  let score = 0;
  if (candidate.sourceType === "single" || candidate.sourceType === "odoo-format") {
    score += value === 1 ? 12 : -8;
  } else if (candidate.sourceType === "url-package-label") {
    score += 22;
  } else if (candidate.sourceType === "title-package-label") {
    score += 20;
  } else if (candidate.sourceType === "url-package-count") {
    score += 18;
  } else if (candidate.sourceType === "title-package-count") {
    score += 16;
  } else if (candidate.sourceType === "package-label") {
    score += 9;
  } else if (candidate.sourceType === "package-count") {
    score += 6;
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

  if (STRONG_PACKAGE_SOURCE_TYPES.has(candidate.sourceType)) {
    score += 6;
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

  if (
    packagePrices.length > 0 &&
    isPackageSignal &&
    !STRONG_PACKAGE_SOURCE_TYPES.has(candidate.sourceType)
  ) {
    const hasStrongerContradiction = candidatesHaveStrongerPackageProof(
      candidate,
      packagePrices,
      product,
    );
    if (hasStrongerContradiction) {
      score -= 8;
    }
  }

  if (
    value === 1 &&
    candidate.sourceType !== "single" &&
    candidate.sourceType !== "odoo-format"
  ) {
    score -= 3;
  }

  return score;
}

function candidatesHaveStrongerPackageProof(candidate, packagePrices, product) {
  if (!Number.isFinite(candidate.value) || candidate.value <= 1) {
    return false;
  }

  for (const packagePrice of packagePrices) {
    if (!Number.isFinite(packagePrice)) {
      continue;
    }

    const unitPrice = packagePrice / candidate.value;
    if (unitPrice <= getExpectedUnitPrice(product) * 0.55) {
      return true;
    }
  }

  return false;
}

function getUnitCountSourceRank(candidate) {
  if (candidate.sourceType === "url-package-label") {
    return 8;
  }

  if (candidate.sourceType === "title-package-label") {
    return 7;
  }

  if (candidate.sourceType === "url-package-count") {
    return 6;
  }

  if (candidate.sourceType === "title-package-count") {
    return 5;
  }

  if (candidate.sourceType === "odoo-format" || candidate.sourceType === "single") {
    return 4;
  }

  if (candidate.sourceType === "package-label") {
    return 3;
  }

  if (candidate.sourceType === "package-count") {
    return 2;
  }

  return 1;
}

function getUnitCountPriceCoherence(candidate, product, packagePrices, singleUnitPrice) {
  if (!Number.isFinite(candidate.value) || candidate.value <= 0) {
    return -Infinity;
  }

  if (packagePrices.length === 0) {
    return 0;
  }

  let score = 0;
  const expectedUnitPrice = getExpectedUnitPrice(product);

  for (const packagePrice of packagePrices) {
    if (!Number.isFinite(packagePrice) || packagePrice <= 0) {
      continue;
    }

    const unitPrice = packagePrice / candidate.value;
    if (!isReliableUnitPrice(unitPrice)) {
      score -= 8;
      continue;
    }

    const expectedDistance = Math.abs(unitPrice - expectedUnitPrice) / expectedUnitPrice;
    score += Math.max(0, 6 - expectedDistance * 8);

    if (Number.isFinite(singleUnitPrice) && singleUnitPrice > 0) {
      const peerDistance = Math.abs(unitPrice - singleUnitPrice) / singleUnitPrice;
      score += Math.max(0, 7 - peerDistance * 10);
    }

    if (unitPrice >= getMinimumPlausibleUnitPrice(product) && unitPrice <= 8) {
      score += 2;
    }
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

function getPriceSourceScore(candidate, index, offer = null) {
  const sourceType = candidate.sourceType;
  let score = 0;

  if (sourceType === "structured") {
    score += 20;
  } else if (sourceType === "meta") {
    score += 17;
  } else if (sourceType === "text") {
    score += 8;
  } else {
    score += 12;
  }

  if (candidate.contextLabel === "jsonld") {
    score += 5;
  }

  if (candidate.contextLabel === "og-product-price" || candidate.contextLabel === "og-price") {
    score += 4;
  }

  if (candidate.contextLabel === "shopify-json") {
    score += 4;
  }

  if (candidate.contextConfidence === "high") {
    score += 2;
  } else if (candidate.contextConfidence === "low") {
    score -= 3;
  }

  if (offer?.productUrl && normalizeComparableUrl(candidate.url ?? offer.productUrl) === normalizeComparableUrl(offer.productUrl)) {
    score += 1;
  }

  return score - index * 0.05;
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

function getPriceSemanticScore(candidate, offer = null) {
  const semanticType = candidate.semanticType ?? "current";
  if (semanticType === "current" || semanticType === "sale") {
    return semanticType === "sale" ? 7 : 9;
  }

  if (semanticType === "range-low") {
    return 3;
  }

  if (semanticType === "unit-reference") {
    return -4;
  }

  if (semanticType === "compare" || semanticType === "range-high") {
    return -12;
  }

  if (semanticType === "shipping" || semanticType === "savings") {
    return -20;
  }

  if (semanticType === "unknown" && offer?.type === "Boisson") {
    return -2;
  }

  return -6;
}

function getPageContextScore(candidate, offer = null) {
  let score = 0;
  const pageType = candidate.pageType ?? "unknown";

  if (pageType === "product") {
    score += 8;
  } else if (pageType === "homepage") {
    score -= 24;
  } else if (pageType === "website") {
    score -= 10;
  }

  if (candidate.contextTags?.includes("homepage-like")) {
    score -= 18;
  }

  if (candidate.pageContext?.genericTitle) {
    score -= 8;
  }

  if (candidate.pageContext?.productLike) {
    score += 4;
  }

  if (offer) {
    score += getPageTitleOfferMatchScore(candidate.pageContext, offer);
  }

  return score;
}

function getEvidenceQualityScore(candidate, offer = null) {
  const evidence = normalizeSignalText(candidate.evidenceText ?? "").toLowerCase();
  if (!evidence) {
    return 0;
  }

  let score = 0;
  if (/(add to cart|buy now|in stock|variant|quantity selector)/i.test(evidence)) {
    score += 2;
  }

  if (/(sale price|prix de vente|our price|og:price:amount|pricecurrency|itemprop price|product price)/i.test(evidence)) {
    score += 4;
  }

  if (/(compare at|regular price|retail|msrp|you save|save \$|shipping|livraison)/i.test(evidence)) {
    score -= 6;
  }

  if (/(review|rating|stars|points|reward|gift card)/i.test(evidence)) {
    score -= 5;
  }

  if (offer) {
    score += scoreEvidenceAgainstOfferIdentity(evidence, offer);
  }

  return score;
}

function getPriceNoisePenalty(candidate, offer = null) {
  let penalty = 0;
  const evidence = normalizeSignalText(candidate.evidenceText ?? "").toLowerCase();
  const value = candidate.value;

  if (candidate.semanticType === "shipping" || candidate.semanticType === "savings") {
    penalty -= 30;
  }

  if (candidate.pageType === "homepage") {
    penalty -= 28;
  }

  if (candidate.pageContext?.homepageLike) {
    penalty -= 20;
  }

  if (value > 150) {
    penalty -= 8;
  }

  if (Number.isInteger(value) && [30, 35, 40, 50, 60, 80, 100, 160, 200, 300].includes(value)) {
    penalty -= 4;
  }

  if (/(km|grams?|glucides|carbohydrates?|ml|servings?|portions?)/i.test(evidence) && !/\$/i.test(candidate.rawValue ?? "")) {
    penalty -= 5;
  }

  if (/(from |starting at|a partir de|dès)/i.test(evidence)) {
    penalty -= 5;
  }

  if (/(wishlist|compare|quick view|newsletter|footer|header)/i.test(evidence)) {
    penalty -= 12;
  }

  if (offer?.brand && !offerIdentityAppearsInText(evidence, offer, { strict: false })) {
    penalty -= 6;
  }

  return penalty;
}

function getOfferProductMatchScore(candidate, offer = null) {
  if (!offer) {
    return 0;
  }

  const texts = [
    candidate.pageContext?.normalizedTitle,
    candidate.pageContext?.decodedPath,
    candidate.pageContext?.canonicalDecodedPath,
    normalizeSignalText(candidate.evidenceText ?? "").toLowerCase(),
  ].filter(Boolean);

  return scoreTextsAgainstOffer(texts, offer);
}

function shouldRejectPriceCandidate(candidate, offer = null) {
  if (!candidate) {
    return true;
  }

  if (candidate.semanticType === "shipping" || candidate.semanticType === "savings") {
    return true;
  }

  if (candidate.pageType === "homepage" && candidate.sourceType !== "meta") {
    return true;
  }

  if (
    candidate.pageContext?.homepageLike &&
    candidate.pageContext?.genericTitle &&
    !offerIdentityAppearsInText(candidate.pageContext?.decodedPath ?? "", offer, { strict: true }) &&
    !offerIdentityAppearsInText(candidate.pageContext?.normalizedTitle ?? "", offer, { strict: false })
  ) {
    return true;
  }

  if (
    offer &&
    candidate.sourceType === "structured" &&
    candidate.pageContext?.genericTitle &&
    scoreTextsAgainstOffer(
      [
        candidate.pageContext?.normalizedTitle,
        candidate.pageContext?.decodedPath,
        candidate.pageContext?.canonicalDecodedPath,
      ],
      offer,
    ) <= -8
  ) {
    return true;
  }

  return false;
}

function getPageTitleOfferMatchScore(pageContext, offer) {
  if (!pageContext || !offer) {
    return 0;
  }

  return scoreTextsAgainstOffer(
    [
      pageContext.normalizedTitle,
      pageContext.decodedPath,
      pageContext.canonicalDecodedPath,
      ...(pageContext.productTexts ?? []),
    ],
    offer,
  );
}

function scoreEvidenceAgainstOfferIdentity(evidence, offer) {
  return scoreTextsAgainstOffer([evidence], offer);
}

function offerIdentityAppearsInText(text, offer, { strict = false } = {}) {
  return scoreTextsAgainstOffer([text], offer, { strict }) > 0;
}

function scoreTextsAgainstOffer(texts, offer, { strict = true } = {}) {
  if (!offer) {
    return 0;
  }

  const haystack = normalizeSignalText(texts.filter(Boolean).join(" ")).toLowerCase();
  if (!haystack) {
    return 0;
  }

  const brandTokens = tokenizeOfferIdentity(offer.brand ?? "");
  const nameTokens = tokenizeOfferIdentity(offer.name ?? "");
  let score = 0;

  const matchedBrand = brandTokens.filter((token) => haystack.includes(token));
  const matchedName = nameTokens.filter((token) => haystack.includes(token));

  if (matchedBrand.length > 0) {
    score += 6 + matchedBrand.length * 1.5;
  } else if (brandTokens.length > 0 && strict) {
    score -= 8;
  }

  if (matchedName.length > 0) {
    score += matchedName.length * 3;
  } else if (nameTokens.length > 0 && strict) {
    score -= 6;
  }

  if (/\b(official|officiel|product|products)\b/.test(haystack)) {
    score += 1;
  }

  if (/\b(home|welcome|source for|footwear|shop online)\b/.test(haystack)) {
    score -= 5;
  }

  return score;
}

function tokenizeOfferIdentity(value) {
  return normalizeSignalText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 3 || /^\d{2,3}$/.test(token))
    .filter((token) => !["mix", "fuel", "sport", "energy"].includes(token));
}

function isReliableUnitPrice(value) {
  return Number.isFinite(value) && value >= MIN_UNIT_PRICE && value <= MAX_UNIT_PRICE;
}

async function fetchHtml(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    return fetchHtmlWithCurl(url, timeoutMs);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtmlWithCurl(url, timeoutMs) {
  try {
    const seconds = String(Math.max(3, Math.ceil(timeoutMs / 1000)));
    const { stdout } = await execFileAsync("curl", [
      "-L",
      "-A",
      USER_AGENT,
      "--max-time",
      seconds,
      "--compressed",
      url,
    ], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return typeof stdout === "string" && stdout.trim() ? stdout : null;
  } catch {
    return null;
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
