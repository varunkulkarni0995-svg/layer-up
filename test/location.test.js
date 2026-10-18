import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceLocation, searchPlaces, placeLabel, LocationError } from '../src/location.js';
import { loadSettings, saveSettings, rememberPlace, DEFAULT_SETTINGS } from '../src/store.js';

const geoOk = (lat, lon, accuracy = 35) => ({ getCurrentPosition: ok => ok({ coords: { latitude: lat, longitude: lon, accuracy } }) });
const geoErr = code => ({ getCurrentPosition: (_, fail) => fail({ code }) });
const json = (body, ok = true, status = 200) => async () => ({ ok, status, json: async () => body });

test('device location resolves with coordinates', async () => {
  const p = await getDeviceLocation({ geo: geoOk(40.7128, -74.006), isSecure: true });
  assert.deepEqual(p, { lat: 40.7128, lon: -74.006, accuracyM: 35, source: 'device' });
});
test('permission denied → "denied" with how-to-fix message', async () => {
  await assert.rejects(getDeviceLocation({ geo: geoErr(1), isSecure: true }), e => e instanceof LocationError && e.code === 'denied' && /Allow/.test(e.message));
});
test('position unavailable (e.g. Mac location services off)', async () => {
  await assert.rejects(getDeviceLocation({ geo: geoErr(2), isSecure: true }), e => e.code === 'unavailable' && /Location Services/.test(e.message));
});
test('timeout', async () => {
  await assert.rejects(getDeviceLocation({ geo: geoErr(3), isSecure: true }), e => e.code === 'timeout');
});
test('not https → explains why', async () => {
  await assert.rejects(getDeviceLocation({ geo: geoOk(1, 1), isSecure: false }), e => e.code === 'insecure');
});
test('no geolocation in browser', async () => {
  await assert.rejects(getDeviceLocation({ geo: undefined, isSecure: true }), e => e.code === 'unsupported');
});

test('place search uses Photon, biased to where you are', async () => {
  let url = '';
  const fetchFn = async u => { url = u; return { ok: true, status: 200, json: async () => ({ features: [
    { geometry: { coordinates: [-73.9855, 40.758] }, properties: { name: 'Times Square', district: 'Manhattan', city: 'New York', state: 'New York', countrycode: 'US' } },
    { geometry: { coordinates: [-73.9855, 40.758] }, properties: { name: 'Times Square', district: 'Manhattan', city: 'New York', state: 'New York', countrycode: 'US' } },
    { geometry: { coordinates: [-73.99, 40.75] }, properties: { street: 'West 42nd Street', housenumber: '229', city: 'New York', state: 'New York', countrycode: 'US' } }
  ] }) }; };
  const r = await searchPlaces('times sq', fetchFn, { lat: 40.71, lon: -74.01 });
  assert.ok(url.startsWith('https://photon.komoot.io/api/?'));
  assert.ok(url.includes('lat=40.710') && url.includes('lon=-74.010'));
  assert.deepEqual(r, [
    { name: 'Times Square', detail: 'Manhattan, New York', lat: 40.758, lon: -73.9855 },
    { name: '229 West 42nd Street', detail: 'New York, New York', lat: 40.75, lon: -73.99 }
  ]);
});
test('place search waits for 3 letters', async () => {
  assert.deepEqual(await searchPlaces('Ti', json({})), []);
});
test('if Photon is down, falls back to Open-Meteo towns', async () => {
  const fetchFn = async u => u.includes('photon') ? { ok: false, status: 503, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => ({ results: [{ name: 'Brooklyn', admin1: 'New York', country_code: 'US', latitude: 40.65, longitude: -73.95 }] }) };
  assert.deepEqual(await searchPlaces('Brooklyn', fetchFn), [{ name: 'Brooklyn', detail: 'New York', lat: 40.65, lon: -73.95 }]);
});
test('place label prefers neighbourhood, falls back to coordinates', async () => {
  assert.equal(await placeLabel(40.71, -74.01, json({ address: { neighbourhood: 'Financial District', city: 'New York' } })), 'Financial District');
  assert.equal(await placeLabel(40.71, -74.01, json({}, false, 503)), '40.71, -74.01');
});

test('settings: defaults, save/load round trip, bad storage is safe', () => {
  const mem = new Map(), storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = loadSettings(storage);
  assert.equal(s.tolerance.heat, DEFAULT_SETTINGS.tolerance.heat);
  s.units.temp = 'F'; s.tolerance.cold = -1;
  assert.equal(saveSettings(s, storage), true);
  const back = loadSettings(storage);
  assert.equal(back.units.temp, 'F'); assert.equal(back.tolerance.cold, -1);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(loadSettings(broken).units.temp, 'C');
  assert.equal(saveSettings(s, broken), false);
});
test('recent places dedupe and cap at 5', () => {
  let s = loadSettings(null);
  for (let i = 0; i < 7; i++) s = rememberPlace(s, { name: 'P' + i, lat: 40 + i, lon: -74 });
  s = rememberPlace(s, { name: 'P3 again', lat: 43, lon: -74 });
  assert.equal(s.places.length, 5);
  assert.equal(s.places[0].name, 'P3 again');
  assert.equal(s.places.filter(p => p.lat === 43).length, 1);
});

test('label skips admin areas like "Community Board"', async () => {
  const label = await placeLabel(40.75, -73.99, json({ address: { suburb: 'Manhattan Community Board 5', neighbourhood: 'Koreatown', city: 'New York' } }));
  assert.equal(label, 'Koreatown');
  const label2 = await placeLabel(40.75, -73.99, json({ address: { suburb: 'Manhattan Community Board 5', city: 'New York' } }));
  assert.equal(label2, 'New York');
});
test('saved activity list is cleaned up', () => {
  const mem = new Map([['layerup.settings.v1', JSON.stringify({ activity: 'bike', activities: ['walk', 'nonsense', 'run'] })]]);
  const s = loadSettings({ getItem: k => mem.get(k) ?? null, setItem() {} });
  assert.deepEqual(s.activities, ['walk', 'run']);
  assert.equal(s.activity, 'walk');
});
