function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return values.length ? sum / values.length : null;
}

function sampleStd(values) {
  if (values.length < 2) return null;
  const center = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - center) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

function fineWasRight(row, mae) {
  const up = row.thresholds?.buy;
  const down = row.thresholds?.wait;
  if (up == null && down == null) return Math.abs(row.actual) <= mae;
  const below = up == null ? Math.abs(row.actual) <= mae : row.actual < up;
  const above = down == null ? Math.abs(row.actual) <= mae : row.actual > -down;
  return below && above;
}

export function scorePredictions(rows) {
  const n = rows.length;
  if (n === 0) {
    return {
      sampleCount: 0,
      mae: null,
      rmse: null,
      residualStd: null,
      directionalAccuracy: null,
      strongBuyAccuracy: null,
      strongBuyCount: 0,
      strongWaitAccuracy: null,
      strongWaitCount: 0,
      fineAccuracy: null,
      fineCount: 0,
      fineBand: null
    };
  }
  const errors = rows.map((row) => row.actual - row.pred);
  const abs = errors.map((error) => Math.abs(error));
  const mae = mean(abs);
  const rmse = Math.sqrt(mean(errors.map((error) => error ** 2)));
  const directionalRows = rows.filter((row) => row.actual !== 0);
  const directionalHits = directionalRows.filter((row) => Math.sign(row.pred) === Math.sign(row.actual));
  const buyRows = rows.filter((row) => row.signal === "BUY");
  const waitRows = rows.filter((row) => row.signal === "WAIT");
  const fineRows = rows.filter((row) => row.signal === "FINE");
  const buyHits = buyRows.filter((row) => row.actual > 0);
  const waitHits = waitRows.filter((row) => row.actual < 0);
  const fineHits = fineRows.filter((row) => fineWasRight(row, mae));
  return {
    sampleCount: n,
    mae,
    rmse,
    residualStd: sampleStd(errors),
    directionalAccuracy: directionalRows.length ? directionalHits.length / directionalRows.length : null,
    strongBuyAccuracy: buyRows.length ? buyHits.length / buyRows.length : null,
    strongBuyCount: buyRows.length,
    strongWaitAccuracy: waitRows.length ? waitHits.length / waitRows.length : null,
    strongWaitCount: waitRows.length,
    fineAccuracy: fineRows.length ? fineHits.length / fineRows.length : null,
    fineCount: fineRows.length,
    fineBand: mae
  };
}
