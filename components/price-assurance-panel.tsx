import {
  getOfferVerificationLabel,
  getOfferVerificationStatus,
  type OfferAssuranceSummary,
  type ProductWithMetrics,
} from "@/lib/carbrate";

type PriceAssurancePanelProps = {
  summary: OfferAssuranceSummary;
};

export function PriceAssurancePanel({ summary }: PriceAssurancePanelProps) {
  const reviewProducts = summary.reviewProducts.slice(0, 4);

  return (
    <section className="py-8">
      <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
              Prix vérifiés
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-ink">
              Les prix sont classés avant d'être recommandés.
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink/65">
              Chaque offre reçoit un statut: vérifié, estimé, prix de secours ou
              à vérifier. L'assistant privilégie les offres fiables et garde les
              liens vendeurs visibles.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="vérifiés" value={summary.verifiedOffers} />
            <Metric label="estimés" value={summary.estimatedOffers} />
            <Metric label="secours" value={summary.fallbackOffers} />
            <Metric label="à vérifier" value={summary.reviewOffers} />
          </div>
        </div>

        {reviewProducts.length > 0 ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {reviewProducts.map((product) => (
              <ReviewProduct key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-pine/20 bg-pine/8 px-4 py-3 text-sm text-pine">
            Aucun produit critique dans les offres affichables.
          </p>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white px-4 py-3 text-center">
      <p className="text-xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/45">
        {label}
      </p>
    </div>
  );
}

function ReviewProduct({ product }: { product: ProductWithMetrics }) {
  const offer = product.offers.find((entry) =>
    ["fallback", "review"].includes(getOfferVerificationStatus(entry)),
  ) ?? product.cheapestOffer;

  return (
    <a
      href={offer.productUrl}
      target="_blank"
      rel="noreferrer"
      className="rounded-xl border border-ink/10 bg-white/70 p-4 transition hover:border-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-ink">
            {product.brand} {product.name}
          </p>
          <p className="mt-1 text-sm text-ink/55">{offer.seller}</p>
        </div>
        <span className="rounded-full border border-amber-500/25 bg-amber-100 px-3 py-1 text-xs text-amber-900">
          {getOfferVerificationLabel(offer)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-ink/62">
        {offer.verificationReason ??
          "Cette offre demande une validation automatique plus prudente."}
      </p>
    </a>
  );
}
