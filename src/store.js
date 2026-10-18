// Settings storage. Milestone 1: this browser only (localStorage).
// Milestone 2 swaps this file for Supabase so phone and laptop share one profile.
import { DEFAULT_WARDROBE, DEFAULT_TOLERANCE } from './wardrobe.js';
import { ACTIVITIES, DEFAULT_ACTIVITIES } from './mapper.js';

const KEY = 'layerup.settings.v1';

export const DEFAULT_SETTINGS = {
  tolerance: { ...DEFAULT_TOLERANCE },
  units: { temp: 'C', wind: 'kmh', time: '12' },
  activity: 'walk',
  activities: [...DEFAULT_ACTIVITIES],   // which activities show as buttons; more can be added later
  wardrobe: DEFAULT_WARDROBE.map(i => ({ ...i })),
  places: [],        // saved/recent: { name, detail, lat, lon }
  lastPlace: null    // { name, lat, lon, source }
};

export function loadSettings(storage = safeStorage()) {
  try {
    const raw = storage && storage.getItem(KEY);
    if (!raw) return clone(DEFAULT_SETTINGS);
    const s = JSON.parse(raw);
    const activities = (Array.isArray(s.activities) ? s.activities : DEFAULT_ACTIVITIES).filter(a => ACTIVITIES[a]);
    const list = activities.length ? activities : [...DEFAULT_ACTIVITIES];
    return {
      ...clone(DEFAULT_SETTINGS), ...s,
      activities: list,
      activity: list.includes(s.activity) ? s.activity : list.includes('walk') ? 'walk' : list[0],
      tolerance: { ...DEFAULT_SETTINGS.tolerance, ...(s.tolerance || {}) },
      units: { ...DEFAULT_SETTINGS.units, ...(s.units || {}) },
      wardrobe: Array.isArray(s.wardrobe) && s.wardrobe.length ? s.wardrobe : clone(DEFAULT_SETTINGS.wardrobe)
    };
  } catch (_) {
    return clone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings, storage = safeStorage()) {
  try { storage && storage.setItem(KEY, JSON.stringify(settings)); return true; } catch (_) { return false; }
}

export function rememberPlace(settings, place, max = 5) {
  const key = p => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const rest = settings.places.filter(p => key(p) !== key(place));
  return { ...settings, places: [{ name: place.name, detail: place.detail || '', lat: place.lat, lon: place.lon }, ...rest].slice(0, max) };
}

function safeStorage() { try { return globalThis.localStorage; } catch (_) { return null; } }
const clone = o => JSON.parse(JSON.stringify(o));
