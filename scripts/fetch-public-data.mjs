import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = process.cwd();
const RAW = path.join(ROOT, "data", "raw");
const STALE_DAYS = 14;

const SERIES = [
  {
    file: "co_retail.xls",
    field: "retail_co",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_SCO_DPGw.xls",
    id: "EMM_EPMR_PTE_SCO_DPG",
    align: "exact"
  },
  {
    file: "EMM_EPMR_PTE_YDEN_DPGw.xls",
    field: "retail_den",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_YDEN_DPGw.xls",
    id: "EMM_EPMR_PTE_YDEN_DPG",
    align: "exact"
  },
  {
    file: "den_retail.xls",
    field: "retail_den_allgrades",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPM0_PTE_YDEN_DPGw.xls",
    id: "EMM_EPM0_PTE_YDEN_DPG",
    align: "exact",
    modelInput: false
  },
  {
    file: "us_retail.xls",
    field: "retail_us",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EMM_EPMR_PTE_NUS_DPGw.xls",
    id: "EMM_EPMR_PTE_NUS_DPG",
    align: "exact"
  },
  {
    file: "gulf_spot.xls",
    field: "gulf_spot",
    url: "https://www.eia.gov/dnav/pet/hist_xls/EER_EPMRU_PF4_RGC_DPGw.xls",
    id: "EER_EPMRU_PF4_RGC_DPG",
    align: "asof"
  },
  {
    file: "wti.xls",
    field: "wti",
    url: "https://www.eia.gov/dnav/pet/hist_xls/RWTCw.xls",
    id: "RWTC",
    align: "asof"
  },
  {
    file: "brent.xls",
    field: "brent",
    url: "https://www.eia.gov/dnav/pet/hist_xls/RBRTEw.xls",
    id: "RBRTE",
    align: "asof"
  },
  {
    file: "padd4_stocks.xls",
    field: "padd4_stocks",
    url: "https://www.eia.gov/dnav/pet/hist_xls/WGTSTP41w.xls",
    id: "WGTSTP41",
    align: "asof"
  }
];

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
};

function parseEiaDate(value) {
  const match = /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/.exec(String(value).trim());
  if (!match || MONTHS[match[1]] == null) return null;
  const date = new Date(Date.UTC(Number(match[3]), MONTHS[match[1]], Number(match[2])));
  return date.toISOString().slice(0, 10);
}

function readSeries(filePath) {
  const book = XLSX.readFile(filePath);
  const sheet = book.Sheets["Data 1"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
  const points = [];
  for (const row of rows) {
    const date = parseEiaDate(row[0]);
    const value = Number(String(row[1]).replace(/,/g, ""));
    if (!date || !Number.isFinite(value)) continue;
    points.push({ date, value });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const deduped = [];
  for (const point of points) {
    if (deduped.length && deduped[deduped.length - 1].date === point.date) deduped.pop();
    deduped.push(point);
  }
  return deduped;
}

function asof(points, isoDate) {
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
  if (gap > STALE_DAYS) return null;
  return found.value;
}

function csvEscape(value) {
  if (value == null || value === "") return "";
  return String(value);
}

async function main() {
  await mkdir(path.join(ROOT, "data", "panel"), { recursive: true });
  const loaded = [];
  for (const series of SERIES) {
    const filePath = path.join(RAW, series.file);
    const bytes = await readFile(filePath);
    const points = readSeries(filePath);
    loaded.push({
      ...series,
      points,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      start: points[0]?.date ?? null,
      end: points[points.length - 1]?.date ?? null,
      count: points.length
    });
    console.log(`${series.field} ${points.length} ${points[0]?.date} -> ${points[points.length - 1]?.date}`);
  }
  const calendar = new Set();
  for (const series of loaded) {
    if (series.align !== "exact") continue;
    if (series.field === "retail_us" || series.modelInput === false) continue;
    for (const point of series.points) calendar.add(point.date);
  }
  const dates = [...calendar].sort();
  const exact = new Map(loaded.map((series) => [series.field, new Map(series.points.map((point) => [point.date, point.value]))]));
  const rows = dates.map((date) => {
    const row = { date };
    for (const series of loaded) {
      if (series.align === "exact") row[series.field] = exact.get(series.field).get(date) ?? null;
      else row[series.field] = asof(series.points, date);
    }
    return row;
  });
  const fields = ["date", ...SERIES.map((series) => series.field)];
  const csv = [fields.join(",")].concat(rows.map((row) => fields.map((field) => csvEscape(row[field])).join(","))).join("\n");
  const panel = {
    builtAt: new Date().toISOString(),
    staleDays: STALE_DAYS,
    fields,
    sources: loaded.map((series) => ({
      id: series.id,
      field: series.field,
      url: series.url,
      align: series.align,
      sha256: series.sha256,
      start: series.start,
      end: series.end,
      count: series.count
    })),
    stationPriceNote: "No free public historical pump-price series was found for Safeway Trinidad or Sam's Club Pueblo, Colorado Springs, or Denver. Current pump quotes on retailer sites are not a history and are not used as model inputs.",
    denverGradeNote: "Denver production target is weekly regular all-formulations retail (EMM_EPMR_PTE_YDEN_DPG). All-grades Denver (EMM_EPM0_PTE_YDEN_DPG) is stored as retail_den_allgrades for comparison and is not a regression input. Regular conventional Denver (EMM_EPMRU_PTE_YDEN_DPG) ends in November 2023. Regular reformulated Denver begins in November 2023 and is too short to train.",
    rows
  };
  await writeFile(path.join(ROOT, "data", "panel", "weekly.csv"), csv);
  await writeFile(path.join(ROOT, "data", "panel", "weekly.json"), JSON.stringify(panel));
  await writeFile(path.join(ROOT, "data", "panel", "sources.json"), JSON.stringify({
    builtAt: panel.builtAt,
    sources: panel.sources,
    stationPriceNote: panel.stationPriceNote,
    denverGradeNote: panel.denverGradeNote
  }, null, 2));
  console.log(`panel rows ${rows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
