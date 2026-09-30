export const REFRESH_MS = 8 * 60 * 60 * 1000;
export const STALE_AFTER_DAYS = 10;

export function observationAgeDays(dataAsOf, now) {
  const asOf = Date.parse(`${String(dataAsOf ?? "").slice(0, 10)}T00:00:00Z`);
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(asOf)) return Number.POSITIVE_INFINITY;
  return Math.floor((day - asOf) / 86400000);
}

export function bundleIsFresh(bundle, now, refreshMs = REFRESH_MS) {
  if (!bundle?.generatedAt) return false;
  const generated = Date.parse(bundle.generatedAt);
  if (!Number.isFinite(generated)) return false;
  return now.getTime() - generated < refreshMs;
}

export function presentForecast(forecast, { generatedAt, inputSource, now }) {
  const dataAsOf = forecast.dataAsOf || forecast.asOf;
  const stale = observationAgeDays(dataAsOf, now) > STALE_AFTER_DAYS;
  return {
    ...forecast,
    ok: forecast.ok !== false,
    decisionVersion: forecast.decisionVersion || 2,
    market: forecast.market || forecast.marketId,
    delta7d: forecast.delta7d ?? forecast.cents,
    confidenceLabel: forecast.confidenceLabel || forecast.confidence,
    dataAsOf,
    generatedAt,
    inputSource,
    sourceStatus: stale ? "stale" : inputSource,
    actionable: !stale,
    calibration: forecast.calibration || {
      applied: false,
      reason: "central_station_history_required"
    }
  };
}
