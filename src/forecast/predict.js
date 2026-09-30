import { FEATURE_NAMES, featuresAt } from "./features.js";
import { predictLinear } from "./ols.js";
import { signalFor } from "../../public/lib/signal.js";
import { confidenceLabelFor } from "./decisions.js";

function lastFeatureIndex(rows, features) {
  let origin = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (features[i]) origin = i;
  }
  return origin;
}

function featureColumn(rows, retailKey) {
  return rows.map((_, index) => featuresAt(rows, index, retailKey));
}

function recentRetail(rows, retailKey, origin) {
  const points = [];
  for (let i = Math.max(0, origin - 119); i <= origin; i += 1) {
    if (Number.isFinite(rows[i][retailKey])) {
      points.push({ date: rows[i].date, dollars: rows[i][retailKey] });
    }
  }
  return points;
}

function horizonPayload(block, x) {
  const cents = predictLinear(block.model, x);
  const signal = signalFor(cents, block.thresholds);
  const confidence = block.confidenceTable ? confidenceLabelFor(cents, block.confidenceTable) : null;
  return {
    cents,
    signal,
    confidence,
    thresholds: block.thresholds
  };
}

export function buildMarketForecast(marketId, panel, frozen, stationsDoc) {
  const station = stationsDoc.stations.find((item) => item.marketId === marketId);
  if (!station) {
    const error = new Error("unknown_market");
    error.status = 400;
    throw error;
  }
  const market = frozen.markets[station.forecastMarket];
  if (!market) {
    const error = new Error("missing_frozen_market");
    error.status = 503;
    throw error;
  }
  if (market.h7.model.beta.length !== FEATURE_NAMES.length || market.featureNames.join("|") !== FEATURE_NAMES.join("|")) {
    const error = new Error("feature_mismatch");
    error.status = 503;
    throw error;
  }
  const retailKey = station.forecastMarket === "denver" ? "retail_den" : "retail_co";
  const features = featureColumn(panel.rows, retailKey);
  const origin = lastFeatureIndex(panel.rows, features);
  if (origin < 0) {
    const error = new Error("no_features");
    error.status = 503;
    throw error;
  }
  const x = features[origin];
  const seven = horizonPayload(market.h7, x);
  const fourteen = horizonPayload(market.h14, x);
  return {
    ok: true,
    decisionVersion: 2,
    marketId: station.marketId,
    marketName: station.marketName,
    forecastMarket: station.forecastMarket,
    seriesId: market.seriesId,
    modelVersion: frozen.modelVersion,
    asOf: panel.rows[origin].date,
    horizonDays: 7,
    cents: seven.cents,
    signal: seven.signal,
    confidence: seven.confidence,
    retailDollars: panel.rows[origin][retailKey],
    thresholds: seven.thresholds,
    horizon14: {
      cents: fourteen.cents,
      signal: fourteen.signal,
      confidence: null,
      horizonDays: 14
    },
    recentRetail: recentRetail(panel.rows, retailKey, origin),
    calibration: {
      applied: false,
      reason: "central_station_history_required"
    }
  };
}

export function buildAllForecasts(panel, frozen, stationsDoc) {
  const markets = {};
  for (const station of stationsDoc.stations) {
    markets[station.marketId] = buildMarketForecast(station.marketId, panel, frozen, stationsDoc);
  }
  return {
    modelVersion: frozen.modelVersion,
    markets
  };
}
