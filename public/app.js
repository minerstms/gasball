import { formatCents, formatConfidence } from "./lib/signal.js";
import { nearestStation } from "./lib/geo.js";

const PIN_KEY = "gasball.pinnedStationId";
const OBS_KEY = "gasball.observations";

const ball = document.querySelector("#ball");
const signalEl = document.querySelector("#signal");
const moveEl = document.querySelector("#move");
const confidenceEl = document.querySelector("#confidence");
const stationNameEl = document.querySelector("#station-name");
const stationMarketEl = document.querySelector("#station-market");
const statusEl = document.querySelector("#status");
const detailBody = document.querySelector("#detail-body");
const locateButton = document.querySelector("#locate");
const locationStatus = document.querySelector("#location-status");
const stationList = document.querySelector("#station-list");

let stations = [];
let activeStation = null;
let pinnedId = localStorage.getItem(PIN_KEY) || "safeway-trinidad";

function daysBetween(earlier, later) {
  return Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86400000);
}

function rememberObservation(forecast) {
  const log = JSON.parse(localStorage.getItem(OBS_KEY) || "[]");
  const matured = log.map((entry) => {
    const next = { ...entry };
    const later = (forecast.recentRetail || []).filter((point) => point.date > entry.asOf);
    if (!next.actual7) {
      const week = later.find((point) => {
        const gap = daysBetween(entry.asOf, point.date);
        return gap >= 7 && gap <= 10;
      });
      if (week && Number.isFinite(entry.retailDollars)) next.actual7 = (week.dollars - entry.retailDollars) * 100;
    }
    if (!next.actual14) {
      const week = later.find((point) => {
        const gap = daysBetween(entry.asOf, point.date);
        return gap >= 14 && gap <= 18;
      });
      if (week && Number.isFinite(entry.retailDollars)) next.actual14 = (week.dollars - entry.retailDollars) * 100;
    }
    return next;
  });
  const exists = matured.some((entry) => entry.marketId === forecast.marketId && entry.asOf === forecast.asOf && entry.modelVersion === forecast.modelVersion);
  if (!exists) {
    matured.push({
      marketId: forecast.marketId,
      forecastMarket: forecast.forecastMarket,
      asOf: forecast.asOf,
      modelVersion: forecast.modelVersion,
      predicted7: forecast.cents,
      predicted14: forecast.horizon14 ? forecast.horizon14.cents : null,
      retailDollars: forecast.retailDollars,
      actual7: null,
      actual14: null
    });
  }
  localStorage.setItem(OBS_KEY, JSON.stringify(matured));
}

function placeName(station) {
  return String(station.marketName || "").replace(/, CO$/, "");
}

function forecastScope(station, forecast) {
  const place = placeName(station);
  if (forecast?.calibration?.applied === true) return `${place} station forecast`;
  return `${place} market forecast`;
}

function paintStation(station, forecast) {
  stationNameEl.textContent = station.name;
  stationMarketEl.textContent = forecastScope(station, forecast);
  ball.setAttribute("aria-label", `GasBall for ${station.name}, ${forecastScope(station, forecast)}`);
  for (const button of stationList.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", button.dataset.id === pinnedId ? "true" : "false");
  }
}

function detailLines(lines) {
  detailBody.replaceChildren(...lines.map((line) => {
    const p = document.createElement("p");
    p.className = "sub";
    p.textContent = line;
    return p;
  }));
}

function paintForecast(view, note) {
  const forecast = view?.data;
  const notices = [];
  if (note) notices.push(note);
  if (!forecast) {
    ball.className = "ball unknown";
    signalEl.className = "signal unknown";
    signalEl.textContent = "Forecast unavailable";
    moveEl.textContent = "";
    confidenceEl.textContent = "Confidence unavailable";
    if (activeStation) paintStation(activeStation, null);
    detailBody.replaceChildren();
    statusEl.textContent = notices.join(" ");
    return;
  }
  paintStation(activeStation, forecast);
  const scope = forecastScope(activeStation, forecast);
  const origin = forecast.inputSource || view.source;
  const saved = origin === "snapshot" || origin === "cache" || view.source === "snapshot" || view.source === "cache";
  if (saved) notices.push("Live forecast is unavailable. Showing the saved forecast.");
  const stale = forecast.sourceStatus === "stale" || forecast.actionable === false;
  if (stale) {
    ball.className = "ball unknown";
    signalEl.className = "signal unknown";
    signalEl.textContent = "STALE";
    moveEl.textContent = "Update delayed";
    confidenceEl.textContent = "Confidence unavailable";
    const lines = [
      `Update delayed. Last ${forecast.signal} ${formatCents(forecast.cents)} as of ${forecast.dataAsOf || forecast.asOf}.`,
      `Model ${forecast.modelVersion}`,
      scope
    ];
    if (forecast.horizon14) lines.push(`14-day ${formatCents(forecast.horizon14.cents)} · ${forecast.horizon14.signal}`);
    if (saved) lines.unshift("Live forecast is unavailable. Showing the saved forecast.");
    detailLines(lines);
    statusEl.textContent = notices.join(" ");
    return;
  }
  const signal = forecast.signal;
  ball.className = `ball ${signal.toLowerCase()}`;
  signalEl.className = `signal ${signal.toLowerCase()}`;
  signalEl.textContent = signal;
  moveEl.textContent = `${formatCents(forecast.cents)} per gallon`;
  confidenceEl.textContent = formatConfidence(forecast.confidenceLabel || forecast.confidence);
  const lines = [
    `As of ${forecast.dataAsOf || forecast.asOf}`,
    `Model ${forecast.modelVersion}`,
    `14-day ${formatCents(forecast.horizon14.cents)} · ${forecast.horizon14.signal}`,
    scope
  ];
  if (saved) lines.unshift("Live forecast is unavailable. Showing the saved forecast.");
  detailLines(lines);
  statusEl.textContent = notices.join(" ");
  rememberObservation(forecast);
}

async function loadForecast(marketId) {
  const cacheKey = `gasball.forecast.${marketId}`;
  try {
    const response = await fetch(`/api/forecast?market=${encodeURIComponent(marketId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("forecast request failed");
    const body = await response.json();
    const data = body.ok ? body : body.markets?.[marketId];
    if (!data?.ok || data.decisionVersion !== 2) throw new Error("forecast payload missing");
    localStorage.setItem(cacheKey, JSON.stringify(data));
    return { data, source: data.sourceStatus || "live" };
  } catch {
    try {
      const response = await fetch("/forecast-snapshot.json", { cache: "no-store" });
      if (!response.ok) throw new Error("snapshot missing");
      const body = await response.json();
      const data = body.markets?.[marketId];
      if (!data?.ok || data.decisionVersion !== 2) throw new Error("snapshot market missing");
      if (!data.inputSource) data.inputSource = "snapshot";
      if (!data.sourceStatus) data.sourceStatus = "snapshot";
      return { data, source: data.sourceStatus };
    } catch {
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return { data: null, source: "none" };
      const data = JSON.parse(cached);
      if (data.decisionVersion !== 2) return { data: null, source: "none" };
      return { data, source: data.sourceStatus || "cache" };
    }
  }
}

async function showStation(station, note) {
  activeStation = station;
  paintStation(station);
  if (note) statusEl.textContent = note;
  const view = await loadForecast(station.marketId);
  paintForecast(view, note);
}

function renderStationButtons() {
  stationList.replaceChildren(...stations.map((station) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.id = station.id;
    button.textContent = `${station.name}, ${station.marketName}`;
    button.setAttribute("aria-pressed", station.id === pinnedId ? "true" : "false");
    button.addEventListener("click", () => {
      pinnedId = station.id;
      localStorage.setItem(PIN_KEY, pinnedId);
      locationStatus.textContent = `Pinned ${station.name}, ${station.marketName}.`;
      showStation(station, "");
    });
    return button;
  }));
}

function currentPin() {
  return stations.find((station) => station.id === pinnedId) || stations.find((station) => station.id === "safeway-trinidad") || stations[0];
}

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    locationStatus.textContent = "Location is off. Using your pinned station.";
    showStation(currentPin(), "Location is off. Using your pinned station.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const nearest = nearestStation(position.coords.latitude, position.coords.longitude, stations);
      locationStatus.textContent = `Nearby market: ${nearest.station.marketName}.`;
      showStation(nearest.station, `Nearby market: ${nearest.station.marketName}.`);
    },
    () => {
      locationStatus.textContent = "Location is off. Using your pinned station.";
      showStation(currentPin(), "Location is off. Using your pinned station.");
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
});

async function start() {
  const response = await fetch("/stations.json");
  const doc = await response.json();
  stations = doc.stations;
  if (!stations.some((station) => station.id === pinnedId)) pinnedId = doc.defaultStationId;
  if (!localStorage.getItem(PIN_KEY)) localStorage.setItem(PIN_KEY, pinnedId);
  renderStationButtons();
  await showStation(currentPin(), "");
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

start();
