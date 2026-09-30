import { signalFor } from "./signal.js";

export const MIN_STATION_CHANGES = 26;

function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function daysBetween(earlier, later) {
  const a = Date.parse(`${earlier}T00:00:00Z`);
  const b = Date.parse(`${later}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function nearestRetail(recentRetail, date) {
  let best = null;
  for (const point of recentRetail) {
    const days = Math.abs(daysBetween(point.date, date));
    if (days <= 3 && (!best || days < best.days)) best = { ...point, days };
  }
  return best;
}

export function pairStationMarks(marks, recentRetail) {
  const paired = [];
  const sorted = [...marks].filter((mark) => Number.isFinite(mark.dollars) && mark.date).sort((a, b) => a.date.localeCompare(b.date));
  for (const mark of sorted) {
    const market = nearestRetail(recentRetail, mark.date);
    if (!market) continue;
    paired.push({ date: mark.date, station: mark.dollars, market: market.dollars });
  }
  return paired;
}

export function stationChangePairs(marks, recentRetail) {
  const paired = pairStationMarks(marks, recentRetail);
  const changes = [];
  for (let i = 1; i < paired.length; i += 1) {
    const gap = daysBetween(paired[i - 1].date, paired[i].date);
    if (gap < 5 || gap > 16) continue;
    changes.push({
      marketCents: (paired[i].market - paired[i - 1].market) * 100,
      stationCents: (paired[i].station - paired[i - 1].station) * 100
    });
  }
  return changes;
}

function fitLine(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den < 1e-8 ? 1 : num / den;
  return { intercept: my - slope * mx, slope };
}

export function calibrateForecast(marketCents, thresholds, marks, recentRetail, options = {}) {
  const marketSignal = signalFor(marketCents, thresholds);
  if (options.source !== "central") {
    return {
      applied: false,
      reason: "central_station_history_required",
      pairs: 0,
      required: MIN_STATION_CHANGES,
      cents: marketCents,
      signal: marketSignal
    };
  }
  const changes = stationChangePairs(marks || [], recentRetail || []);
  if (changes.length < MIN_STATION_CHANGES) {
    return {
      applied: false,
      reason: "insufficient_station_history",
      pairs: changes.length,
      required: MIN_STATION_CHANGES,
      cents: marketCents,
      signal: marketSignal
    };
  }
  const fit = fitLine(changes.map((row) => row.marketCents), changes.map((row) => row.stationCents));
  if (!Number.isFinite(fit.slope) || fit.slope < 0 || fit.slope > 3) {
    return {
      applied: false,
      reason: "unstable_station_fit",
      pairs: changes.length,
      required: MIN_STATION_CHANGES,
      cents: marketCents,
      signal: marketSignal
    };
  }
  const cents = fit.intercept + fit.slope * marketCents;
  return {
    applied: true,
    reason: "station_overlay",
    pairs: changes.length,
    required: MIN_STATION_CHANGES,
    intercept: fit.intercept,
    slope: fit.slope,
    cents,
    signal: signalFor(cents, thresholds)
  };
}
