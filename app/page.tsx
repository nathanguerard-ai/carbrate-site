"use client";

import { useState, useEffect } from "react";
import { NutritionAdvisorPanel } from "@/components/nutrition-advisor-panel";
import {
  clampTargetGrams,
  DEFAULT_TARGET_CARBS,
  getCatalogUpdatedAt,
  getOfferAssuranceSummary,
  getOfferVerificationLabel,
  getOfferVerificationStatus,
  getProductBrandCounts,
  getProductBrands,
  getPortionRecommendations,
  getProducts,
  getProductTypes,
  type Offer,
} from "@/lib/product-offer-catalog";

type DisplayMode = "auto" | "desktop" | "mobile";

export default function Home() {
  const [targetGrams, setTargetGrams] = useState(DEFAULT_TARGET_CARBS);
  const [pendingTargetGrams, setPendingTargetGrams] = useState(DEFAULT_TARGET_CARBS);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("ratio");
  const [page, setPage] = useState(1);
  const [displayMode, setDisplayMode] = useState<DisplayMode>("auto");
  const itemsPerPage = 20;

  useEffect(() => {
    setPage(1);
  }, [selectedTypes, selectedBrands, searchTerm, sortBy, targetGrams]);
  const targetPresets = [30, 60, 90, 120];
  const medalStyles = [
    "border-[#b68b1e] bg-[#f0c75a] text-[#3a2b00]",
    "border-[#8f98a3] bg-[#dfe5eb] text-[#23303c]",
    "border-[#8f583b] bg-[#c98354] text-white",
  ];

  const allProducts = getProducts(targetGrams);
  const productTypes = getProductTypes();
  const productBrands = getProductBrands();
  const productBrandCounts = getProductBrandCounts(allProducts);
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredProducts = allProducts.filter((product) => {
    const typeMatch =
      selectedTypes.length === 0 || selectedTypes.includes(product.type);
    const brandMatch =
      selectedBrands.length === 0 || selectedBrands.includes(product.brand);
    const searchMatch =
      normalizedSearch.length === 0 ||
      product.name.toLowerCase().includes(normalizedSearch) ||
      product.brand.toLowerCase().includes(normalizedSearch) ||
      product.type.toLowerCase().includes(normalizedSearch) ||
      product.offers.some((offer) =>
        offer.seller.toLowerCase().includes(normalizedSearch),
      );
    return typeMatch && brandMatch && searchMatch;
  });
  const visibleProducts = [...filteredProducts].sort((a, b) => {
    if (sortBy === "cost") {
      return a.costForTargetGrams - b.costForTargetGrams;
    }

    if (sortBy === "price") {
      return a.cheapestOffer.price - b.cheapestOffer.price;
    }

    if (sortBy === "carbs") {
      return b.carbsGrams - a.carbsGrams;
    }

    return b.carbsPerDollar - a.carbsPerDollar;
  });
  const paginatedProducts = visibleProducts.slice(
    (page - 1) * itemsPerPage,
    page * itemsPerPage,
  );
  const quickPlans = getPortionRecommendations(visibleProducts, targetGrams, 3);
  const assuranceSummary = getOfferAssuranceSummary(allProducts);
  const totalPages = Math.ceil(visibleProducts.length / itemsPerPage);
  const hasActiveFilters =
    selectedTypes.length > 0 ||
    selectedBrands.length > 0 ||
    normalizedSearch.length > 0;
  const tableVisibilityClass =
    displayMode === "mobile"
      ? "hidden"
      : displayMode === "desktop"
        ? "block"
        : "hidden md:block";
  const mobileVisibilityClass =
    displayMode === "desktop"
      ? "hidden"
      : displayMode === "mobile"
        ? "grid"
        : "grid md:hidden";

  return (
    <div className="mx-auto w-full max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-10">
      <section className="grid gap-8 pb-10 pt-4 lg:grid-cols-[1.08fr_0.92fr]">
        <div>
          <div className="inline-flex rounded-full border border-pine/15 bg-white px-4 py-2 text-sm font-medium text-pine shadow-sm">
            Nutrition sportive d'endurance
          </div>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold text-ink sm:text-6xl">
            Compare les glucides, les prix et les portions.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/72">
            CarbRate classe les gels, boissons, barres et autres produits selon leur
            coût réel, leur apport en glucides et leur disponibilité chez des
            détaillants canadiens.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-ink/72">
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              <span className="font-semibold text-ink">{allProducts.length}</span>{" "}
              produits suivis
            </div>
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              <span className="font-semibold text-ink">{productBrands.length}</span>{" "}
              marques disponibles
            </div>
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              Mise à jour le{" "}
              <span className="font-semibold text-ink">
                {formatDate(getCatalogUpdatedAt())}
              </span>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#comparateur"
              className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-white transition hover:bg-accent"
            >
              Explorer le comparateur
            </a>
            <a
              href="#plan-effort"
              className="rounded-full border border-[var(--line)] bg-white/75 px-5 py-3 text-sm font-medium text-ink transition hover:border-accent hover:text-accent"
            >
              Construire un plan d'effort
            </a>
          </div>
          <div className="mt-6 inline-flex flex-wrap gap-2 rounded-lg border border-[var(--line)] bg-white p-2 shadow-sm">
            {[
              ["auto", "Auto"],
              ["desktop", "Ordinateur"],
              ["mobile", "Cellulaire"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDisplayMode(mode as DisplayMode)}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  displayMode === mode
                    ? "bg-pine text-white"
                    : "text-ink/65 hover:bg-pine/8 hover:text-pine"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border border-[var(--line)] bg-ink text-white shadow-card">
          <img
            src="https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=1200&q=80"
            alt=""
            className="h-36 w-full object-cover"
          />
          <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white/55">
                Objectif
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                Définis ta cible horaire.
              </h2>
            </div>
            <div className="rounded-[1.25rem] border border-white/10 bg-white/10 px-5 py-4 text-center">
              <p className="text-xs uppercase tracking-[0.16em] text-white/45">
                Cible active
              </p>
              <p className="mt-1 text-2xl font-semibold text-white">
                {targetGrams} g/h
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {targetPresets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setPendingTargetGrams(preset)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  pendingTargetGrams === preset
                    ? "bg-accent text-white"
                    : "border border-white/15 bg-white/10 text-white/80"
                }`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-4">
            <label className="text-sm text-white/70" htmlFor="target-grams">
              Valeur personnalisée
            </label>
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center rounded-xl border border-white/15 bg-white/10">
                <input
                  id="target-grams"
                  type="number"
                  min="30"
                  max="180"
                  step="5"
                  value={pendingTargetGrams}
                  onChange={(event) =>
                    setPendingTargetGrams(clampTargetGrams(Number(event.target.value)))
                  }
                  className="w-[4.25rem] bg-transparent px-2 py-2 text-right text-white outline-none"
                />
                <span className="min-w-[3.1rem] border-l border-white/10 px-2 py-2 text-center text-sm font-medium whitespace-nowrap text-white/70">
                  g/h
                </span>
                <button
                  type="button"
                  onClick={() => setTargetGrams(pendingTargetGrams)}
                  disabled={pendingTargetGrams === targetGrams}
                  className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Ok
                </button>
              </div>
              <input
                type="range"
                min="30"
                max="180"
                step="5"
                value={pendingTargetGrams}
                onChange={(event) =>
                  setPendingTargetGrams(clampTargetGrams(Number(event.target.value)))
                }
                className="w-full accent-[#e64b5d]"
              />
            </div>
          </div>
          </div>
        </section>
      </section>

      <section className="grid gap-5 pb-4 lg:grid-cols-3">
        {[
          {
            title: "Plans plus stricts",
            body:
              "CarbRate pénalise désormais les formats trop denses, les grosses surcharges et les schémas difficiles à exécuter en mouvement.",
          },
          {
            title: "Contexte réel",
            body:
              "Le moteur tient compte du sport, de l'intensité, de la chaleur, de la tolérance digestive et de la logistique de ravito.",
          },
          {
            title: "Exécution terrain",
            body:
              "Chaque recommandation peut maintenant se lire comme un déroulé d'effort: rythme de prise, dilution, vigilance et checklist.",
          },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-[1.5rem] border border-[var(--line)] bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-ink">{item.title}</p>
            <p className="mt-2 text-sm leading-6 text-ink/65">{item.body}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-5 pb-4 lg:grid-cols-[1.08fr_0.92fr]">
        <div
          id="plans-rapides"
          className="rounded-[2rem] border border-[var(--line)] bg-[var(--panel)] p-6 shadow-card backdrop-blur"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                Plans rapides
              </p>
              <h2 className="mt-2 text-3xl font-semibold text-ink">
                Atteins {targetGrams} g/h sans calcul mental.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/68">
                Ces combinaisons sont générées à partir des produits visibles et
                privilégient un bon équilibre entre précision, coût et simplicité.
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 text-sm text-ink/68">
              {visibleProducts.length} options filtrées
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-3">
            {quickPlans.length === 0 ? (
              <div className="rounded-[1.5rem] border border-[var(--line)] bg-white p-5 text-sm text-ink/60 xl:col-span-3">
                Aucun plan rapide disponible avec les filtres actuels.
              </div>
            ) : null}
            {quickPlans.map((plan, index) => (
              <article
                key={plan.items.map((item) => `${item.productId}-${item.portions}`).join("-")}
                className="rounded-[1.5rem] border border-[var(--line)] bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
                      {index === 0
                        ? "Le plus efficace"
                        : index === 1
                          ? "Alternative mixte"
                          : "Option simple"}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold text-ink">
                      {getQuickPlanHeadline(plan)}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      plan.deltaFromTarget >= 0
                        ? "bg-pine/10 text-pine"
                        : "bg-accent/10 text-accent"
                    }`}
                  >
                    {plan.matchLabel}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-pine/8 px-3 py-3">
                    <p className="text-xs text-ink/55">Glucides</p>
                    <p className="mt-1 font-semibold text-ink">{plan.totalCarbs} g</p>
                  </div>
                  <div className="rounded-xl bg-accent/8 px-3 py-3">
                    <p className="text-xs text-ink/55">Coût</p>
                    <p className="mt-1 font-semibold text-ink">${plan.totalCost.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl bg-ink/5 px-3 py-3">
                    <p className="text-xs text-ink/55">Portions</p>
                    <p className="mt-1 font-semibold text-ink">{plan.portionCount}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {plan.items.map((item) => (
                    <div
                      key={`${item.productId}-${item.portions}`}
                      className="flex items-start justify-between gap-3 rounded-xl bg-[var(--background)] px-3 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {formatPortions(item.portions)} x {item.brand} {item.name}
                        </p>
                        <p className="mt-1 text-xs text-ink/55">
                          {item.type} · {item.totalCarbs} g · ${item.totalPrice.toFixed(2)}
                        </p>
                      </div>
                      <a
                        href={findProductUrlById(visibleProducts, item.productId)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-ink/10 bg-white px-3 py-1.5 text-xs text-ink/72 transition hover:border-accent hover:text-accent"
                      >
                        Voir
                      </a>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-[2rem] border border-[var(--line)] bg-ink p-6 text-white shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
            Qualité des prix
          </p>
          <h2 className="mt-2 text-3xl font-semibold">
            Lis la fiabilité avant d'acheter.
          </h2>
          <p className="mt-3 text-sm leading-6 text-white/72">
            CarbRate distingue les prix vérifiés, estimés ou à revoir pour éviter
            qu'un produit paraisse meilleur qu'il ne l'est réellement.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4">
              <p className="text-sm text-white/60">Prix vérifiés</p>
              <p className="mt-1 text-3xl font-semibold">
                {assuranceSummary.verifiedOffers}
              </p>
              <p className="mt-2 text-xs text-white/55">
                sur {assuranceSummary.totalOffers} offres suivies
              </p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/10 p-4">
              <p className="text-sm text-white/60">Produits avec meilleur prix vérifié</p>
              <p className="mt-1 text-3xl font-semibold">
                {assuranceSummary.verifiedProductCount}
              </p>
              <p className="mt-2 text-xs text-white/55">
                sur {allProducts.length} produits
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            {[
              {
                label: "Vérifié",
                value: assuranceSummary.verifiedOffers,
                tone: "bg-pine/15 text-white",
              },
              {
                label: "Estimé",
                value: assuranceSummary.estimatedOffers,
                tone: "bg-white/10 text-white/90",
              },
              {
                label: "Secours ou revue",
                value:
                  assuranceSummary.fallbackOffers + assuranceSummary.reviewOffers,
                tone: "bg-accent/20 text-white",
              },
            ].map((entry) => (
              <div
                key={entry.label}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <span className="text-sm text-white/72">{entry.label}</span>
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${entry.tone}`}>
                  {entry.value}
                </span>
              </div>
            ))}
          </div>

          {assuranceSummary.reviewProducts.length > 0 ? (
            <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-medium text-white">Produits à surveiller</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {assuranceSummary.reviewProducts.slice(0, 5).map((product) => (
                  <span
                    key={product.id}
                    className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs text-white/80"
                  >
                    {product.brand} {product.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </section>

      <section id="plan-effort">
        <NutritionAdvisorPanel />
      </section>

      <section id="comparateur" className="py-10">
        <div className="mb-5 flex flex-col gap-5">
          <div>
            <h2 className="text-3xl font-semibold text-ink">
              Comparateur produits
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/68">
              Filtre par type ou marque, puis classe les produits selon le
              ratio, le coût ou la quantité de glucides.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1.1fr_0.95fr]">
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--panel)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
                Contrôles
              </p>
              <div className="mt-3 grid gap-3">
                <label className="grid gap-2 text-sm text-ink/72">
                  Recherche
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Maurten, gel, UPIKA..."
                    className="rounded-xl border border-ink/10 bg-white/70 px-3 py-2 text-ink outline-none transition placeholder:text-ink/35 focus:border-accent"
                    suppressHydrationWarning={true}
                  />
                </label>
                <label className="grid gap-2 text-sm text-ink/72">
                  Tri
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value)}
                    className="rounded-xl border border-ink/10 bg-white/70 px-3 py-2 text-ink outline-none transition focus:border-accent"
                  >
                    <option value="ratio">Meilleur ratio g/$</option>
                    <option value="cost">Coût le plus bas</option>
                    <option value="price">Prix le plus bas</option>
                    <option value="carbs">Plus de glucides</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTypes([]);
                    setSelectedBrands([]);
                    setSearchTerm("");
                    setSortBy("ratio");
                  }}
                  className="rounded-xl border border-ink/10 bg-white/70 px-3 py-2 text-sm text-ink/72 transition hover:border-accent hover:text-accent"
                >
                  Réinitialiser
                </button>
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--panel)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
                Type
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTypes([])}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    selectedTypes.length === 0
                      ? "bg-ink text-white"
                      : "border border-ink/10 bg-white/70 text-ink/72"
                  }`}
                >
                  Tous
                </button>
                {productTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() =>
                      setSelectedTypes((current) =>
                        current.includes(type)
                          ? current.filter((entry) => entry !== type)
                          : [...current, type],
                      )
                    }
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      selectedTypes.includes(type)
                        ? "bg-ink text-white"
                        : "border border-ink/10 bg-white/70 text-ink/72"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--panel)] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-ink/50">
                Marque
              </p>
              <p className="mt-2 text-xs text-ink/55">
                {productBrands.length} marques disponibles, dont Carbs Fuel.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedBrands([])}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    selectedBrands.length === 0
                      ? "bg-ink text-white"
                      : "border border-ink/10 bg-white/70 text-ink/72"
                  }`}
                >
                  Toutes
                </button>
                {productBrandCounts.map(({ brand, count }) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() =>
                      setSelectedBrands((current) =>
                        current.includes(brand)
                          ? current.filter((entry) => entry !== brand)
                          : [...current, brand],
                      )
                    }
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      selectedBrands.includes(brand)
                        ? "bg-ink text-white"
                        : "border border-ink/10 bg-white/70 text-ink/72"
                    }`}
                  >
                    {brand}{" "}
                    <span className="text-xs opacity-70">({count})</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--panel)] shadow-card backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-[var(--line)] bg-white/35 px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm text-ink/70">
                {labelForSort(sortBy, targetGrams)}
              </p>
              <p className="mt-1 text-xs text-ink/50">
                {visibleProducts.length > 0
                  ? `Affichage de ${(page - 1) * itemsPerPage + 1}-${Math.min(
                      page * itemsPerPage,
                      visibleProducts.length,
                    )} sur ${visibleProducts.length} produits visibles.`
                  : "Aucun produit visible avec les filtres actuels."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">
                {visibleProducts.length} produits
              </div>
              {hasActiveFilters ? (
                <div className="rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-sm text-accent">
                  filtres actifs
                </div>
              ) : null}
            </div>
          </div>
          {hasActiveFilters ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] bg-white/55 px-6 py-3">
              <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink/45">
                Filtres actifs
              </span>
              {selectedTypes.map((type) => (
                <span
                  key={`type-${type}`}
                  className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/72"
                >
                  Type: {type}
                </span>
              ))}
              {selectedBrands.map((brand) => (
                <span
                  key={`brand-${brand}`}
                  className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/72"
                >
                  Marque: {brand}
                </span>
              ))}
              {normalizedSearch.length > 0 ? (
                <span className="rounded-full border border-ink/10 bg-white px-3 py-1 text-xs text-ink/72">
                  Recherche: {searchTerm.trim()}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className={`${mobileVisibilityClass} gap-3 p-4`}>
            {paginatedProducts.length === 0 ? (
              <div className="rounded-lg border border-[var(--line)] bg-white p-5 text-center text-sm text-ink/60">
                Aucun produit ne correspond à cette combinaison de filtres.
              </div>
            ) : null}
            {paginatedProducts.map((product, index) => {
              const globalIndex = (page - 1) * itemsPerPage + index;

              return (
                <article
                  key={`mobile-${product.id}`}
                  className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-accent">
                        #{globalIndex + 1} · {product.type}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-ink">
                        {product.brand} {product.name}
                      </h3>
                    </div>
                    {getOfferStatusTone(product.cheapestOffer) ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${getOfferStatusTone(
                          product.cheapestOffer,
                        )}`}
                      >
                        {getOfferVerificationLabel(product.cheapestOffer)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-pine/8 px-2 py-3">
                      <p className="text-xs text-ink/55">Glucides</p>
                      <p className="mt-1 font-semibold text-ink">{product.carbsGrams} g</p>
                    </div>
                    <div className="rounded-lg bg-accent/8 px-2 py-3">
                      <p className="text-xs text-ink/55">Ratio</p>
                      <p className="mt-1 font-semibold text-accent">
                        {product.carbsPerDollar.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white px-2 py-3 ring-1 ring-ink/10">
                      <p className="text-xs text-ink/55">Coût</p>
                      <p className="mt-1 font-semibold text-ink">
                        ${product.costForTargetGrams.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-sm text-ink/65">
                      <p className="font-semibold text-ink">
                        ${getDisplayedOfferPrice(product.cheapestOffer).toFixed(2)}
                      </p>
                      <p>{describeOfferPrice(product.cheapestOffer)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {getProductLinks(product).map((link) => (
                          <a
                            key={link.href}
                            href={link.href}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-ink/10 bg-white px-2.5 py-1 text-xs text-ink/72 transition hover:border-accent hover:text-accent"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </div>
                    <a
                      href={product.cheapestOffer.productUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white transition hover:bg-accent"
                    >
                      Voir
                    </a>
                  </div>
                </article>
              );
            })}
            {totalPages > 1 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white p-3">
                <p className="text-sm text-ink/60">
                  Page {page} sur {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="rounded-md border border-[var(--line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Précédent
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                    className="rounded-md border border-[var(--line)] px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className={`${tableVisibilityClass} overflow-x-auto`}>
            <table className="min-w-full table-fixed text-left">
              <colgroup>
                <col className="w-20" />
                <col className="w-[34%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-[var(--line)] bg-[#edf8f4]/95 text-xs font-semibold text-ink/55 backdrop-blur">
                <tr>
                  <th className="px-6 py-4 text-center">#</th>
                  <th className="px-6 py-4 text-left">Produit</th>
                  <th className="px-6 py-4 text-center">Type</th>
                  <th className="px-6 py-4 text-center">Glucides</th>
                  <th className="px-6 py-4 text-center">Prix affiché</th>
                  <th className="px-6 py-4 text-center">Grammes de glucides / $</th>
                  <th className="px-6 py-4 text-center">Coût</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-6 py-10 text-center text-sm text-ink/60"
                    >
                      Aucun produit ne correspond à cette combinaison de filtres.
                    </td>
                  </tr>
                ) : null}
                {paginatedProducts.map((product, index) => {
                  const globalIndex = (page - 1) * itemsPerPage + index;
                  return (
                    <tr
                      key={product.id}
                      className={`border-b border-[var(--line)] align-top last:border-b-0 ${
                        index === 0 ? "bg-pine/6" : "hover:bg-white/30"
                      }`}
                    >
                      <td className="px-6 py-5 text-center align-middle">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                            medalStyles[globalIndex] ?? "bg-ink/8 text-ink/70"
                          } mx-auto`}
                        >
                          #{globalIndex + 1}
                        </div>
                      </td>
                      <td className="px-6 py-5 align-middle">
                        <div className="max-w-[18rem]">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium text-ink">
                              {product.brand} {product.name}
                            </p>
                            {index === 0 ? (
                              <span className="rounded-full bg-pine/12 px-2.5 py-1 text-xs font-medium text-pine">
                                Meilleur ratio
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {getProductLinks(product).map((link) => (
                              <a
                                key={link.href}
                                href={link.href}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-xs text-ink/72 transition hover:border-accent hover:text-accent"
                              >
                                {link.label}
                              </a>
                            ))}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center align-middle">
                        <span className="rounded-full border border-ink/10 bg-white/60 px-3 py-1.5 text-sm text-ink/75">
                          {product.type}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-center align-middle text-sm font-medium text-ink">
                        {product.carbsGrams} g
                      </td>
                      <td className="px-6 py-5 text-center align-middle text-sm font-medium text-ink">
                        <p className="text-lg font-semibold text-ink">
                          ${getDisplayedOfferPrice(product.cheapestOffer).toFixed(2)}
                        </p>
                        <p className="mt-1 text-xs text-ink/55">
                          {describeOfferPrice(product.cheapestOffer)} chez {product.cheapestOffer.seller}
                        </p>
                        {getOfferStatusTone(product.cheapestOffer) ? (
                          <span
                            className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs ${getOfferStatusTone(
                              product.cheapestOffer,
                            )}`}
                          >
                            {getOfferVerificationLabel(product.cheapestOffer)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-5 text-center align-middle">
                        <p className="text-lg font-semibold text-accent">
                          {product.carbsPerDollar.toFixed(2)}
                        </p>
                        <p className="text-xs uppercase tracking-[0.16em] text-ink/45">
                          g/$
                        </p>
                      </td>
                      <td className="px-6 py-5 text-center align-middle">
                        <p className="text-lg font-semibold text-ink">
                          ${product.costForTargetGrams.toFixed(2)}
                        </p>
                        <p className="text-xs text-ink/55">
                          pour {targetGrams}g
                        </p>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 px-6 pb-6">
                <p className="text-sm text-ink/60">
                  Page {page} sur {totalPages} ({visibleProducts.length} produits)
                </p>
                <div className="flex gap-2 pr-1">
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page === 1}
                    className="rounded px-3 py-1 text-sm border border-[var(--line)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/50"
                  >
                    Précédent
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page === totalPages}
                    className="rounded px-3 py-1 text-sm border border-[var(--line)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function labelForSort(sortBy: string, targetGrams: number) {
  if (sortBy === "cost") {
    return `Trié par coût le plus bas pour atteindre ${targetGrams} g de glucides.`;
  }

  if (sortBy === "price") {
    return "Trié par prix unitaire le plus bas.";
  }

  if (sortBy === "carbs") {
    return "Trié par quantité de glucides par portion.";
  }

  return "Trié par grammes de glucides par dollar.";
}

function getDisplayedOfferPrice(offer: {
  price: number;
  packagePrice?: number;
  unitCount?: number;
}) {
  if (
    Number.isFinite(offer.packagePrice) &&
    Number.isFinite(offer.unitCount) &&
    (offer.unitCount ?? 1) > 1
  ) {
    return offer.packagePrice ?? offer.price;
  }

  return offer.price;
}

function describeOfferPrice(offer: {
  price: number;
  packagePrice?: number;
  unitCount?: number;
}) {
  if (
    Number.isFinite(offer.packagePrice) &&
    Number.isFinite(offer.unitCount) &&
    (offer.unitCount ?? 1) > 1
  ) {
    return `${offer.price.toFixed(2)} $/portion`;
  }

  return "prix unitaire";
}

function getOfferStatusTone(offer: Offer) {
  const status = getOfferVerificationStatus(offer);

  if (status === "verified") {
    return "bg-pine/10 text-pine";
  }

  if (status === "estimated") {
    return "bg-ink/8 text-ink/72";
  }

  return "bg-accent/10 text-accent";
}

function getQuickPlanHeadline(plan: {
  distinctProductCount: number;
  distinctTypeCount: number;
}) {
  if (plan.distinctProductCount === 1) {
    return "Une seule référence";
  }

  if (plan.distinctTypeCount > 1) {
    return "Mix de formats";
  }

  return "Plan économique";
}

function formatPortions(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function findProductUrlById(
  products: Array<{ id: string; cheapestOffer: Offer }>,
  productId: string,
) {
  return products.find((product) => product.id === productId)?.cheapestOffer.productUrl ?? "#";
}

function getProductLinks(product: {
  officialProductUrl?: string;
  cheapestOffer: Offer;
}) {
  const officialUrl = product.officialProductUrl;
  const cheapestUrl = product.cheapestOffer.productUrl;

  if (!officialUrl) {
    return [{ href: cheapestUrl, label: "Meilleur prix" }];
  }

  if (normalizeUrl(officialUrl) === normalizeUrl(cheapestUrl)) {
    return [{ href: officialUrl, label: "Page officielle" }];
  }

  return [
    { href: officialUrl, label: "Page officielle" },
    { href: cheapestUrl, label: "Meilleur prix" },
  ];
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}
