// Weather from Open-Meteo (free, no key). Always fetched in metric; the UI converts for display.

const FIELDS = 'temperature_2m,apparent_temperature,precipitation_probability,wind_speed_10m,weather_code,is_day';

export function forecastUrl({ lat, lon, days = 2 }) {
  const p = new URLSearchParams({
    latitude: Number(lat).toFixed(4),
    longitude: Number(lon).toFixed(4),
    current: FIELDS,
    hourly: FIELDS,
    forecast_days: String(days),
    timezone: 'auto'
  });
  return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
}

export class WeatherError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export async function fetchForecast({ lat, lon, days = 2 }, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(forecastUrl({ lat, lon, days }));
  } catch (e) {
    throw new WeatherError("Couldn't reach the weather service. Check your connection and tap Refresh.", 'network');
  }
  if (!res.ok) {
    let reason = '';
    try { reason = (await res.json()).reason || ''; } catch (_) {}
    throw new WeatherError(`The weather service returned an error (${res.status}). ${reason}`.trim(), 'http');
  }
  return normalize(await res.json());
}

/** Turn Open-Meteo's parallel arrays into one object per hour. */
export function normalize(json) {
  const h = json.hourly;
  if (!h || !Array.isArray(h.time)) throw new WeatherError('Weather data was missing hourly values.', 'shape');
  const hours = h.time.map((iso, i) => ({
    iso,                                   // local time at the location, e.g. 2026-10-18T15:00
    date: iso.slice(0, 10),
    hour: Number(iso.slice(11, 13)),
    tempC: num(h.temperature_2m?.[i]),
    feelsC: num(h.apparent_temperature?.[i]),
    windKmh: num(h.wind_speed_10m?.[i]),
    rainProb: num(h.precipitation_probability?.[i]) ?? 0,
    code: num(h.weather_code?.[i]),
    isDay: h.is_day ? h.is_day[i] === 1 : null
  })).filter(x => x.feelsC !== null);
  const c = json.current;
  const current = c ? {
    iso: c.time, tempC: num(c.temperature_2m), feelsC: num(c.apparent_temperature),
    windKmh: num(c.wind_speed_10m), rainProb: num(c.precipitation_probability) ?? null,
    code: num(c.weather_code), isDay: c.is_day === 1
  } : null;
  return { timezone: json.timezone || 'UTC', utcOffsetSeconds: json.utc_offset_seconds || 0, current, hours };
}

/** Current local time at the forecast location, as an ISO-like string (YYYY-MM-DDTHH:MM). */
export function localNowIso(forecast, nowMs = Date.now()) {
  if (forecast.current?.iso) return forecast.current.iso;
  const d = new Date(nowMs + forecast.utcOffsetSeconds * 1000);
  return d.toISOString().slice(0, 16);
}

/** Hours from the current hour onwards. */
export function upcomingHours(forecast, count = 12, nowIso = localNowIso(forecast)) {
  const hourStart = nowIso.slice(0, 13) + ':00';
  const i = Math.max(0, forecast.hours.findIndex(x => x.iso >= hourStart));
  return forecast.hours.slice(i, i + count);
}

/** Hours inside [startIso, startIso + duration). */
export function hoursBetween(forecast, startIso, durationHours) {
  const start = startIso.slice(0, 13) + ':00';
  const i = forecast.hours.findIndex(x => x.iso >= start);
  if (i < 0) return [];
  return forecast.hours.slice(i, i + Math.max(1, durationHours));
}

const WMO = [
  [[0], 'Clear', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'cloud-sun'], [[3], 'Cloudy', 'cloud'],
  [[45, 48], 'Fog', 'fog'], [[51, 53, 55, 56, 57], 'Drizzle', 'drizzle'], [[61, 63, 65, 66, 67], 'Rain', 'rain'],
  [[71, 73, 75, 77], 'Snow', 'snow'], [[80, 81, 82], 'Showers', 'rain'], [[85, 86], 'Snow showers', 'snow'],
  [[95, 96, 99], 'Thunderstorm', 'storm']
];
/** WMO weather code → short words + icon key. */
export function describeCode(code) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: '', icon: 'cloud' };
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
