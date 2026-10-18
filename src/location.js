// Location: the device's own location service (GPS / Wi-Fi via the browser), plus place search.

export class LocationError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const MESSAGES = {
  insecure: 'Location only works on a secure (https) address. Open the app from its GitHub Pages link.',
  unsupported: "This browser can't share your location. Search for a place instead.",
  denied: 'Location access is off for this site. Allow it in your browser settings, or search for a place.',
  unavailable: "Your device couldn't find your location. On a Mac, check System Settings → Privacy & Security → Location Services.",
  timeout: 'Finding your location took too long. Try again, or search for a place.'
};

/** Ask the OS for the device location through the browser's Geolocation API. */
export function getDeviceLocation({
  geo = globalThis.navigator?.geolocation,
  isSecure = globalThis.isSecureContext !== false,
  timeoutMs = 10000
} = {}) {
  return new Promise((resolve, reject) => {
    if (!isSecure) return reject(new LocationError(MESSAGES.insecure, 'insecure'));
    if (!geo) return reject(new LocationError(MESSAGES.unsupported, 'unsupported'));
    geo.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy || 0), source: 'device' }),
      err => {
        const code = err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable';
        reject(new LocationError(MESSAGES[code], code));
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
    );
  });
}

/**
 * Place name → coordinates. Open-Meteo knows cities and neighbourhoods; parks, landmarks and
 * street addresses fall back to OpenStreetMap (Nominatim).
 */
export async function searchPlaces(query, fetchFn = globalThis.fetch) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  let towns = [];
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
    const res = await fetchFn(url);
    if (res.ok) {
      towns = ((await res.json()).results || []).map(r => ({
        name: r.name,
        detail: [r.admin1, r.country_code === 'US' ? null : r.country].filter(Boolean).join(', '),
        lat: r.latitude, lon: r.longitude
      }));
    }
  } catch (_) { /* fall through to OpenStreetMap */ }
  if (towns.length) return towns;
  const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'json', limit: '6', addressdetails: '1', 'accept-language': 'en' });
  const res = await fetchFn(url);
  if (!res.ok) throw new LocationError(`Place search failed (${res.status}). Try again in a moment.`, 'http');
  const found = await res.json();
  if (!Array.isArray(found)) return [];
  return found.map(r => {
    const a = r.address || {};
    const name = r.name || String(r.display_name || '').split(',')[0];
    return {
      name,
      detail: [a.suburb || a.neighbourhood, a.city || a.town || a.village, a.country_code === 'us' ? a.state : a.country].filter(Boolean).filter(x => x !== name).join(', '),
      lat: Number(r.lat), lon: Number(r.lon)
    };
  });
}

/** Coordinates → a short neighbourhood label (OpenStreetMap Nominatim). Falls back to coordinates. */
export async function placeLabel(lat, lon, fetchFn = globalThis.fetch) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json', zoom: '14', 'accept-language': 'en' });
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(String(res.status));
    const a = (await res.json()).address || {};
    const admin = /community board|district \d|ward \d/i;   // admin areas like "Manhattan Community Board 1" aren't place names
    const pick = [a.neighbourhood, a.quarter, a.suburb, a.city_district, a.town, a.city, a.village, a.county].find(v => v && !admin.test(v));
    return pick || coordLabel(lat, lon);
  } catch (_) {
    return coordLabel(lat, lon);
  }
}

export function coordLabel(lat, lon) {
  return `${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`;
}
