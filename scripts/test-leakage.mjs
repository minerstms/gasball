import assert from "node:assert/strict";
import { FEATURE_NAMES, featuresAt, attachNews } from "../src/forecast/features.js";
import { fitStandardizedOls, predictLinear } from "../src/forecast/ols.js";
import { walkForward, buildFeatureColumn, MIN_TRAIN } from "../src/forecast/backtest.js";
import { thresholdsFromHistory } from "../src/forecast/thresholds.js";
import { newsFeaturesAsOf } from "../src/forecast/news/interface.js";
import { confidenceLabelFor, calibrationRows } from "../src/forecast/decisions.js";
import { calibrateForecast, MIN_STATION_CHANGES } from "../public/lib/calibration.js";
import { nearestStation } from "../public/lib/geo.js";
import { signalFor } from "../public/lib/signal.js";
import { recordPrediction, matureOutcomes, frozenCoefficientsUnchanged } from "../src/forecast/learning.js";
import stationsDoc from "../public/stations.json" with { type: "json" };

function iso(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function makeRows(count, retailFn) {
  const rows = [];
  let stocks = 8000;
  for (let i = 0; i < count; i += 1) {
    const date = iso(2010, 1, 4 + i * 7);
    stocks += i % 5 === 0 ? -20 : 8;
    rows.push({
      date,
      retail_co: retailFn(i),
      retail_den: retailFn(i) + 0.05,
      gulf_spot: 1.5 + (i % 9) * 0.01,
      wti: 70 + (i % 6) * 0.4,
      brent: 75 + i,
      padd4_stocks: stocks
    });
  }
  return rows;
}

function sameFeatures(left, right) {
  assert.equal(left.length, right.length);
  for (let i = 0; i < left.length; i += 1) assert.ok(Math.abs(left[i] - right[i]) < 1e-9);
}

const recovered = fitStandardizedOls([
  { x: [0, 1], y: 1 },
  { x: [1, 1], y: 3 },
  { x: [2, 1], y: 5 },
  { x: [3, 1], y: 7 },
  { x: [4, 1], y: 9 }
]);
for (const [x, y] of [[[0, 1], 1], [[2, 1], 5], [[4, 1], 9]]) {
  assert.ok(Math.abs(predictLinear(recovered, x) - y) < 1e-6);
}

const base = makeRows(40, (i) => 2 + i * 0.01);
const origin = 30;
const before = featuresAt(base, origin, "retail_co");
base[origin + 1].retail_co = 99;
base[origin + 2].wti = 400;
base[origin + 3].gulf_spot = 9;
base[origin + 4].brent = -50;
const after = featuresAt(base, origin, "retail_co");
sameFeatures(before, after);
assert.equal(before.length, FEATURE_NAMES.length);

const brentUntouched = featuresAt(base, origin, "retail_co");
base[origin].brent = 9999;
sameFeatures(brentUntouched, featuresAt(base, origin, "retail_co"));

const futureNews = newsFeaturesAsOf([
  { date: base[origin].date, value: 1 },
  { date: base[origin + 2].date, value: 999 }
], base[origin].date);
assert.equal(futureNews.length, 1);
assert.equal(futureNews[0].value, 1);
assert.deepEqual(attachNews(base[origin].date, [{ date: base[origin + 1].date, value: 5 }]), []);

const walkRows = makeRows(MIN_TRAIN + 45, (i) => 2.2 + i * 0.004 + (i % 8) * 0.002);
const features = buildFeatureColumn(walkRows, "retail_co");
const result = walkForward(walkRows, features, "retail_co", 1);
assert.ok(result.headline.length > 0);
const mutated = structuredClone(walkRows);
for (const row of result.headline) {
  const index = mutated.findIndex((item) => item.date === row.date);
  mutated[index + 1].retail_co = 50;
  const nextFeatures = buildFeatureColumn(mutated, "retail_co");
  const again = walkForward(mutated, nextFeatures, "retail_co", 1);
  const matched = again.scored.find((item) => item.date === row.date);
  assert.ok(Math.abs(matched.pred - row.pred) < 1e-8);
  assert.ok(Math.abs(matched.preds.spotOnly - row.preds.spotOnly) < 1e-8);
  assert.ok(Math.abs(matched.preds.retailWholesale - row.preds.retailWholesale) < 1e-8);
  mutated[index + 1].retail_co = walkRows[index + 1].retail_co;
  break;
}

const past = [];
for (let i = 0; i < 20; i += 1) past.push({ pred: 6, actual: 4 });
for (let i = 0; i < 20; i += 1) past.push({ pred: -6, actual: -4 });
const open = thresholdsFromHistory(past);
assert.equal(open.buy != null, true);
const hidden = past.map((row) => ({ pred: row.pred, actual: row.pred > 0 ? -4 : 4 }));
const closed = thresholdsFromHistory(hidden);
assert.equal(closed.buy, null);
assert.equal(closed.wait, null);
assert.equal(signalFor(20, closed), "FINE");
assert.equal(signalFor(20, open), "BUY");

const marks = [];
const recent = [];
for (let i = 0; i < 40; i += 1) {
  const date = iso(2024, 1, 1 + i * 7);
  recent.push({ date, dollars: 3 + i * 0.02 });
  marks.push({ date, dollars: 3.2 + i * 0.01 });
}
assert.equal(signalFor(1, { buy: 5, wait: 5 }), "FINE");
assert.equal(signalFor(-1, { buy: 5, wait: 5 }), "FINE");
assert.equal(signalFor(5, { buy: 5, wait: 5 }), "BUY");
assert.equal(signalFor(-5, { buy: 5, wait: 5 }), "WAIT");

const deviceOverlay = calibrateForecast(10, { buy: 5, wait: 5 }, marks, recent);
assert.equal(deviceOverlay.applied, false);
assert.equal(deviceOverlay.cents, 10);
assert.equal(deviceOverlay.signal, "BUY");
const centralShort = calibrateForecast(10, { buy: 5, wait: 5 }, marks.slice(0, 4), recent, { source: "central" });
assert.equal(centralShort.applied, false);
const centralOverlay = calibrateForecast(10, { buy: 5, wait: 5 }, marks, recent, { source: "central" });
assert.equal(centralOverlay.applied, true);
assert.equal(centralOverlay.pairs >= MIN_STATION_CHANGES, true);

const priorMoves = Array.from({ length: 90 }, () => ({ pred: 8, actual: 6 }));
const priorLabel = confidenceLabelFor(8, calibrationRows(priorMoves));
const withLaterMoves = priorMoves.concat(Array.from({ length: 90 }, () => ({ pred: 8, actual: -20 })));
assert.equal(confidenceLabelFor(8, calibrationRows(priorMoves.slice(0, 80))), confidenceLabelFor(8, calibrationRows(withLaterMoves.slice(0, 80))));
assert.equal(priorLabel === "LOW" || priorLabel === "MODERATE" || priorLabel === "HIGH", true);

const denver = nearestStation(39.74, -104.99, stationsDoc.stations);
assert.equal(denver.station.marketId, "denver");
const trinidad = nearestStation(37.17, -104.5, stationsDoc.stations);
assert.equal(trinidad.station.id, "safeway-trinidad");

const coefficients = { beta: [1, 2, 3] };
let log = recordPrediction([], {
  marketId: "trinidad",
  asOf: "2024-01-01",
  modelVersion: "distributed-lag-v1",
  predicted7: 1.5,
  predicted14: 2.5,
  retailDollars: 3
});
log = recordPrediction(log, {
  marketId: "trinidad",
  asOf: "2024-01-01",
  modelVersion: "distributed-lag-v1",
  predicted7: 9,
  predicted14: 9,
  retailDollars: 3
});
assert.equal(log.length, 1);
const panel = [
  { date: "2024-01-01", retail_co: 3 },
  { date: "2024-01-08", retail_co: 3.05 },
  { date: "2024-01-15", retail_co: 3.11 }
];
const matured = matureOutcomes(log, panel, "retail_co");
assert.equal(matured[0].matured7, true);
assert.ok(Math.abs(matured[0].actual7 - 5) < 1e-9);
assert.equal(matured[0].matured14, true);
assert.equal(frozenCoefficientsUnchanged(coefficients, { beta: [1, 2, 3] }), true);
assert.equal(JSON.stringify(coefficients), JSON.stringify({ beta: [1, 2, 3] }));

import { readFile } from "node:fs/promises";

const historyPanel = JSON.parse(await readFile(new URL("../data/panel/weekly.json", import.meta.url), "utf8"));
const realIndex = 500;
const realBefore = featuresAt(historyPanel.rows, realIndex, "retail_co");
const realCopy = structuredClone(historyPanel.rows);
realCopy[realIndex + 1].retail_co = 12;
realCopy[realIndex + 1].gulf_spot = 9;
realCopy[realIndex + 2].wti = 250;
realCopy[realIndex + 3].padd4_stocks = 1;
sameFeatures(realBefore, featuresAt(realCopy, realIndex, "retail_co"));

console.log("leakage checks passed");
