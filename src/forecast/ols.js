export function invertMatrix(matrix) {
  const n = matrix.length;
  const a = matrix.map((row, i) => {
    const next = row.slice();
    for (let j = 0; j < n; j += 1) next.push(i === j ? 1 : 0);
    return next;
  });
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) {
      throw new Error("singular matrix");
    }
    const swap = a[col];
    a[col] = a[pivot];
    a[pivot] = swap;
    const divisor = a[col][col];
    for (let j = 0; j < n * 2; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = 0; j < n * 2; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

export function fitStandardizedOls(samples, ridge = 1e-8) {
  if (samples.length === 0) throw new Error("empty sample");
  const p = samples[0].x.length;
  const n = samples.length;
  const mean = Array(p).fill(0);
  for (const sample of samples) {
    for (let j = 0; j < p; j += 1) mean[j] += sample.x[j];
  }
  for (let j = 0; j < p; j += 1) mean[j] /= n;
  const scale = Array(p).fill(1);
  const active = Array(p).fill(false);
  for (let j = 0; j < p; j += 1) {
    let variance = 0;
    for (const sample of samples) variance += (sample.x[j] - mean[j]) ** 2;
    variance /= n;
    if (variance > 1e-10) {
      scale[j] = Math.sqrt(variance);
      active[j] = true;
    }
  }
  const width = p + 1;
  const xtx = Array.from({ length: width }, () => Array(width).fill(0));
  const xty = Array(width).fill(0);
  for (const sample of samples) {
    const z = [1];
    for (let j = 0; j < p; j += 1) z.push(active[j] ? (sample.x[j] - mean[j]) / scale[j] : 0);
    for (let a = 0; a < width; a += 1) {
      xty[a] += z[a] * sample.y;
      for (let b = 0; b < width; b += 1) xtx[a][b] += z[a] * z[b];
    }
  }
  for (let j = 1; j < width; j += 1) xtx[j][j] += ridge;
  const inverse = invertMatrix(xtx);
  const coef = Array(width).fill(0);
  for (let a = 0; a < width; a += 1) {
    for (let b = 0; b < width; b += 1) coef[a] += inverse[a][b] * xty[b];
  }
  return {
    kind: "distributed-lag-v1",
    intercept: coef[0],
    beta: coef.slice(1),
    mean,
    scale,
    active,
    ridge,
    trainCount: n
  };
}

export function predictLinear(model, x) {
  let value = model.intercept;
  for (let j = 0; j < x.length; j += 1) {
    if (!model.active[j]) continue;
    value += model.beta[j] * ((x[j] - model.mean[j]) / model.scale[j]);
  }
  return value;
}
