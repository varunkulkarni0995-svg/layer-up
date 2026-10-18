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
 * Place search as you type: landmarks, parks, streets, neighbourhoods, cities.
 * Photon (OpenStreetMap data, built for search-as-you-type) ranks results near `near` first.
 * If Photon is down, falls back to Open-Meteo, which only knows towns and cities.
 */
export async function searchPlaces(query, fetchFn = globalThis.fetch, near = null) {
  const q = String(query || '').trim();
  if (q.length < 3) return [];
  try {
    const p = new URLSearchParams({ q, limit: '6', lang: 'en' });
    if (near && isFinite(near.lat) && isFinite(near.lon)) { p.set('lat', Number(near.lat).toFixed(3)); p.set('lon', Number(near.lon).toFixed(3)); }
    const res = await fetchFn('https://photon.komoot.io/api/?' + p.toString());
    if (!res.ok) throw new Error(String(res.status));
    const feats = (await res.json()).features || [];
    return dedupe(feats.map(photonPlace).filter(Boolean));
  } catch (_) {
    const url = 'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: q, count: '6', language: 'en', format: 'json' });
    const res = await fetchFn(url);
    if (!res.ok) throw new LocationError(`Place search isn't working right now (${res.status}). Try again in a moment.`, 'http');
    return ((await res.json()).results || []).map(r => ({
      name: r.name,
      detail: [r.admin1, r.country_code === 'US' ? null : r.country].filter(Boolean).join(', '),
      lat: r.latitude, lon: r.longitude
    }));
  }
}

function photonPlace(f) {
  const p = f.properties || {}, c = f.geometry?.coordinates;
  if (!c || c.length < 2) return null;
  const street = p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : '';
  const name = p.name || street || p.district || p.city;
  if (!name) return null;
  const area = p.district || p.locality || p.city || p.county;
  const region = p.countrycode === 'US' ? p.state : p.country;
  const detail = [street !== name ? street : '', area !== name ? area : '', region !== name ? region : ''].filter(Boolean).join(', ');
  return { name, detail, lat: c[1], lon: c[0] };   // GeoJSON order is [lon, lat]
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(p => { const k = p.name + '|' + p.lat.toFixed(3) + '|' + p.lon.toFixed(3); if (seen.has(k)) return false; seen.add(k); return true; });
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
