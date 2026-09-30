const WEEK_MS = 7 * 86400000;

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function retailOnOrAfter(rows, retailKey, isoDate) {
  for (const row of rows) {
    if (row.date >= isoDate && Number.isFinite(row[retailKey])) return row;
  }
  return null;
}

export function recordPrediction(log, observation) {
  const exists = log.some((row) => row.marketId === observation.marketId && row.asOf === observation.asOf && row.modelVersion === observation.modelVersion);
  if (exists) return log;
  return [
    ...log,
    {
      marketId: observation.marketId,
      asOf: observation.asOf,
      modelVersion: observation.modelVersion,
      predicted7: observation.predicted7,
      predicted14: observation.predicted14,
      retailDollars: observation.retailDollars,
      actual7: null,
      actual14: null,
      matured7: false,
      matured14: false
    }
  ];
}

export function matureOutcomes(log, rows, retailKey) {
  return log.map((entry) => {
    const next = { ...entry };
    const week7 = retailOnOrAfter(rows, retailKey, addDays(entry.asOf, 7));
    const week14 = retailOnOrAfter(rows, retailKey, addDays(entry.asOf, 14));
    if (!next.matured7 && week7 && Number.isFinite(entry.retailDollars)) {
      const gap = Date.parse(`${week7.date}T00:00:00Z`) - Date.parse(`${entry.asOf}T00:00:00Z`);
      if (gap >= WEEK_MS && gap <= 10 * 86400000) {
        next.actual7 = (week7[retailKey] - entry.retailDollars) * 100;
        next.matured7 = true;
        next.outcome7Date = week7.date;
      }
    }
    if (!next.matured14 && week14 && Number.isFinite(entry.retailDollars)) {
      const gap = Date.parse(`${week14.date}T00:00:00Z`) - Date.parse(`${entry.asOf}T00:00:00Z`);
      if (gap >= 14 * 86400000 && gap <= 18 * 86400000) {
        next.actual14 = (week14[retailKey] - entry.retailDollars) * 100;
        next.matured14 = true;
        next.outcome14Date = week14.date;
      }
    }
    return next;
  });
}

export function frozenCoefficientsUnchanged(before, after) {
  return JSON.stringify(before) === JSON.stringify(after);
}
