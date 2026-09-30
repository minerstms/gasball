const EARTH_MILES = 3958.8;

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function nearestStation(lat, lon, stations) {
  let best = null;
  for (const station of stations) {
    const miles = haversineMiles(lat, lon, station.lat, station.lon);
    if (!best || miles < best.miles) best = { station, miles };
  }
  return best;
}
