import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { FEATURE_NAMES, featuresAt } from "../src/forecast/features.js";
import { buildMarketForecast } from "../src/forecast/predict.js";
import { createLiveResolver, fetchLivePanel } from "../src/forecast/live.js";
import panel from "../data/panel/weekly.json" with { type: "json" };
import frozen from "../data/model/frozen-model.json" with { type: "json" };
import stationsDoc from "../public/stations.json" with { type: "json" };
import snapshot from "../public/forecast-snapshot.json" with { type: "json" };

const FILES = {
  "EMM_EPMR_PTE_SCO_DPGw.xls": "data/raw/co_retail.xls",
  "EMM_EPMR_PTE_YDEN_DPGw.xls": "data/raw/EMM_EPMR_PTE_YDEN_DPGw.xls",
  "EER_EPMRU_PF4_RGC_DPGw.xls": "data/raw/gulf_spot.xls",
  "RWTCw.xls": "data/raw/wti.xls",
  "WGTSTP41w.xls": "data/raw/padd4_stocks.xls"
};

function countingFetch() {
  const state = { count: 0, fail: false };
  const fetchImpl = async (url) => {
    state.count += 1;
    if (state.fail) throw new Error("upstream failed");
    const name = path.basename(new URL(url).pathname);
    const file = FILES[name];
    if (!file) throw new Error(`unexpected url ${url}`);
    const bytes = await readFile(file);
    return new Response(bytes, { status: 200 });
  };
  return { state, fetchImpl };
}

function memoryCache() {
  const store = new Map();
  return {
    async match(request) {
      const body = store.get(request.url);
      if (!body) return undefined;
      return new Response(body, { headers: { "content-type": "application/json" } });
    },
    async put(request, response) {
      store.set(request.url, await response.text());
    }
  };
}

function lastFeature(rows, retailKey) {
  let origin = -1;
  let vector = null;
  for (let i = 0; i < rows.length; i += 1) {
    const features = featuresAt(rows, i, retailKey);
    if (features) {
      origin = i;
      vector = features;
    }
  }
  return { origin, vector, date: rows[origin]?.date };
}

const freshNow = new Date("2026-09-29T18:00:00Z");
const staleNow = new Date("2026-10-20T18:00:00Z");
const livePanel = await fetchLivePanel(countingFetch().fetchImpl);

for (const retailKey of ["retail_co", "retail_den"]) {
  const offline = lastFeature(panel.rows, retailKey);
  const live = lastFeature(livePanel.rows, retailKey);
  assert.equal(live.date, offline.date);
  assert.equal(live.vector.length, FEATURE_NAMES.length);
  for (let i = 0; i < offline.vector.length; i += 1) {
    assert.ok(Math.abs(live.vector[i] - offline.vector[i]) < 1e-9, `${retailKey} feature ${FEATURE_NAMES[i]}`);
  }
}

const { state, fetchImpl } = countingFetch();
const cache = memoryCache();
const resolve = createLiveResolver({ frozen, stationsDoc, snapshot });
const fresh = await resolve({ fetchImpl, cache, now: freshNow });
const trinidad = fresh.markets.trinidad;
const denver = fresh.markets.denver;
const offlineTrinidad = buildMarketForecast("trinidad", panel, frozen, stationsDoc);
const offlineDenver = buildMarketForecast("denver", panel, frozen, stationsDoc);

assert.equal(trinidad.modelVersion, frozen.modelVersion);
assert.equal(trinidad.modelVersion, "distributed-lag-v1");
assert.equal(trinidad.delta7d, offlineTrinidad.cents);
assert.equal(trinidad.cents, offlineTrinidad.cents);
assert.equal(trinidad.signal, offlineTrinidad.signal);
assert.equal(denver.delta7d, offlineDenver.cents);
assert.equal(trinidad.sourceStatus, "live");
assert.equal(trinidad.actionable, true);
assert.equal(trinidad.calibration.applied, false);
assert.equal(trinidad.market, "trinidad");
assert.equal(trinidad.confidenceLabel, offlineTrinidad.confidence);
assert.equal(stationsDoc.defaultStationId, "safeway-trinidad");
assert.equal(state.count, 5);

const cached = await resolve({ fetchImpl, cache, now: new Date(freshNow.getTime() + 60 * 60 * 1000) });
assert.equal(state.count, 5);
assert.equal(cached.markets.trinidad.delta7d, trinidad.delta7d);

state.fail = true;
const afterFailure = await resolve({
  fetchImpl,
  cache,
  now: new Date(freshNow.getTime() + 9 * 60 * 60 * 1000)
});
assert.equal(afterFailure.markets.trinidad.delta7d, trinidad.delta7d);
assert.equal(afterFailure.markets.trinidad.inputSource, "live");

const empty = createLiveResolver({ frozen, stationsDoc, snapshot });
const failed = await empty({
  fetchImpl: async () => {
    throw new Error("upstream failed");
  },
  cache: memoryCache(),
  now: freshNow
});
assert.equal(failed.markets.trinidad.sourceStatus, "snapshot");
assert.equal(failed.markets.trinidad.inputSource, "snapshot");
assert.equal(failed.markets.trinidad.signal, snapshot.markets.trinidad.signal);
assert.equal(failed.markets.trinidad.delta7d, snapshot.markets.trinidad.cents ?? snapshot.markets.trinidad.delta7d);

const stale = await resolve({ fetchImpl, cache: memoryCache(), now: staleNow });
assert.equal(stale.markets.trinidad.sourceStatus, "stale");
assert.equal(stale.markets.trinidad.actionable, false);
assert.equal(stale.markets.trinidad.delta7d, offlineTrinidad.cents);
assert.equal(["BUY", "FINE", "WAIT"].includes(stale.markets.trinidad.signal), true);
assert.equal(stale.markets.trinidad.dataAsOf, offlineTrinidad.asOf);

console.log("live forecast checks passed");
