import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { buildMarketForecast } from "../src/forecast/predict.js";
import { presentForecast } from "../src/forecast/freshness.js";
import panel from "../data/panel/weekly.json" with { type: "json" };
import frozen from "../data/model/frozen-model.json" with { type: "json" };
import stationsDoc from "../public/stations.json" with { type: "json" };

const root = path.resolve("public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png"
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/api/forecast") {
      try {
        const forecast = buildMarketForecast(url.searchParams.get("market") || "trinidad", panel, frozen, stationsDoc);
        const asOf = Date.parse(`${forecast.asOf}T00:00:00Z`);
        const now = new Date(asOf + 24 * 60 * 60 * 1000);
        const body = presentForecast(forecast, { generatedAt: now.toISOString(), inputSource: "live", now });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      } catch (error) {
        res.writeHead(error.status || 503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "forecast_unavailable" }));
      }
      return;
    }
    const requested = path.resolve(root, decodeURIComponent(url.pathname).replace(/^[/\\]+/, ""));
    if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const filePath = url.pathname === "/" ? path.join(root, "index.html") : requested;
    try {
      const body = await readFile(filePath);
      const type = types[path.extname(filePath)] || "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      console.log(`${channel} unavailable: ${error.message}`);
    }
  }
  throw new Error("No Edge or Chrome browser available for PWA checks");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function noOverflow(page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth
  }));
  assert(box.scroll <= box.client + 1, `horizontal overflow ${box.scroll} > ${box.client}`);
}

async function fontRange(page) {
  const sizes = await page.evaluate(() => [...document.querySelectorAll("body, h1, h2, p, button, summary, label, input, .ball")].map((el) => ({
    name: el.id || el.className || el.tagName,
    size: Number.parseFloat(getComputedStyle(el).fontSize)
  })));
  for (const item of sizes) {
    assert(item.size >= 22 && item.size <= 36, `font size ${item.size} on ${item.name}`);
  }
}

async function waitForSignal(page) {
  await page.waitForFunction(() => ["BUY", "FINE", "WAIT"].includes(document.querySelector("#signal").textContent));
}

async function openDetails(page) {
  const details = page.locator("#details");
  if ((await details.getAttribute("open")) === null) await page.locator("summary").click();
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const checks = [];

try {
  const phone = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const page = await phone.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await waitForSignal(page);
  assert((await page.locator("#station-name").textContent()) === "Safeway", "default station name");
  assert((await page.locator("#station-market").textContent()) === "Trinidad market forecast", "default market");
  assert(["BUY", "FINE", "WAIT"].includes(await page.locator("#signal").textContent()), "signal missing");
  assert((await page.locator("#move").textContent()).includes("¢"), "cents missing");
  assert((await page.locator("#confidence").textContent()).startsWith("Confidence"), "confidence missing");
  const pageText = await page.locator("body").innerText();
  assert(!pageText.toLowerCase().includes("station-calibrated"), "uncalibrated forecast labeled station-calibrated");
  await noOverflow(page);
  await fontRange(page);
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    return fetch(href).then((response) => response.json());
  });
  assert(manifest.display === "standalone", "manifest is not standalone");
  assert(manifest.icons.length >= 2, "icons missing");
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active || registration?.installing || registration?.waiting);
  });
  checks.push("320px default Safeway Trinidad, signal, standalone manifest, service worker");

  await openDetails(page);
  await noOverflow(page);
  assert((await page.locator("#detail-body").innerText()).includes("Trinidad market forecast"), "details omitted the market forecast label");
  await page.getByRole("button", { name: "Sam's Club, Colorado Springs, CO" }).click();
  await page.waitForFunction(() => document.querySelector("#station-market").textContent === "Colorado Springs market forecast");
  await noOverflow(page);
  await page.getByRole("button", { name: "Sam's Club, Pueblo, CO" }).click();
  await page.waitForFunction(() => document.querySelector("#station-market").textContent === "Pueblo market forecast");
  await page.reload({ waitUntil: "networkidle" });
  await waitForSignal(page);
  assert((await page.locator("#station-market").textContent()) === "Pueblo market forecast", "pin did not persist");
  await noOverflow(page);
  checks.push("pinned station changes and persists");

  await phone.close();

  const located = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 39.7392, longitude: -104.9903 }
  });
  const locatedPage = await located.newPage();
  await locatedPage.goto(base, { waitUntil: "networkidle" });
  await waitForSignal(locatedPage);
  await openDetails(locatedPage);
  await locatedPage.locator("#locate").click();
  await locatedPage.waitForFunction(() => document.querySelector("#station-market").textContent === "Denver market forecast");
  assert((await locatedPage.locator("#location-status").textContent()).includes("Denver"), "nearby market not announced");
  const savedPin = await locatedPage.evaluate(() => localStorage.getItem("gasball.pinnedStationId"));
  assert(savedPin === "safeway-trinidad" || savedPin === null, "location overwrote the saved pin");
  await noOverflow(locatedPage);
  checks.push("location accepted selects Denver and leaves the pin");

  await located.close();

  const denied = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const deniedPage = await denied.newPage();
  await deniedPage.goto(base, { waitUntil: "networkidle" });
  await waitForSignal(deniedPage);
  await openDetails(deniedPage);
  await deniedPage.locator("#locate").click();
  await deniedPage.waitForFunction(() => (document.querySelector("#location-status").textContent || "").includes("Location is off"));
  assert((await deniedPage.locator("#station-name").textContent()) === "Safeway", "denied path left the pinned station");
  assert((await deniedPage.locator("#station-market").textContent()) === "Trinidad market forecast", "denied path left Trinidad");
  checks.push("location denied keeps the pinned station");
  await denied.close();

  const failed = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const failedPage = await failed.newPage();
  await failedPage.route("**/api/forecast**", (route) => route.abort());
  await failedPage.goto(base, { waitUntil: "networkidle" });
  await waitForSignal(failedPage);
  assert((await failedPage.locator("#status").textContent()).includes("saved forecast"), "API failure had no fallback");
  await noOverflow(failedPage);
  checks.push("forecast endpoint failure falls back to the saved snapshot");
  await failed.close();

  const staleContext = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const stalePage = await staleContext.newPage();
  await stalePage.route("**/api/forecast**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      decisionVersion: 2,
      market: "trinidad",
      marketId: "trinidad",
      signal: "WAIT",
      cents: -8.2,
      delta7d: -8.2,
      confidence: "LOW",
      confidenceLabel: "LOW",
      dataAsOf: "2026-09-01",
      asOf: "2026-09-01",
      generatedAt: "2026-09-29T00:00:00.000Z",
      modelVersion: "distributed-lag-v1",
      sourceStatus: "stale",
      inputSource: "live",
      actionable: false,
      calibration: { applied: false, reason: "central_station_history_required" },
      horizon14: { cents: -4, signal: "FINE" }
    })
  }));
  await stalePage.goto(base, { waitUntil: "networkidle" });
  await stalePage.waitForFunction(() => document.querySelector("#signal").textContent === "STALE");
  assert((await stalePage.locator("#move").textContent()) === "Update delayed", "stale forecast still looked actionable");
  assert(!["BUY", "WAIT"].includes(await stalePage.locator("#signal").textContent()), "stale headline was a fresh signal");
  await openDetails(stalePage);
  const staleDetails = await stalePage.locator("#detail-body").innerText();
  assert(staleDetails.includes("WAIT"), "stale details dropped the last signal");
  assert(staleDetails.includes("Trinidad market forecast"), "stale details omitted the market label");
  assert(!staleDetails.toLowerCase().includes("station-calibrated"), "stale view claimed station calibration");
  assert((await stalePage.locator("#station-name").textContent()) === "Safeway", "stale view left Safeway");
  await noOverflow(stalePage);
  await fontRange(stalePage);
  checks.push("stale forecast shows update delayed and keeps the last signal in details");
  await staleContext.close();

  const emptyContext = await browser.newContext({ viewport: { width: 320, height: 800 } });
  const empty = await emptyContext.newPage();
  await empty.route("**/api/forecast**", (route) => route.abort());
  await empty.route("**/forecast-snapshot.json", (route) => route.abort());
  await empty.goto(base, { waitUntil: "domcontentloaded" });
  await empty.waitForFunction(() => document.querySelector("#signal").textContent === "Forecast unavailable");
  assert((await empty.locator("#station-name").textContent()) === "Safeway", "unavailable state hid the station");
  await noOverflow(empty);
  await fontRange(empty);
  checks.push("total forecast failure stays on the pinned station without overflow");
  await emptyContext.close();

  const wide = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const widePage = await wide.newPage();
  await widePage.goto(base, { waitUntil: "networkidle" });
  await waitForSignal(widePage);
  await noOverflow(widePage);
  const column = await widePage.evaluate(() => getComputedStyle(document.querySelector("main")).flexDirection);
  assert(column === "column", "main layout is not a single column");
  checks.push("wide viewport stays a single column");
  await wide.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

for (const check of checks) console.log(`ok ${check}`);
