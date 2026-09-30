import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FEATURE_NAMES } from "../src/forecast/features.js";
import { buildFeatureColumn, fitProduction, walkForward } from "../src/forecast/backtest.js";
import { buildAllForecasts } from "../src/forecast/predict.js";
import { presentForecast } from "../src/forecast/freshness.js";
import { calibrationRows, evaluateBand, recommendFineBand } from "../src/forecast/decisions.js";
import { scorePredictions } from "../src/forecast/metrics.js";

const ROOT = process.cwd();
const MODEL_KEYS = ["distributedLag", "spotOnly", "retailWholesale", "persistence", "zero"];

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value ?? null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function roundDeep(value) {
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)]));
  }
  if (typeof value === "number") return round(value, 4);
  return value;
}

function serializeModel(fitted) {
  return {
    kind: fitted.model.kind,
    intercept: fitted.model.intercept,
    beta: fitted.model.beta,
    mean: fitted.model.mean,
    scale: fitted.model.scale,
    active: fitted.model.active,
    ridge: fitted.model.ridge,
    trainCount: fitted.trainCount,
    trainOrigin: fitted.asOf,
    featureNames: FEATURE_NAMES
  };
}

function correlation(pairs) {
  if (pairs.length < 3) return null;
  const leftMean = pairs.reduce((sum, pair) => sum + pair.left, 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair.right, 0) / pairs.length;
  let num = 0;
  let leftSq = 0;
  let rightSq = 0;
  let abs = 0;
  for (const pair of pairs) {
    num += (pair.left - leftMean) * (pair.right - rightMean);
    leftSq += (pair.left - leftMean) ** 2;
    rightSq += (pair.right - rightMean) ** 2;
    abs += Math.abs(pair.left - pair.right);
  }
  return {
    weeks: pairs.length,
    correlation: num / Math.sqrt(leftSq * rightSq),
    maeCents: abs / pairs.length
  };
}

function weeklyChangePairs(rows, leftKey, rightKey) {
  const pairs = [];
  for (let index = 1; index < rows.length; index += 1) {
    const leftNow = rows[index][leftKey];
    const leftPrev = rows[index - 1][leftKey];
    const rightNow = rows[index][rightKey];
    const rightPrev = rows[index - 1][rightKey];
    if (![leftNow, leftPrev, rightNow, rightPrev].every(Number.isFinite)) continue;
    pairs.push({
      left: (leftNow - leftPrev) * 100,
      right: (rightNow - rightPrev) * 100
    });
  }
  return pairs;
}

function modelComparison(rows) {
  const comparison = {};
  for (const key of MODEL_KEYS) {
    const series = rows.map((row) => ({ pred: row.preds[key], actual: row.actual }));
    const scored = scorePredictions(series.map((row) => ({ ...row, signal: "FINE" })));
    comparison[key] = {
      sampleCount: scored.sampleCount,
      maeCents: round(scored.mae, 3),
      rmseCents: round(scored.rmse, 3),
      directionalAccuracy: round(scored.directionalAccuracy, 4),
      band5: roundDeep(evaluateBand(series, 5)),
      band10: roundDeep(evaluateBand(series, 10))
    };
  }
  return comparison;
}

const SPECS = [
  {
    key: "colorado",
    retailKey: "retail_co",
    seriesId: "EMM_EPMR_PTE_SCO_DPG",
    serves: ["trinidad", "pueblo", "colorado-springs"]
  },
  {
    key: "denver",
    retailKey: "retail_den",
    seriesId: "EMM_EPMR_PTE_YDEN_DPG",
    serves: ["denver"]
  }
];

async function main() {
  const panel = JSON.parse(await readFile(path.join(ROOT, "data", "panel", "weekly.json"), "utf8"));
  const stationsDoc = JSON.parse(await readFile(path.join(ROOT, "public", "stations.json"), "utf8"));
  const markets = {};
  const results = {
    modelVersion: "distributed-lag-v1",
    protocol: {
      evaluation: "chronological walk-forward",
      trainingRule: "At origin t, training targets end on or before t. Features at a row use prices on or before that row. Compared models share those origins.",
      thresholdRule: "7-day BUY/WAIT uses a fixed symmetric FINE band. The band is the smallest candidate in {3, 5, 7.5, 10, 15} cents that shows economic separation. It is not chosen by direction accuracy.",
      confidenceBefore: "The previous UI percent was the walk-forward direction hit rate of the whole WAIT or BUY group under the old adaptive cutoff near ±1 cent. A WAIT display of 83% meant 83.17% of those Colorado WAIT calls had a negative actual 7-day change. It was not a probability for that forecast's magnitude.",
      confidenceAfter: "Confidence is LOW, MODERATE, or HIGH from magnitude bins of strictly earlier out-of-sample forecasts. A bin needs at least 40 calls. MODERATE also needs direction hit rate of at least 60% and a mean outcome of at least 3 cents in the predicted direction. HIGH needs at least 80 calls, a 70% direction hit rate, and a mean outcome of at least 5 cents in the predicted direction. The UI does not show a percent.",
      production: "Distributed-lag coefficients stay frozen between approved retrains. This script does not update them from live errors."
    },
    denverGrade: null,
    markets: {}
  };

  const last = panel.rows[panel.rows.length - 1];
  results.denverGrade = {
    productionSeries: "EMM_EPMR_PTE_YDEN_DPG",
    productionGrade: "Denver regular all formulations",
    allGradesSeries: "EMM_EPM0_PTE_YDEN_DPG",
    latestRegularDollars: last.retail_den,
    latestAllGradesDollars: last.retail_den_allgrades,
    latestColoradoRegularDollars: last.retail_co,
    regularVersusAllGradesChanges: correlation(weeklyChangePairs(panel.rows, "retail_den", "retail_den_allgrades")),
    denverRegularVersusColoradoRegularChanges: correlation(weeklyChangePairs(panel.rows, "retail_den", "retail_co")),
    decision: "Denver forecasts use the Denver regular all-formulations series. All-grades prices are not the target."
  };

  for (const spec of SPECS) {
    console.log(`backtest ${spec.key}`);
    const features = buildFeatureColumn(panel.rows, spec.retailKey);
    const h7 = walkForward(panel.rows, features, spec.retailKey, 1);
    const h14 = walkForward(panel.rows, features, spec.retailKey, 2);
    const prod7 = fitProduction(panel.rows, features, spec.retailKey, 1);
    const prod14 = fitProduction(panel.rows, features, spec.retailKey, 2);
    const decision = recommendFineBand(h7.scored);
    const band = decision.recommendedBand ?? 15;
    const table = calibrationRows(h7.scored);
    markets[spec.key] = {
      seriesId: spec.seriesId,
      serves: spec.serves,
      featureNames: FEATURE_NAMES,
      h7: {
        model: serializeModel(prod7),
        thresholds: { buy: band, wait: band },
        fineBandCents: band,
        confidenceTable: table,
        confidenceMethod: "magnitude-bin-label"
      },
      h14: {
        model: serializeModel(prod14),
        thresholds: { buy: band, wait: band },
        fineBandCents: band,
        confidenceTable: null,
        confidenceMethod: "not-shown"
      }
    };
    results.markets[spec.key] = {
      seriesId: spec.seriesId,
      serves: spec.serves,
      asOf: prod7.asOf,
      retailDollars: prod7.retailDollars,
      fineBandCents: band,
      fineBandFellBackTo15: decision.recommendedBand == null,
      thresholdRule: decision.rule,
      thresholdComparison: roundDeep(decision.reports),
      confidenceBins: roundDeep(table),
      modelComparison: modelComparison(h7.scored),
      h14DistributedLag: {
        sampleCount: h14.scored.length,
        maeCents: round(scorePredictions(h14.scored.map((row) => ({ pred: row.pred, actual: row.actual, signal: "FINE" }))).mae, 3)
      }
    };
    console.log(spec.key, "recommended band", band);
    for (const report of decision.reports) {
      console.log(
        spec.key,
        `±${report.band}`,
        "FINE",
        report.fine.count,
        "BUY",
        report.buy.count,
        "WAIT",
        report.wait.count,
        "false",
        report.falseStrongSignalRate
      );
    }
  }

  const frozen = {
    modelVersion: "distributed-lag-v1",
    frozenAt: new Date().toISOString(),
    policy: "frozen-between-approved-retrains",
    featureNames: FEATURE_NAMES,
    markets
  };
  await mkdir(path.join(ROOT, "data", "model"), { recursive: true });
  await mkdir(path.join(ROOT, "data", "backtest"), { recursive: true });
  await mkdir(path.join(ROOT, "data", "observations"), { recursive: true });
  await writeFile(path.join(ROOT, "data", "model", "frozen-model.json"), JSON.stringify(frozen));
  await writeFile(path.join(ROOT, "data", "backtest", "results.json"), JSON.stringify(results, null, 2));
  const built = buildAllForecasts(panel, frozen, stationsDoc);
  const stampedAt = new Date();
  const snapshot = {
    generatedAt: built.generatedAt,
    markets: Object.fromEntries(Object.entries(built.markets).map(([marketId, forecast]) => [
      marketId,
      presentForecast(forecast, { generatedAt: built.generatedAt, inputSource: "snapshot", now: stampedAt })
    ]))
  };
  await writeFile(path.join(ROOT, "public", "forecast-snapshot.json"), JSON.stringify(snapshot));
  const logPath = path.join(ROOT, "data", "observations", "market-log.json");
  try {
    await readFile(logPath, "utf8");
  } catch {
    await writeFile(logPath, "[]\n");
  }
  console.log("wrote frozen model, backtest results, and forecast snapshot");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
