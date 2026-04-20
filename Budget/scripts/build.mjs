import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const publicFiles = ["index.html", "styles.css", "app.js"];
const requiredIds = [
  "budgetForm",
  "expenseForm",
  "filterForm",
  "goalForm",
  "scenarioForm",
  "checklistForm",
  "incomeTotal",
  "expenseTotal",
  "remainingTotal",
  "usageRate",
  "savingsRate",
  "unpaidTotal",
  "nextDue",
  "readinessScore",
  "expenseTable",
  "categoryGrid",
  "insightList",
  "timelineList",
  "goalList",
  "checklistList",
  "scenarioResult",
  "exportPreview"
];

const html = await readFile(join(root, "index.html"), "utf8");
const script = await readFile(join(root, "app.js"), "utf8");

for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) {
    throw new Error(`Missing required HTML id: ${id}`);
  }
}

new vm.Script(script, { filename: "app.js" });

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of publicFiles) {
  const content = await readFile(join(root, file), "utf8");
  await writeFile(join(dist, file), content);
}

console.log(`Built ${publicFiles.length} files into ${dist}`);
