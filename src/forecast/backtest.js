import { featuresAt } from "./features.js";
import { fitStandardizedOls, predictLinear } from "./ols.js";
import { COMPARE_MODELS, projectFeatures } from "./models.js";

export const MIN_TRAIN = 208;

function trainingSamples(rows, features, retailKey, origin, steps) {
  const samples = [];
  const lastTrain = origin - steps;
  for (let i = 0; i <= lastTrain; i += 1) {
    if (!features[i]) continue;
    const retailNow = rows[i][retailKey];
    const retailLater = rows[i + steps][retailKey];
    if (!Number.isFinite(retailNow) || !Number.isFinite(retailLater)) continue;
    if (i + steps > origin) throw new Error("training target crossed the origin");
    samples.push({
      x: features[i],
      y: (retailLater - retailNow) * 100
    });
  }
  return samples;
}

export function buildFeatureColumn(rows, retailKey) {
  return rows.map((_, index) => featuresAt(rows, index, retailKey));
}

export function fitProduction(rows, features, retailKey, steps) {
  let origin = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (features[i] && Number.isFinite(rows[i][retailKey])) origin = i;
  }
  if (origin < 0) throw new Error("no feature origin");
  const samples = trainingSamples(rows, features, retailKey, origin, steps);
  if (samples.length < MIN_TRAIN) throw new Error("not enough matured rows to freeze a model");
  const model = fitStandardizedOls(samples);
  return {
    model,
    origin,
    asOf: rows[origin].date,
    retailDollars: rows[origin][retailKey],
    features: features[origin],
    trainCount: samples.length
  };
}

function predictSubset(samples, columns, x) {
  const fitted = fitStandardizedOls(samples.map((sample) => ({
    x: projectFeatures(sample.x, columns),
    y: sample.y
  })));
  return predictLinear(fitted, projectFeatures(x, columns));
}

export function walkForward(rows, features, retailKey, steps) {
  const scored = [];
  for (let origin = 0; origin < rows.length; origin += 1) {
    if (!features[origin] || !Number.isFinite(rows[origin][retailKey])) continue;
    if (origin + steps >= rows.length || !Number.isFinite(rows[origin + steps][retailKey])) continue;
    const samples = trainingSamples(rows, features, retailKey, origin, steps);
    if (samples.length < MIN_TRAIN) continue;
    const preds = { zero: 0, persistence: features[origin][0] };
    for (const spec of COMPARE_MODELS) {
      preds[spec.id] = predictSubset(samples, spec.columns, features[origin]);
    }
    const actual = (rows[origin + steps][retailKey] - rows[origin][retailKey]) * 100;
    scored.push({
      date: rows[origin].date,
      pred: preds.distributedLag,
      actual,
      persistence: preds.persistence,
      zero: 0,
      preds
    });
  }
  return {
    scored,
    headline: scored
  };
}
