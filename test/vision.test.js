import test from 'node:test';
import assert from 'node:assert/strict';
import { readGarment, ADAPTERS, PROVIDERS } from '../src/vision.js';

const reading = {
  usable: true, reject_reason: null,
  garment: { name: 'Navy hoodie', slot: 'mid', warmth: 3, wind: 0.2, water: 0.1, dressy: 2, warmth_basis: 'Cotton fleece, hood' },
  confidence: { name: 0.9, slot: 0.95, warmth: 0.7, wind: 0.8, water: 0.7, dressy: 0.9 },
  visible_evidence: ['hood', 'kangaroo pocket'], clarify: null
};
const geminiOk = { candidates: [{ content: { parts: [{ text: JSON.stringify(reading) }] } }] };
const groqOk = { choices: [{ message: { content: JSON.stringify(reading) } }] };
const IMG_A = 'data:image/jpeg;base64,' + 'A'.repeat(400);
const IMG_B = 'data:image/jpeg;base64,' + 'B'.repeat(400);
const noWait = async () => {};
const reply = (status, body, headers = {}) => ({
  ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
  headers: { get: k => headers[k.toLowerCase()] ?? null }
});
const steps = [{ provider: 'gemini', apiKey: 'g' }, { provider: 'groq', apiKey: 'q' }];
function script(...answers) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); const a = answers.shift(); if (a instanceof Error) throw a; return a; };
  return { calls, fetchImpl };
}

/* ---------- happy path first ---------- */

test('Gemini answers first time: one call, no fallback', async () => {
  const { calls, fetchImpl } = script(reply(200, geminiOk));
  const out = await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(out.result.garment.slot, 'mid');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage/);
  assert.equal(out.meta.fallback, false);
});

/* ---------- retries and fallback ---------- */

test('unparseable Gemini reply is retried once with a JSON-only note', async () => {
  const bad = { candidates: [{ content: { parts: [{ text: 'Sure! Here is the coat…' }] } }] };
  const { calls, fetchImpl } = script(reply(200, bad), reply(200, geminiOk));
  const out = await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(calls.length, 2);
  assert.match(calls[1].body.contents[0].parts[0].text, /Return only the JSON object/);
  assert.equal(out.meta.fallback, false);
});

test('429 waits for Retry-After (capped) then retries the same provider', async () => {
  const waits = [];
  const { fetchImpl } = script(reply(429, {}, { 'retry-after': '30' }), reply(200, geminiOk));
  await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [8000]);
});

test('Gemini 503 twice → falls back to Groq', async () => {
  const { calls, fetchImpl } = script(reply(503, {}), reply(503, {}), reply(200, groqOk));
  const out = await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(calls.length, 3);
  assert.match(calls[2].url, /api\.groq\.com/);
  assert.equal(out.meta.provider, 'groq');
  assert.equal(out.meta.fallback, true);
  assert.equal(out.attempts.length, 3);
});

test('bad Gemini key skips straight to Groq, no retry', async () => {
  const { calls, fetchImpl } = script(reply(401, {}), reply(200, groqOk));
  const out = await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(calls.length, 2);
  assert.equal(out.meta.provider, 'groq');
});

test('network error is retried, then succeeds', async () => {
  const { fetchImpl } = script(new TypeError('fetch failed'), reply(200, geminiOk));
  const out = await readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(out.attempts[0].kind, 'network');
});

test('everything fails → one clear error naming both, with the attempt log', async () => {
  const { fetchImpl } = script(reply(503, {}), reply(503, {}), reply(503, {}), reply(503, {}));
  await assert.rejects(readGarment({ steps, dataUrl: IMG_A, fetchImpl, sleep: noWait }), e => {
    assert.match(e.message, /Gemini and Groq both failed/);
    assert.equal(e.attempts.length, 4);
    return true;
  });
});

test('only a Groq key set → Groq alone is used', async () => {
  const { calls, fetchImpl } = script(reply(200, groqOk));
  await readGarment({ steps: [{ provider: 'gemini', apiKey: '' }, { provider: 'groq', apiKey: 'q' }], dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.match(calls[0].url, /groq/);
});

test('no keys at all → auth error before any network call', async () => {
  const { calls, fetchImpl } = script();
  await assert.rejects(readGarment({ steps: [], dataUrl: IMG_A, fetchImpl }), /No AI key/);
  assert.equal(calls.length, 0);
});

test('Groq reply wrapped in a think block still parses', async () => {
  const wrapped = { choices: [{ message: { content: '<think>looking…</think>\n' + JSON.stringify(reading) } }] };
  const { fetchImpl } = script(reply(200, wrapped));
  const out = await readGarment({ steps: [{ provider: 'groq', apiKey: 'q' }], dataUrl: IMG_A, fetchImpl, sleep: noWait });
  assert.equal(out.result.garment.name, 'Navy hoodie');
});

/* ---------- paired-fixture guard: the image must reach every provider ---------- */

for (const p of Object.keys(ADAPTERS)) {
  test(`${PROVIDERS[p].label}: request carries the image, and two images give two requests`, () => {
    const mk = b64 => JSON.stringify(ADAPTERS[p].request({ base64: b64, mediaType: 'image/jpeg', prompt: 'x', model: 'm', apiKey: 'k' }).body);
    const a = mk('A'.repeat(400)), b = mk('B'.repeat(400));
    assert.ok(a.includes('A'.repeat(400)), 'image bytes missing from request');
    assert.notEqual(a, b);
  });
}
