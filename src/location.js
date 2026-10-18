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

/** Place name → coordinates (Open-Meteo geocoding). */
export async function searchPlaces(query, fetchFn = globalThis.fetch) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
  const res = await fetchFn(url);
  if (!res.ok) throw new LocationError(`Place search failed (${res.status}).`, 'http');
  const json = await res.json();
  return (json.results || []).map(r => ({
    name: r.name,
    detail: [r.admin1, r.country_code === 'US' ? null : r.country].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude
  }));
}

/** Coordinates → a short neighbourhood label (OpenStreetMap Nominatim). Falls back to coordinates. */
export async function placeLabel(lat, lon, fetchFn = globalThis.fetch) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'json', zoom: '14', 'accept-language': 'en' });
    const res = await fetchFn(url);
    if (!res.ok) throw new Error(String(res.status));
    const a = (await res.json()).address || {};
    return a.neighbourhood || a.suburb || a.quarter || a.city_district || a.town || a.city || a.village || a.county || coordLabel(lat, lon);
  } catch (_) {
    return coordLabel(lat, lon);
  }
}

export function coordLabel(lat, lon) {
  return `${Number(lat).toFixed(2)}, ${Number(lon).toFixed(2)}`;
}
