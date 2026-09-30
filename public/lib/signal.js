export function signalFor(cents, thresholds) {
  if (!Number.isFinite(cents) || !thresholds) return "FINE";
  if (thresholds.buy != null && cents >= thresholds.buy) return "BUY";
  if (thresholds.wait != null && cents <= -thresholds.wait) return "WAIT";
  return "FINE";
}

export function formatCents(cents) {
  if (!Number.isFinite(cents)) return "";
  const sign = cents > 0 ? "+" : "";
  return `${sign}${cents.toFixed(1)}¢`;
}

export function formatConfidence(label) {
  if (label !== "LOW" && label !== "MODERATE" && label !== "HIGH") return "Confidence unavailable";
  return `Confidence ${label}`;
}
