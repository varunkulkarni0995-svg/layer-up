import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise, gate, applyAnswer, toWardrobeItem, diffProposal, buildPrompt,
  FLOORS, REJECT_REASONS, SLOTS
} from '../src/garment.js';
import { toGeminiSchema, splitDataUrl } from '../src/vision.js';
import { scoreCorrectness, scoreHallucination, scoreCalibration, toCsv } from '../src/evals.js';

const good = {
  usable: true, reject_reason: null,
  garment: { name: 'Navy overcoat', slot: 'outer', warmth: 7, wind: 0.7, water: 0.3, dressy: 7, warmth_basis: 'Heavy wool, knee length' },
  confidence: { name: 0.9, slot: 0.95, warmth: 0.7, wind: 0.8, water: 0.7, dressy: 0.9 },
  visible_evidence: ['wool weave', 'notched lapel'],
  clarify: null
};

/* ---------- normalise ---------- */

test('normalise clamps out-of-range numbers', () => {
  const r = normalise({ ...good, garment: { ...good.garment, warmth: 99, wind: -3, dressy: 42 } });
  assert.equal(r.garment.warmth, 10);
  assert.equal(r.garment.wind, 0);
  assert.equal(r.garment.dressy, 10);
});

test('normalise rejects an unknown slot by falling back to outer', () => {
  const r = normalise({ ...good, garment: { ...good.garment, slot: 'trousers' } });
  assert.ok(SLOTS.includes(r.garment.slot));
  assert.equal(r.garment.slot, 'outer');
});

test('normalise returns null when usable is true but there is no garment', () => {
  assert.equal(normalise({ usable: true, garment: null, confidence: null }), null);
});

test('normalise keeps an unusable reading without a garment', () => {
  const r = normalise({ usable: false, reject_reason: 'too_dark', garment: null, confidence: null, visible_evidence: [], clarify: null });
  assert.equal(r.usable, false);
  assert.equal(r.reject_reason, 'too_dark');
});

test('normalise drops an invented reject reason', () => {
  const r = normalise({ usable: false, reject_reason: 'because_i_said_so', garment: null, confidence: null });
  assert.equal(r.reject_reason, null);
});

test('normalise caps evidence at six items and drops non-strings', () => {
  const r = normalise({ ...good, visible_evidence: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 42] });
  assert.equal(r.visible_evidence.length, 6);
  assert.ok(r.visible_evidence.every(x => typeof x === 'string'));
});

/* ---------- gate ---------- */

test('gate accepts a confident reading', () => {
  const g = gate(normalise(good));
  assert.equal(g.verdict, 'accept');
});

test('gate rejects when the model says unusable, with that reason message', () => {
  const g = gate(normalise({ usable: false, reject_reason: 'too_blurry', garment: null, confidence: null }));
  assert.equal(g.verdict, 'reject');
  assert.equal(g.message, REJECT_REASONS.too_blurry);
});

test('gate rejects a usable reading whose slot confidence is below the floor', () => {
  const r = normalise({ ...good, confidence: { ...good.confidence, slot: FLOORS.slot - 0.01 } });
  assert.equal(gate(r).verdict, 'reject');
});

test('gate asks about the least confident askable field', () => {
  const r = normalise({ ...good, confidence: { ...good.confidence, water: 0.2, wind: 0.4 } });
  const g = gate(r);
  assert.equal(g.verdict, 'ask');
  assert.equal(g.clarify.field, 'water');
  assert.ok(g.clarify.options.length >= 2);
});

test('gate never asks about warmth — it is subjective, so the slider settles it', () => {
  const r = normalise({ ...good, confidence: { ...good.confidence, warmth: 0.1 } });
  const g = gate(r);
  assert.equal(g.verdict, 'accept');
  assert.ok(g.lowFields.includes('warmth'));
});

test("gate replaces a clarify question aimed at a field that is not actually low", () => {
  const r = normalise({ ...good, confidence: { ...good.confidence, water: 0.2 },
    clarify: { field: 'dressy', question: 'wrong field', options: ['a', 'b'] } });
  assert.equal(gate(r).clarify.field, 'water');
});

test('gate on null input rejects rather than throwing', () => {
  assert.equal(gate(null).verdict, 'reject');
});

/* ---------- applyAnswer ---------- */

test('applyAnswer maps spoken answers onto the 0-1 scale', () => {
  assert.ok(applyAnswer(good.garment, 'water', 'Waterproof').water >= 0.9);
  assert.equal(applyAnswer(good.garment, 'water', 'No').water, 0.1);
  assert.ok(applyAnswer(good.garment, 'wind', 'A bit').wind > 0.1);
  assert.equal(applyAnswer(good.garment, 'dressy', 'Casual only').dressy, 3);
});

test('applyAnswer does not mutate the original', () => {
  const before = { ...good.garment };
  applyAnswer(good.garment, 'water', 'Waterproof');
  assert.deepEqual(good.garment, before);
});

/* ---------- toWardrobeItem ---------- */

test('toWardrobeItem produces a mapper-shaped item', () => {
  const item = toWardrobeItem(good.garment, []);
  for (const k of ['id', 'name', 'slot', 'warmth', 'wind', 'water', 'dressy']) assert.ok(k in item, k);
  assert.equal(item.addedBy, 'photo');
  assert.equal(item.id, 'navy-overcoat');
});

test('toWardrobeItem avoids colliding with an existing id', () => {
  const item = toWardrobeItem(good.garment, ['navy-overcoat', 'navy-overcoat-2']);
  assert.equal(item.id, 'navy-overcoat-3');
});

/* ---------- diffProposal ---------- */

test('diffProposal names only the fields the user changed', () => {
  const d = diffProposal(good.garment, { ...good.garment, warmth: 9 });
  assert.deepEqual(d.changed, ['warmth']);
  assert.equal(d.corrected, true);
});

test('diffProposal reports no correction when nothing moved', () => {
  assert.equal(diffProposal(good.garment, { ...good.garment }).corrected, false);
});

/* ---------- prompt ---------- */

test('buildPrompt uses the reference anchors for a small wardrobe', () => {
  const p = buildPrompt([]);
  assert.match(p, /T-shirt 1/);
  assert.doesNotMatch(p, /user's own wardrobe/);
});

test('buildPrompt switches to the user wardrobe once it has enough items', () => {
  const ward = [
    { name: 'Tee', slot: 'base', warmth: 1 }, { name: 'Hoodie', slot: 'mid', warmth: 3 },
    { name: 'Coat', slot: 'outer', warmth: 6 }, { name: 'Puffer', slot: 'outer', warmth: 8 }
  ];
  const p = buildPrompt(ward);
  assert.match(p, /own wardrobe/);
  assert.match(p, /Puffer 8/);
});

test('buildPrompt forbids unobservable claims', () => {
  assert.match(buildPrompt([]), /never name a brand/i);
});

/* ---------- gemini schema translation ---------- */

test('toGeminiSchema resolves union types and uppercases', () => {
  const out = toGeminiSchema({ type: ['string', 'null'], description: 'x' });
  assert.equal(out.type, 'STRING');
});

test('toGeminiSchema keeps string enums and drops null from them', () => {
  const out = toGeminiSchema({ type: 'string', enum: ['a', 'b', null] });
  assert.deepEqual(out.enum, ['a', 'b']);
  assert.equal(out.format, 'enum');
});

test('toGeminiSchema omits required keys with no matching property', () => {
  const out = toGeminiSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'ghost'] });
  assert.deepEqual(out.required, ['a']);
});

/* ---------- data urls ---------- */

test('splitDataUrl separates media type from payload', () => {
  const { mediaType, base64 } = splitDataUrl('data:image/jpeg;base64,AAAB');
  assert.equal(mediaType, 'image/jpeg');
  assert.equal(base64, 'AAAB');
});

test('splitDataUrl throws on something that is not a data url', () => {
  assert.throws(() => splitDataUrl('https://example.com/a.jpg'));
});

/* ---------- scoring ---------- */

const truth = { slot: 'outer', warmth: 7, wind: 0.7, water: 0.3, dressy: 7 };
const runOf = (over = {}, t = truth) => ({
  fixture: 'f', truth: t,
  result: { garment: { ...good.garment, ...over }, confidence: good.confidence, visible_evidence: ['wool weave'] },
  gate: { verdict: 'accept' }
});

test('scoreCorrectness computes slot accuracy and warmth error', () => {
  const s = scoreCorrectness([runOf(), runOf({ slot: 'mid', warmth: 9 })]);
  assert.equal(s.n, 2);
  assert.equal(s.slotAccuracy, 0.5);
  assert.equal(s.warmthMae, 1);
});

test('scoreCorrectness scores continuous fields as the booleans the UI shows', () => {
  // 0.9 and 0.6 both read as "blocks wind", so this counts as a hit.
  const s = scoreCorrectness([runOf({ wind: 0.9 }, { ...truth, wind: 0.6 })]);
  assert.equal(s.flags.wind.accuracy, 1);
});

test('scoreHallucination requires every negative to be refused', () => {
  const s = scoreHallucination([
    { fixture: 'desk', truth: null, gate: { verdict: 'reject' } },
    { fixture: 'wall', truth: null, gate: { verdict: 'accept' }, result: { garment: good.garment } }
  ]);
  assert.equal(s.abstainRate, 0.5);
  assert.deepEqual(s.leaked, ['wall']);
  assert.equal(s.pass.abstainRate, false);
});

test('scoreHallucination flags claims a photo cannot support', () => {
  const s = scoreHallucination([runOf({ name: 'Merino wool sweater' })]);
  assert.equal(s.unobservableClaims, 1);
  assert.equal(s.pass.unobservableClaims, false);
});

test('scoreHallucination passes clean readings', () => {
  const s = scoreHallucination([runOf()]);
  assert.equal(s.unobservableClaims, 0);
});

test('scoreCalibration buckets by stated confidence and measures the gap', () => {
  const s = scoreCalibration([runOf(), runOf({ slot: 'mid' })]);
  assert.ok(s.n > 0);
  assert.ok(s.buckets.length > 0);
  assert.ok(Number.isFinite(s.ece));
});

test('scoreCalibration reports no data rather than throwing on an empty run', () => {
  assert.equal(scoreCalibration([]).n, 0);
});

test('toCsv escapes commas and quotes', () => {
  const csv = toCsv([runOf({ name: 'Coat, navy "deep"' })]);
  assert.match(csv, /"Coat, navy ""deep"""/);
  assert.equal(csv.split('\n').length, 2);
});
