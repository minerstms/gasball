export const CANDIDATE_BANDS = [3, 5, 7.5, 10, 15];
export const FILL_GALLONS = 15;

export const MAGNITUDE_BINS = [
  { id: "0-3", min: 0, max: 3 },
  { id: "3-5", min: 3, max: 5 },
  { id: "5-7.5", min: 5, max: 7.5 },
  { id: "7.5-10", min: 7.5, max: 10 },
  { id: "10-15", min: 10, max: 15 },
  { id: "15+", min: 15, max: Number.POSITIVE_INFINITY }
];

function mean(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function share(values, test) {
  if (!values.length) return null;
  return values.filter(test).length / values.length;
}

export function dollarsPerFill(cents) {
  return (cents / 100) * FILL_GALLONS;
}

function sideReport(rows, side) {
  const actuals = rows.map((row) => row.actual);
  const signedCents = rows.map((row) => (side === "BUY" ? row.actual : -row.actual));
  const falseRows = rows.filter((row) => (side === "BUY" ? row.actual <= 0 : row.actual >= 0));
  const correctRows = rows.filter((row) => (side === "BUY" ? row.actual > 0 : row.actual < 0));
  return {
    count: rows.length,
    percentActualDirection: side === "BUY" ? share(actuals, (value) => value > 0) : share(actuals, (value) => value < 0),
    percentActualAtLeastFiveCents: side === "BUY" ? share(actuals, (value) => value >= 5) : share(actuals, (value) => value <= -5),
    mae: mean(rows.map((row) => Math.abs(row.actual - row.pred))),
    meanActual: mean(actuals),
    medianActual: median(actuals),
    expectedSavingsDollarsPer15Gal: mean(signedCents.map(dollarsPerFill)),
    meanSavingsWhenCorrectDollarsPer15Gal: mean(correctRows.map((row) => dollarsPerFill(side === "BUY" ? row.actual : -row.actual))),
    meanMissedCostWhenWrongDollarsPer15Gal: mean(falseRows.map((row) => dollarsPerFill(Math.abs(row.actual))))
  };
}

export function evaluateBand(rows, band) {
  const buy = rows.filter((row) => row.pred >= band);
  const wait = rows.filter((row) => row.pred <= -band);
  const fine = rows.filter((row) => row.pred > -band && row.pred < band);
  const strongCount = buy.length + wait.length;
  const falseStrong = buy.filter((row) => row.actual <= 0).length + wait.filter((row) => row.actual >= 0).length;
  return {
    band,
    buy: sideReport(buy, "BUY"),
    wait: sideReport(wait, "WAIT"),
    fine: {
      count: fine.length,
      percentOfWeeks: rows.length ? fine.length / rows.length : null
    },
    falseStrongSignalRate: strongCount ? falseStrong / strongCount : null,
    strongShareOfWeeks: rows.length ? strongCount / rows.length : null
  };
}

function bandIsUseful(report) {
  const buy = report.buy;
  const wait = report.wait;
  if (report.fine.percentOfWeeks == null || report.fine.percentOfWeeks < 0.35) return false;
  if (buy.count < 40 || wait.count < 40) return false;
  if (!(buy.meanActual > 0) || !(wait.meanActual < 0)) return false;
  if (!(buy.meanActual - wait.meanActual >= 5)) return false;
  if (!(buy.percentActualAtLeastFiveCents >= 0.5) || !(wait.percentActualAtLeastFiveCents >= 0.5)) return false;
  if (!(buy.expectedSavingsDollarsPer15Gal > 0.5) || !(wait.expectedSavingsDollarsPer15Gal > 0.5)) return false;
  if (report.falseStrongSignalRate == null || report.falseStrongSignalRate > 0.45) return false;
  return true;
}

export function recommendFineBand(rows) {
  const reports = CANDIDATE_BANDS.map((band) => evaluateBand(rows, band));
  const chosen = reports.find(bandIsUseful);
  return {
    reports,
    recommendedBand: chosen ? chosen.band : null,
    rule: "Smallest symmetric FINE band among ±3, ±5, ±7.5, ±10, and ±15 cents where FINE is at least 35% of weeks, each side has at least 40 calls, at least half of those calls move 5 cents in the signaled direction, the mean BUY outcome is positive, the mean WAIT outcome is negative, those means differ by at least 5 cents, each side's expected 15-gallon result is above $0.50, and the false strong-signal rate is at most 45%. Direction accuracy is not the selection score."
  };
}

export function magnitudeBin(absCents) {
  return MAGNITUDE_BINS.find((bin) => absCents >= bin.min && absCents < bin.max) || MAGNITUDE_BINS[MAGNITUDE_BINS.length - 1];
}

function outcomeDistribution(actuals) {
  return {
    atOrBelowNeg10: share(actuals, (value) => value <= -10),
    neg10ToNeg5: share(actuals, (value) => value > -10 && value <= -5),
    neg5To0: share(actuals, (value) => value > -5 && value < 0),
    zero: share(actuals, (value) => value === 0),
    above0To5: share(actuals, (value) => value > 0 && value < 5),
    fiveTo10: share(actuals, (value) => value >= 5 && value < 10),
    atOrAbove10: share(actuals, (value) => value >= 10)
  };
}

export function assignConfidenceLabel(stats) {
  if (!stats || stats.count < 40) return "LOW";
  const signedMean = stats.direction === "up" ? stats.meanActual : -stats.meanActual;
  if (stats.directionHitRate >= 0.7 && stats.count >= 80 && signedMean >= 5) return "HIGH";
  if (stats.directionHitRate >= 0.6 && signedMean >= 3) return "MODERATE";
  return "LOW";
}

export function calibrationRows(rows) {
  const table = [];
  for (const bin of MAGNITUDE_BINS) {
    for (const direction of ["up", "down"]) {
      const group = rows.filter((row) => {
        if (!Number.isFinite(row.pred) || row.pred === 0) return false;
        if ((direction === "up") !== (row.pred > 0)) return false;
        return magnitudeBin(Math.abs(row.pred)).id === bin.id;
      });
      const actuals = group.map((row) => row.actual);
      const directionHits = group.filter((row) => (direction === "up" ? row.actual > 0 : row.actual < 0));
      const stats = {
        bin: bin.id,
        direction,
        count: group.length,
        directionHitRate: group.length ? directionHits.length / group.length : null,
        meanActual: mean(actuals),
        medianActual: median(actuals),
        outcomeDistribution: outcomeDistribution(actuals)
      };
      stats.label = assignConfidenceLabel(stats);
      table.push(stats);
    }
  }
  return table;
}

export function confidenceLabelFor(cents, table) {
  if (!Number.isFinite(cents) || cents === 0 || !Array.isArray(table)) return "LOW";
  const direction = cents > 0 ? "up" : "down";
  const bin = magnitudeBin(Math.abs(cents)).id;
  const match = table.find((row) => row.bin === bin && row.direction === direction);
  return match?.label || "LOW";
}
