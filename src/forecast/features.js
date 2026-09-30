import { newsFeaturesAsOf } from "./news/interface.js";

export const FEATURE_NAMES = [
  "d_retail_0",
  "d_retail_1",
  "d_retail_2",
  "d_retail_3",
  "d_spot_0",
  "d_spot_1",
  "d_spot_2",
  "d_crude_0",
  "d_crude_1",
  "spread",
  "d_stocks_0",
  "sin_woy",
  "cos_woy"
];

const LAG_NEED = 4;

function cents(newer, older) {
  return (newer - older) * 100;
}

function finite(value) {
  return Number.isFinite(value);
}

export function weekAngle(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const current = Date.UTC(year, month - 1, day);
  const start = Date.UTC(year, 0, 1);
  const week = Math.floor((current - start) / (7 * 86400000));
  const angle = (2 * Math.PI * week) / 52;
  return [Math.sin(angle), Math.cos(angle)];
}

export function featuresAt(rows, index, retailKey) {
  if (index < LAG_NEED || index >= rows.length) return null;
  const current = rows[index];
  if (!current || !finite(current[retailKey]) || !finite(current.gulf_spot) || !finite(current.wti) || !finite(current.padd4_stocks)) {
    return null;
  }
  const retailDelta = [];
  const spotDelta = [];
  const crudeDelta = [];
  for (let lag = 0; lag <= 3; lag += 1) {
    const left = rows[index - lag];
    const right = rows[index - lag - 1];
    if (!left || !right) return null;
    if (!finite(left[retailKey]) || !finite(right[retailKey])) return null;
    if (!finite(left.gulf_spot) || !finite(right.gulf_spot)) return null;
    if (!finite(left.wti) || !finite(right.wti)) return null;
    retailDelta.push(cents(left[retailKey], right[retailKey]));
    if (lag <= 2) spotDelta.push(cents(left.gulf_spot, right.gulf_spot));
    if (lag <= 1) crudeDelta.push(left.wti - right.wti);
  }
  const stockLeft = rows[index].padd4_stocks;
  const stockRight = rows[index - 1].padd4_stocks;
  if (!finite(stockLeft) || !finite(stockRight) || stockRight === 0) return null;
  const [sinWoy, cosWoy] = weekAngle(current.date);
  return [
    retailDelta[0],
    retailDelta[1],
    retailDelta[2],
    retailDelta[3],
    spotDelta[0],
    spotDelta[1],
    spotDelta[2],
    crudeDelta[0],
    crudeDelta[1],
    cents(current[retailKey], current.gulf_spot),
    ((stockLeft - stockRight) / stockRight) * 100,
    sinWoy,
    cosWoy
  ];
}

export function attachNews(asOf, newsRows) {
  return newsFeaturesAsOf(newsRows, asOf);
}
