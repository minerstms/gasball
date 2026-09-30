import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { matureOutcomes, frozenCoefficientsUnchanged } from "../src/forecast/learning.js";

const root = process.cwd();
const logPath = path.join(root, "data", "observations", "market-log.json");
const panel = JSON.parse(await readFile(path.join(root, "data", "panel", "weekly.json"), "utf8"));
const frozen = JSON.parse(await readFile(path.join(root, "data", "model", "frozen-model.json"), "utf8"));
const before = structuredClone(frozen.markets);
const log = JSON.parse(await readFile(logPath, "utf8"));
const matured = log.map((entry) => {
  const stationKey = entry.forecastMarket === "denver" ? "retail_den" : "retail_co";
  return matureOutcomes([entry], panel.rows, stationKey)[0];
});
await writeFile(logPath, `${JSON.stringify(matured, null, 2)}\n`);
if (!frozenCoefficientsUnchanged(before, frozen.markets)) {
  throw new Error("matured outcomes must not change frozen coefficients");
}
console.log(`matured ${matured.length} observation rows; model coefficients unchanged`);
