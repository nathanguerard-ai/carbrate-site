"use client";

import { useState, useEffect } from "react";
import {
  clampTargetGrams,
  DEFAULT_TARGET_CARBS,
  getCatalogUpdatedAt,
  getProductBrands,
  getProducts,
  getProductTypes,
} from "@/lib/carbrate";

export default function Home() {
  const [targetGrams, setTargetGrams] = useState(DEFAULT_TARGET_CARBS);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("ratio");
  const [page, setPage] = useState(1);
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
  const totalPages = Math.ceil(visibleProducts.length / itemsPerPage);
  const best = allProducts[0];
  const visibleBest = visibleProducts[0] ?? best;
  const visibleBrandCount = new Set(
    visibleProducts.map((product) => product.brand),
  ).size;
  const hasActiveFilters =
    selectedTypes.length > 0 ||
    selectedBrands.length > 0 ||
    normalizedSearch.length > 0;
  const scopeDescription = hasActiveFilters
    ? "dans la sélection"
    : "dans le catalogue";

  return (
    <div className="mx-auto w-full max-w-7xl flex-col px-6 py-8 sm:px-8 lg:px-10">
      <section className="grid gap-8 pb-10 pt-4 lg:grid-cols-[1.08fr_0.92fr]">
        <div>
          <div className="inline-flex rounded-full border border-ink/10 bg-white/70 px-4 py-2 text-sm text-ink/75 backdrop-blur">
            Outil de décision en nutrition sportive pour les athlètes d'endurance
          </div>
          <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.04em] text-ink sm:text-6xl">
            Trouve ta nutrition d'effort au meilleur prix.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-ink/72">
            CarbRate t'aide à repérer les gels, boissons, bonbons et barres les plus
            rentables selon leur ratio en grammes de glucides par dollar.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink/62">
            Chaque produit est comparé sur plusieurs sites canadiens et
            l'offre la moins chère est affichée.
          </p>
          <div className="mt-8 flex flex-wrap gap-3 text-sm text-ink/72">
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              <span className="font-semibold text-ink">{allProducts.length}</span>{" "}
              produits suivis
            </div>
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              Estimation des meilleures offres sur les produits suivis
            </div>
            <div className="rounded-full border border-[var(--line)] bg-white/65 px-4 py-2 backdrop-blur">
              Mise à jour le{" "}
              <span className="font-semibold text-ink">
                {formatDate(getCatalogUpdatedAt())}
              </span>
            </div>
          </div>
        </div>

        <section className="rounded-[2rem] border border-[var(--line)] bg-ink p-6 text-white shadow-card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/45">
                Objectif
              </p>
              <h2 className="mt-3 text-2xl font-semibold">
                Choisis ta cible de glucides.
              </h2>
              <p className="mt-3 text-sm text-white/70">
                Le tableau et les recommandations se mettent à jour automatiquement.
              </p>
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
                onClick={() => setTargetGrams(preset)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  targetGrams === preset
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
                  value={targetGrams}
                  onChange={(event) =>
                    setTargetGrams(clampTargetGrams(Number(event.target.value)))
                  }
                  className="w-[4.25rem] bg-transparent px-2 py-2 text-right text-white outline-none"
                />
                <span className="min-w-[3.1rem] border-l border-white/10 px-2 py-2 text-center text-sm font-medium whitespace-nowrap text-white/70">
                  g/h
                </span>
              </div>
              <input
                type="range"
                min="30"
                max="180"
                step="5"
                value={targetGrams}
                onChange={(event) =>
                  setTargetGrams(clampTargetGrams(Number(event.target.value)))
                }
                className="w-full accent-[#c95c2b]"
              />
            </div>
          </div>

          <p className="mt-5 text-xs text-white/48">
            Données mises à jour le {formatDate(getCatalogUpdatedAt())}.
          </p>
        </section>
      </section>

      

      <section className="py-10">
        <div className="mb-5 flex flex-col gap-5">
          <div>
            <h2 className="text-3xl font-semibold text-ink">
              Quel produit offre le meilleur rapport ?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/68">
              Recherche un produit, limite par type ou marque, puis trie selon la
              métrique qui t'importe vraiment.
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
                    placeholder="Maurten, gel, XACT..."
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
                {productBrands.map((brand) => (
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
                    {brand}
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
          <div className="overflow-x-auto">
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
              <thead className="sticky top-0 z-10 border-b border-[var(--line)] bg-[#f7f1e6]/95 text-xs uppercase tracking-[0.18em] text-ink/55 backdrop-blur">
                <tr>
                  <th className="px-6 py-4 text-center">Rang</th>
                  <th className="px-6 py-4">Produit</th>
                  <th className="px-6 py-4 text-center">Type</th>
                  <th className="px-6 py-4 text-center">Glucides</th>
                  <th className="px-6 py-4 text-center">Prix</th>
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
                {paginatedProducts.map((product, index) => (
                  <tr
                    key={product.id}
                    className={`border-b border-[var(--line)] align-top last:border-b-0 ${
                      index === 0 ? "bg-pine/6" : "hover:bg-white/30"
                    }`}
                  >
                    <td className="px-6 py-5 text-center align-middle">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                          medalStyles[index] ?? "bg-ink/8 text-ink/70"
                        } mx-auto`}
                      >
                        #{index + 1}
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
                        <a
                          href={product.cheapestOffer.productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-xs text-ink/72 transition hover:border-accent hover:text-accent"
                        >
                          Voir l'offre la moins chère
                        </a>
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
                        ${product.cheapestOffer.price.toFixed(2)}
                      </p>
                      <p className="mt-1 text-xs text-ink/55">
                        chez {product.cheapestOffer.seller}
                      </p>
                    </td>
                    <td className="px-6 py-5 text-center align-middle">
                      <p className="text-lg font-semibold text-accent">
                        {product.carbsPerDollar.toFixed(2)}
                      </p>
                      <p className="text-xs uppercase tracking-[0.16em] text-ink/45">
                        g / $
                      </p>
                    </td>
                    <td className="px-6 py-5 text-center align-middle">
                      <p className="text-lg font-semibold text-ink">
                        ${product.costForTargetGrams.toFixed(2)}
                      </p>
                      <p className="text-xs uppercase tracking-[0.16em] text-ink/45">
                        pour atteindre {targetGrams} g
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <p className="text-sm text-ink/60">
                  Page {page} sur {totalPages} ({visibleProducts.length} produits)
                </p>
                <div className="flex gap-2">
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

function describePlan(totalCarbs: number, targetGrams: number) {
  if (totalCarbs === targetGrams) {
    return "Cette combinaison atteint exactement la cible.";
  }

  if (totalCarbs > targetGrams) {
    return `Cette combinaison dépasse la cible de ${totalCarbs - targetGrams} g.`;
  }

  return `Cette combinaison reste ${targetGrams - totalCarbs} g sous la cible.`;
}

function formatMultiplier(value: number) {
  if (Number.isInteger(value)) {
    return `${value}x`;
  }

  return `${value.toString().replace(".", ",")}x`;
}

function formatPortions(value: number) {
  const label = value.toString().replace(".", ",");
  return `${label} portion${value > 1 ? "s" : ""}`;
}
