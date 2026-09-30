import { pointsFromWorkbook } from "./eia-workbook.js";
import { buildPanelRows } from "./panel.js";
import { buildMarketForecast } from "./predict.js";
import { bundleIsFresh, presentForecast } from "./freshness.js";

export const LIVE_SERIES = [
  {
    field: "retail_co",
    id: "EMM_EPMR_PTE_SCO_DPG",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_SCO_DPGw.xls",
    align: "exact"
  },
  {
    field: "retail_den",
    id: "EMM_EPMR_PTE_YDEN_DPG",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_YDEN_DPGw.xls",
    align: "exact"
  },
  {
    field: "gulf_spot",
    id: "EER_EPMRU_PF4_RGC_DPG",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EER_EPMRU_PF4_RGC_DPGw.xls",
    align: "asof"
  },
  {
    field: "wti",
    id: "RWTC",
    url: "https://www.eia.gov/dnav/pet/hist_xls/RWTCw.xls",
    align: "asof"
  },
  {
    field: "padd4_stocks",
    id: "WGTSTP41",
    url: "https://www.eia.gov/dnav/pet/hist_xls/WGTSTP41w.xls",
    align: "asof"
  }
];

const CACHE_REQUEST = new Request("https://gasball.internal/live-forecast");

export async function fetchLivePanel(fetchImpl) {
  const series = await Promise.all(LIVE_SERIES.map(async (spec) => {
    const response = await fetchImpl(spec.url, {
      headers: { "user-agent": "GasBall/1.0" }
    });
    if (!response?.ok) throw new Error(`eia fetch failed for ${spec.id}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { ...spec, points: pointsFromWorkbook(bytes) };
  }));
  return { rows: buildPanelRows(series) };
}

export function forecastBundleFromPanel(panel, frozen, stationsDoc, now, inputSource) {
  const generatedAt = now.toISOString();
  const markets = {};
  for (const station of stationsDoc.stations) {
    const base = buildMarketForecast(station.marketId, panel, frozen, stationsDoc);
    markets[station.marketId] = presentForecast(base, { generatedAt, inputSource, now });
  }
  return { generatedAt, inputSource, markets };
}

function retouch(bundle, now) {
  const markets = {};
  for (const [marketId, forecast] of Object.entries(bundle.markets)) {
    markets[marketId] = presentForecast(forecast, {
      generatedAt: bundle.generatedAt,
      inputSource: forecast.inputSource || bundle.inputSource || "live",
      now
    });
  }
  return { ...bundle, markets };
}

async function readCache(cache) {
  if (!cache?.match) return null;
  try {
    const hit = await cache.match(CACHE_REQUEST);
    if (!hit) return null;
    return await hit.json();
  } catch {
    return null;
  }
}

async function writeCache(cache, bundle) {
  if (!cache?.put) return;
  try {
    await cache.put(CACHE_REQUEST, new Response(JSON.stringify(bundle), {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=28800"
      }
    }));
  } catch {
    // The edge cache is optional. The in-isolate copy still limits refreshes.
  }
}

export function snapshotBundle(snapshot, now) {
  const generatedAt = snapshot.generatedAt || now.toISOString();
  const markets = {};
  for (const [marketId, forecast] of Object.entries(snapshot.markets || {})) {
    markets[marketId] = presentForecast(forecast, { generatedAt, inputSource: "snapshot", now });
  }
  return { generatedAt, inputSource: "snapshot", markets };
}

export function createLiveResolver({ frozen, stationsDoc, snapshot }) {
  let memory = null;
  return async function resolveLiveBundle({ fetchImpl, cache, now }) {
    if (bundleIsFresh(memory, now)) return retouch(memory, now);
    const cached = await readCache(cache);
    if (bundleIsFresh(cached, now)) {
      memory = cached;
      return retouch(cached, now);
    }
    try {
      const panel = await fetchLivePanel(fetchImpl);
      const bundle = forecastBundleFromPanel(panel, frozen, stationsDoc, now, "live");
      memory = bundle;
      await writeCache(cache, bundle);
      return bundle;
    } catch {
      if (memory?.markets) return retouch(memory, now);
      if (cached?.markets) return retouch(cached, now);
      return snapshotBundle(snapshot, now);
    }
  };
}
