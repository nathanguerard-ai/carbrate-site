import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const rootDir = process.cwd();
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "carbrate-advisor-"));
const tempLibDir = path.join(tempDir, "lib");
const tempDataDir = path.join(tempDir, "data");

await fs.mkdir(tempLibDir, { recursive: true });
await fs.mkdir(tempDataDir, { recursive: true });

const nutritionAdvisorSource = await fs.readFile(
  path.join(rootDir, "lib/nutrition-advisor.ts"),
  "utf8",
);
const productCatalogSource = await fs.readFile(
  path.join(rootDir, "lib/product-offer-catalog.ts"),
  "utf8",
);

const rewrittenNutritionAdvisor = nutritionAdvisorSource.replace(
  /import\s+\{\s*DEFAULT_TARGET_CARBS,\s*ProductType,\s*ProductWithMetrics,\s*getOfferVerificationStatus,\s*getProducts,\s*\}\s+from\s+"@\/lib\/product-offer-catalog";/s,
  "import { DEFAULT_TARGET_CARBS, getOfferVerificationStatus, getProducts } from './product-offer-catalog.ts';\nimport type { ProductType, ProductWithMetrics } from './product-offer-catalog.ts';",
);
const rewrittenProductCatalog = productCatalogSource.replace(
  'import generatedOffers from "@/data/generated-product-offers.json";',
  "import generatedOffers from '../data/generated-product-offers.json' with { type: 'json' };",
);

await fs.writeFile(
  path.join(tempLibDir, "nutrition-advisor.ts"),
  rewrittenNutritionAdvisor,
);
await fs.writeFile(
  path.join(tempLibDir, "product-offer-catalog.ts"),
  rewrittenProductCatalog,
);
await fs.copyFile(
  path.join(rootDir, "data/generated-product-offers.json"),
  path.join(tempDataDir, "generated-product-offers.json"),
);

const { buildEffortAdvisorResult } = await import(
  path.join(tempLibDir, "nutrition-advisor.ts")
);

const scenarios = [
  {
    label: "Marathon realistic",
    input: {
      durationMinutes: 225,
      targetCarbsPerHour: 75,
      context: "race",
      sport: "running",
      intensity: "race-pace",
      heat: "mild",
      aidStations: "regular",
      gutTrainingStatus: "standard",
      preferredTypes: ["Gel", "Boisson"],
    },
    assert(result) {
      const firstPlan = result.plans[0];
      if (!firstPlan || firstPlan.totalCarbs < 240 || firstPlan.totalCarbs > 320) {
        throw new Error("plan principal hors zone réaliste pour marathon");
      }
    },
  },
  {
    label: "Long ride high carb",
    input: {
      durationMinutes: 300,
      targetCarbsPerHour: 90,
      context: "race",
      sport: "cycling",
      intensity: "race-pace",
      heat: "cool",
      aidStations: "regular",
      gutTrainingStatus: "gut-trained",
      preferredTypes: ["Boisson", "Gel"],
    },
    assert(result) {
      if ((result.recommendedCarbsPerHourRange?.max ?? 0) < 90) {
        throw new Error("le plafond devrait accepter 90 g/h à vélo gut-trained");
      }
      const lateStep = result.executionPlan.find(
        (step) =>
          step.minute >= 180 &&
          step.action !== "Rythme stable, pas de prise supplémentaire sur ce créneau.",
      );
      if (!lateStep) {
        throw new Error("le plan d'exécution ne devrait pas vider toutes les prises au début");
      }
    },
  },
  {
    label: "Trail self-supported",
    input: {
      durationMinutes: 360,
      targetCarbsPerHour: 80,
      context: "race",
      sport: "trail",
      intensity: "steady",
      heat: "hot",
      aidStations: "self-supported",
      gutTrainingStatus: "standard",
      preferredTypes: ["Gel", "Boisson"],
    },
    assert(result) {
      if (result.warnings.length === 0) {
        throw new Error("un trail chaud en autonomie devrait produire des warnings");
      }
    },
  },
  {
    label: "Short training conservative",
    input: {
      durationMinutes: 70,
      targetCarbsPerHour: 60,
      context: "training",
      sport: "running",
      intensity: "easy",
      heat: "mild",
      aidStations: "regular",
      gutTrainingStatus: "standard",
      preferredTypes: ["Gel", "Boisson"],
    },
    assert(result) {
      if (result.targetCarbsPerHour > 30) {
        throw new Error("effort court: la cible aurait dû être plafonnée plus bas");
      }
    },
  },
];

let failures = 0;

for (const scenario of scenarios) {
  const result = buildEffortAdvisorResult(scenario.input);
  try {
    scenario.assert(result);
    console.log(`OK  ${scenario.label}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${scenario.label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await fs.rm(tempDir, { recursive: true, force: true });

if (failures > 0) {
  process.exitCode = 1;
}
