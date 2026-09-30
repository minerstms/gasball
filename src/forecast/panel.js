export const ASOF_LIMIT_DAYS = 14;

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

export function parseEiaDate(value) {
  const match = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(String(value ?? "").trim());
  if (!match || MONTHS[match[1]] == null) return null;
  const date = new Date(Date.UTC(Number(match[3]), MONTHS[match[1]], Number(match[2])));
  return date.toISOString().slice(0, 10);
}

export function normalizePoints(points) {
  const sorted = [...points]
    .filter((point) => point?.date && Number.isFinite(point.value))
    .sort((left, right) => left.date.localeCompare(right.date));
  const deduped = [];
  for (const point of sorted) {
    if (deduped.length && deduped[deduped.length - 1].date === point.date) deduped.pop();
    deduped.push({ date: point.date, value: point.value });
  }
  return deduped;
}

export function asofValue(points, isoDate, limitDays = ASOF_LIMIT_DAYS) {
  let lo = 0;
  let hi = points.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= isoDate) {
      found = points[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!found) return null;
  const gap = (Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${found.date}T00:00:00Z`)) / 86400000;
  if (gap > limitDays) return null;
  return found.value;
}

export function buildPanelRows(seriesList) {
  const loaded = seriesList.map((series) => ({
    ...series,
    points: normalizePoints(series.points || [])
  }));
  const calendar = new Set();
  for (const series of loaded) {
    if (series.align !== "exact" || series.modelInput === false) continue;
    for (const point of series.points) calendar.add(point.date);
  }
  const dates = [...calendar].sort();
  const exact = new Map(loaded.filter((series) => series.align === "exact").map((series) => [
    series.field,
    new Map(series.points.map((point) => [point.date, point.value]))
  ]));
  return dates.map((date) => {
    const row = { date };
    for (const series of loaded) {
      if (series.align === "exact") row[series.field] = exact.get(series.field).get(date) ?? null;
      else row[series.field] = asofValue(series.points, date);
    }
    return row;
  });
}
