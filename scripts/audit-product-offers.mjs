import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(projectRoot, "data", "generated-product-offers.json");
const auditPath = path.join(projectRoot, "data", "product-offer-audit.json");

const catalog = JSON.parse(await readFile(generatedPath, "utf8"));
const findings = [];

for (const product of catalog.products ?? []) {
  for (const offer of product.offers ?? []) {
    const status = offer.verificationStatus ?? inferStatus(offer);

    if (!offer.productUrl || !/^https?:\/\//.test(offer.productUrl)) {
      findings.push(buildFinding(product, offer, "broken-link", "Lien vendeur absent ou invalide."));
    }

    if (!Number.isFinite(offer.price) || offer.price <= 0) {
      findings.push(buildFinding(product, offer, "missing-price", "Prix par portion absent ou invalide."));
    }

    if (Number.isFinite(offer.price) && (offer.price < 0.5 || offer.price > 20)) {
      findings.push(
        buildFinding(
          product,
          offer,
          "suspicious-unit-price",
          "Prix par portion hors de la plage attendue.",
        ),
      );
    }

    if (
      Number.isFinite(offer.packagePrice) &&
      offer.packagePrice > 20 &&
      (!Number.isFinite(offer.unitCount) || offer.unitCount <= 1)
    ) {
      findings.push(
        buildFinding(
          product,
          offer,
          "missing-package-count",
          "Le prix ressemble à un paquet, mais le nombre de portions n'est pas confirmé.",
        ),
      );
    }

    const urlPackageCount = inferPackageCountFromUrl(offer.productUrl);
    if (
      Number.isFinite(urlPackageCount) &&
      Number.isFinite(offer.unitCount) &&
      urlPackageCount !== offer.unitCount
    ) {
      findings.push(
        buildFinding(
          product,
          offer,
          "url-package-count-mismatch",
          `L'URL indique un paquet de ${urlPackageCount}, mais l'offre est divisée par ${offer.unitCount}.`,
        ),
      );
    }

    if (
      Number.isFinite(offer.packagePrice) &&
      Number.isFinite(offer.unitCount) &&
      offer.unitCount > 1
    ) {
      const recomputedUnitPrice = round(offer.packagePrice / offer.unitCount);
      if (Math.abs(recomputedUnitPrice - offer.price) > 0.02) {
        findings.push(
          buildFinding(
            product,
            offer,
            "unit-price-math-mismatch",
            "Le prix par portion ne correspond pas au prix du paquet divisé par le nombre d'unités.",
          ),
        );
      }
    }

    if (status === "fallback" || status === "review") {
      findings.push(
        buildFinding(
          product,
          offer,
          status,
          offer.verificationReason ?? "Cette offre demande une vérification.",
        ),
      );
    }
  }
}

const summary = {
  updatedAt: new Date().toISOString(),
  generatedAt: catalog.updatedAt,
  productCount: catalog.products?.length ?? 0,
  offerCount: (catalog.products ?? []).reduce(
    (sum, product) => sum + (product.offers?.length ?? 0),
    0,
  ),
  findingsCount: findings.length,
  fallbackCount: findings.filter((finding) => finding.code === "fallback").length,
  reviewCount: findings.filter((finding) =>
    ["review", "broken-link", "missing-price", "missing-package-count"].includes(finding.code),
  ).length,
};

await mkdir(path.dirname(auditPath), { recursive: true });
await writeFile(auditPath, JSON.stringify({ summary, findings }, null, 2));

console.log(
  `Audited ${summary.offerCount} offers: ${summary.findingsCount} findings written to ${auditPath}`,
);

function buildFinding(product, offer, code, message) {
  return {
    code,
    message,
    productId: product.id,
    productName: `${product.brand} ${product.name}`,
    seller: offer.seller,
    productUrl: offer.productUrl,
    price: offer.price,
    packagePrice: offer.packagePrice,
    unitCount: offer.unitCount,
    verificationStatus: offer.verificationStatus ?? inferStatus(offer),
    verificationReason: offer.verificationReason,
  };
}

function inferStatus(offer) {
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
    offer.packagePrice > 20 &&
    offer.unitCount > 1
  ) {
    return "verified";
  }

  return offer.priceConfidence === "live" ? "verified" : "review";
}

function inferPackageCountFromUrl(url) {
  if (!url) {
    return null;
  }

  const normalized = url
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_/%]+/g, " ")
    .toLowerCase();
  const match = normalized.match(
    /\b(?:box|boite|case|pack|paquet|bundle)\s*(?:of|de|x)?\s*(\d{1,3})\b/,
  );
  if (!match) {
    return null;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 1 && value <= 60 ? value : null;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
