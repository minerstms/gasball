import frozen from "../../data/model/frozen-model.json";
import stationsDoc from "../../public/stations.json";
import snapshot from "../../public/forecast-snapshot.json";
import { createLiveResolver } from "../../src/forecast/live.js";

const resolveLiveBundle = createLiveResolver({ frozen, stationsDoc, snapshot });

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? "public, max-age=300" : "no-store"
    }
  });
}

export async function onRequestGet(context) {
  const market = new URL(context.request.url).searchParams.get("market") || "trinidad";
  if (!stationsDoc.stations.some((station) => station.marketId === market)) {
    return json({ ok: false, error: "unknown_market" }, 400);
  }
  const bundle = await resolveLiveBundle({
    fetchImpl: (...args) => fetch(...args),
    cache: caches.default,
    now: new Date()
  });
  const body = bundle.markets[market];
  if (!body) return json({ ok: false, error: "forecast_unavailable" }, 503);
  return json(body, 200);
}
