import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forecastUrl, fetchForecast, normalize, upcomingHours, hoursBetween, localNowIso, describeCode, WeatherError } from '../src/weather.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/openmeteo-nyc.json', import.meta.url)));
const okFetch = body => async () => ({ ok: true, status: 200, json: async () => body });

test('URL asks for hourly + current fields in local time', () => {
  const u = new URL(forecastUrl({ lat: 40.7128, lon: -74.006 }));
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.ok(u.searchParams.get('hourly').includes('apparent_temperature'));
  assert.ok(u.searchParams.get('current').includes('weather_code'));
  assert.equal(u.searchParams.get('latitude'), '40.7128');
});
test('normalize zips parallel arrays into hours', () => {
  const f = normalize(FX);
  assert.equal(f.hours.length, 48);
  assert.deepEqual(f.hours[15], { iso: '2026-10-17T15:00', date: '2026-10-17', hour: 15, tempC: 12.1, feelsC: 6.3, windKmh: 24, rainProb: 1, code: 3, isDay: true });
  assert.equal(f.current.feelsC, 6.3);
  assert.equal(f.timezone, 'America/New_York');
});
test('upcoming hours start at the current local hour', () => {
  const f = normalize(FX);
  const up = upcomingHours(f, 12);
  assert.equal(up[0].iso, '2026-10-17T15:00');
  assert.equal(up.length, 12);
  assert.equal(up[11].iso, '2026-10-18T02:00');
});
test('local time falls back to UTC offset when "current" is missing', () => {
  const f = normalize({ ...FX, current: undefined });
  const iso = localNowIso(f, Date.parse('2026-10-17T19:30:00Z')); // 15:30 in New York
  assert.equal(iso, '2026-10-17T15:30');
});
test('hoursBetween returns a trip window', () => {
  const f = normalize(FX);
  const w = hoursBetween(f, '2026-10-17T19:00', 3);
  assert.deepEqual(w.map(h => h.hour), [19, 20, 21]);
  assert.deepEqual(hoursBetween(f, '2027-01-01T10:00', 2), []);
});
test('weather codes become words', () => {
  assert.equal(describeCode(0).text, 'Clear');
  assert.equal(describeCode(63).text, 'Rain');
  assert.equal(describeCode(95).icon, 'storm');
  assert.equal(describeCode(999).text, '');
});
test('fetchForecast returns normalized data', async () => {
  const f = await fetchForecast({ lat: 40.71, lon: -74.01 }, okFetch(FX));
  assert.equal(f.hours[0].iso, '2026-10-17T00:00');
});
test('network failure → friendly error', async () => {
  await assert.rejects(fetchForecast({ lat: 1, lon: 1 }, async () => { throw new TypeError('Failed to fetch'); }),
    e => e instanceof WeatherError && e.code === 'network' && /Refresh/.test(e.message));
});
test('HTTP error → message includes status and reason', async () => {
  const bad = async () => ({ ok: false, status: 400, json: async () => ({ error: true, reason: 'Latitude must be in range' }) });
  await assert.rejects(fetchForecast({ lat: 99, lon: 1 }, bad), e => e.code === 'http' && /400/.test(e.message) && /Latitude/.test(e.message));
});
test('missing hourly data → clear error', () => {
  assert.throws(() => normalize({}), e => e.code === 'shape');
});
