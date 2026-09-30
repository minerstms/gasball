const GRID = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15];
const MIN_SIDE = 12;
const MIN_PRECISION = 0.55;

function mean(values) {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function chooseSide(past, side) {
  let best = null;
  for (const threshold of GRID) {
    const subset = past.filter((row) => (side === "buy" ? row.pred >= threshold : row.pred <= -threshold));
    if (subset.length < MIN_SIDE) continue;
    const hits = subset.filter((row) => (side === "buy" ? row.actual > 0 : row.actual < 0));
    const accuracy = hits.length / subset.length;
    if (accuracy < MIN_PRECISION) continue;
    const utility = (accuracy - 0.5) * Math.sqrt(subset.length);
    if (!best || utility > best.utility) {
      best = { threshold, accuracy, count: subset.length, utility };
    }
  }
  return best;
}

export function thresholdsFromHistory(past) {
  const buy = chooseSide(past, "buy");
  const wait = chooseSide(past, "wait");
  return {
    buy: buy ? buy.threshold : null,
    wait: wait ? wait.threshold : null,
    buyAccuracy: buy ? buy.accuracy : null,
    waitAccuracy: wait ? wait.accuracy : null,
    buyCount: buy ? buy.count : 0,
    waitCount: wait ? wait.count : 0,
    source: buy || wait ? "historical-performance" : "no-reliable-strong-signal",
    historyCount: past.length
  };
}
