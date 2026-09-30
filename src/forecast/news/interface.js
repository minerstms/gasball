/**
 * v1 has no news inputs.
 * A later module can return its own dated rows and be walk-forward tested
 * without joining those columns into the price model until a separate comparison is approved.
 * Rows must carry their own observation date. Callers drop anything after the forecast origin.
 */
export function loadNewsFeatures() {
  return [];
}

export function newsFeaturesAsOf(newsRows, asOf) {
  if (!Array.isArray(newsRows) || !asOf) return [];
  return newsRows.filter((row) => row && row.date && row.date <= asOf);
}
