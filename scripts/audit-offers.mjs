import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const generatedPath = path.join(projectRoot, "data", "generated-offers.json");
const auditPath = path.join(projectRoot, "data", "offer-audit.json");

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

  return offer.priceConfidence === "live" ? "verified" : "review";
}
