import { read, utils } from "xlsx/xlsx.mjs";
import { normalizePoints, parseEiaDate } from "./panel.js";

export function pointsFromWorkbook(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const book = read(data, { type: "array" });
  const sheet = book.Sheets["Data 1"];
  if (!sheet) throw new Error("missing Data 1 sheet");
  const rows = utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
  const points = [];
  for (const row of rows) {
    if (!row) continue;
    const date = parseEiaDate(row[0]);
    const value = Number(String(row[1] ?? "").replace(/,/g, ""));
    if (!date || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  return normalizePoints(points);
}
