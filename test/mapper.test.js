import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommend, warmthNeed, extrasThreshold, rainThreshold, effectiveFeels } from '../src/mapper.js';
import { DEFAULT_WARDROBE as W, DEFAULT_TOLERANCE as T } from '../src/wardrobe.js';

const H = (feelsC, o = {}) => ({ time: o.time || '3 PM', feelsC, windKmh: o.wind ?? 10, rainProb: o.rain ?? 0 });
const rec = (hours, o = {}) => recommend({ hours, activity: o.activity || 'walk', occasion: o.occasion || 'casual', tolerance: { ...T, ...(o.tol || {}) }, wardrobe: o.wardrobe || W });

// ---------- Rules ----------
test('extras threshold follows 6 − 2 × cold', () => {
  assert.equal(extrasThreshold({ cold: 0 }), 6);
  assert.equal(extrasThreshold({ cold: -1 }), 8);
  assert.equal(extrasThreshold({ cold: 3 }), 0);
  assert.equal(extrasThreshold({ cold: 9 }), 0, 'clamped to +3');
});
test('rain threshold maps −3..+3 to 20..70%', () => {
  assert.equal(rainThreshold({ rain: -3 }), 20);
  assert.equal(rainThreshold({ rain: 0 }), 45);
  assert.equal(rainThreshold({ rain: 3 }), 70);
});
test('activity changes what you feel', () => {
  assert.equal(effectiveFeels(H(6), 'walk'), 6);
  assert.equal(effectiveFeels(H(6), 'bike'), 3);
  assert.equal(effectiveFeels(H(6), 'subway'), 8);
  assert.equal(effectiveFeels(H(6), 'inside'), 10);
});
test('no warmth needed at or above 20° feels-like', () => {
  assert.equal(warmthNeed(H(20), { tolerance: T }), 0);
  assert.equal(warmthNeed(H(30), { tolerance: T }), 0);
});
test('feeling the cold raises the warmth need', () => {
  assert.ok(warmthNeed(H(6), { tolerance: { cold: -1 } }) > warmthNeed(H(6), { tolerance: { cold: 0 } }));
});

// ---------- Everyday outfits (Varun's defaults: heat +2, cold 0, rain −3) ----------
test('hot day: T-shirt only', () => { const r = rec([H(30)]); assert.equal(r.title, 'T-shirt'); assert.deepEqual(r.extras, []); });
test('mild 20°: T-shirt only', () => assert.equal(rec([H(20)]).title, 'T-shirt'));
test('cool 16°: one light layer', () => assert.equal(rec([H(16)]).title, 'Nice jacket'));
test('12°: overcoat, no thermals', () => { const r = rec([H(12)]); assert.equal(r.title, 'Overcoat'); assert.notEqual(r.outfit.base, 'thermals'); });
test('today at feels 6°: hoodie + overcoat, no beanie yet', () => {
  const r = rec([H(6, { wind: 24 })]);
  assert.equal(r.title, 'Hoodie + Overcoat');
  assert.deepEqual(r.extras, []);
});
test('evening 5→2°: hoodie + overcoat + beanie + gloves', () => {
  const r = rec([H(5, { time: '6 PM' }), H(3, { time: '7 PM' }), H(3, { time: '8 PM' }), H(2, { time: '9 PM' })]);
  assert.equal(r.title, 'Hoodie + Overcoat');
  assert.deepEqual(r.extras, ['beanie', 'gloves']);
  assert.equal(r.minFeelsC, 2);
});
test('0°: thermals join the layers', () => assert.equal(rec([H(0)]).title, 'Thermals + Hoodie + Overcoat'));
test('−5°: puffer replaces overcoat', () => assert.equal(rec([H(-5)]).title, 'Thermals + Hoodie + Puffer'));
test('−12°: warns the wardrobe is too light', () => {
  const r = rec([H(-12)]);
  assert.equal(r.title, 'Thermals + Hoodie + Puffer');
  assert.ok(r.notes.some(n => n.includes('still a little light')));
});

// ---------- Window behaviour ----------
test('window dresses for the coldest hour', () => {
  const single = rec([H(10)]), win = rec([H(10), H(4)]);
  assert.ok(win.warmth >= single.warmth);
  assert.equal(win.minFeelsC, 4);
});
test('extras added mid-window are timed', () => {
  const r = rec([H(8, { time: '5 PM' }), H(7, { time: '6 PM' }), H(4, { time: '7 PM' })]);
  assert.ok(r.notes.includes('Add beanie + gloves from 7 PM'), r.notes.join(' | '));
  assert.deepEqual(r.perHour.map(p => p.extras), [false, false, true]);
});
test('colder never means less warmth (monotonic)', () => {
  let prev = -1;
  for (let f = 25; f >= -10; f--) { const w = rec([H(f)]).warmth; assert.ok(w >= prev, `at ${f}° warmth ${w} < ${prev}`); prev = w; }
});

// ---------- How you travel ----------
test('subway at 6°: lighter, with a take-it-off tip', () => {
  const r = rec([H(6)], { activity: 'subway' });
  assert.ok(r.warmth <= rec([H(6)]).warmth);
  assert.ok(r.notes.some(n => n.includes('train')));
});
test('biking at 6°: warmest outer + extras', () => {
  const r = rec([H(6)], { activity: 'bike' });
  assert.equal(r.outfit.outer, 'puffer');
  assert.deepEqual(r.extras, ['beanie', 'gloves']);
});
test('mostly inside: no beanie or gloves', () => assert.deepEqual(rec([H(2)], { activity: 'inside' }).extras, []));

// ---------- Rain ----------
test('rain over your 20% threshold while walking → umbrella', () => {
  const r = rec([H(10, { rain: 25 })]);
  assert.equal(r.umbrella, true);
  assert.equal(r.rain.flagged, true);
});
test('rain under threshold → no umbrella', () => assert.equal(rec([H(10, { rain: 15 })]).umbrella, false));
test('higher rain tolerance raises the bar', () => assert.equal(rec([H(10, { rain: 25 })], { tol: { rain: 3 } }).umbrella, false));
test('rain on a bike → water-resistant outer, no umbrella', () => {
  const r = rec([H(10, { rain: 40 })], { activity: 'bike' });
  assert.equal(r.umbrella, false);
  const outer = W.find(i => i.id === r.outfit.outer);
  assert.ok(outer && outer.water >= 0.5, `outer was ${r.outfit.outer}`);
});

// ---------- Wind ----------
test('strong wind on a cold day forces a wind-blocking outer', () => {
  const r = rec([H(4, { wind: 35 })]);
  const outer = W.find(i => i.id === r.outfit.outer);
  assert.ok(outer && outer.wind >= 0.5);
  assert.ok(r.notes.some(n => n.startsWith('Windy')));
});

// ---------- Occasion ----------
test('dinner at 8°: dressy outer, no hoodie', () => {
  const r = rec([H(8)], { occasion: 'dinner' });
  assert.notEqual(r.outfit.mid, 'hoodie');
  assert.ok(['overcoat', 'nice'].includes(r.outfit.outer));
});
test('date at 15°: nice jacket', () => assert.equal(rec([H(15)], { occasion: 'date' }).outfit.outer, 'nice'));
test('work commute at 8°: overcoat', () => assert.equal(rec([H(8)], { activity: 'subway', occasion: 'work' }).outfit.outer, 'overcoat'));
test('dressy occasion with no dressy clothes falls back gracefully', () => {
  const plain = W.filter(i => !['nice', 'overcoat'].includes(i.id));
  const r = rec([H(8)], { occasion: 'date', wardrobe: plain });
  assert.ok(r.title.length > 0);
});

// ---------- Tolerance ----------
test('cold tolerance −1 at 6°: warmer outfit + extras', () => {
  const base = rec([H(6)]), colder = rec([H(6)], { tol: { cold: -1 } });
  assert.ok(colder.warmth > base.warmth);
  assert.deepEqual(colder.extras, ['beanie', 'gloves']);
});
test('low heat tolerance avoids overdressing', () => {
  const hot = rec([H(14)], { tol: { heat: 2 } }), cool = rec([H(14)], { tol: { heat: -3 } });
  assert.ok(cool.warmth <= hot.warmth);
});

// ---------- Wardrobe edits ----------
test('re-rating an item changes the pick', () => {
  const warmerNice = W.map(i => (i.id === 'nice' ? { ...i, warmth: 6 } : i));
  assert.equal(rec([H(8)], { occasion: 'dinner', wardrobe: warmerNice }).outfit.outer, 'nice');
});

// ---------- Bad input ----------
test('rejects empty weather or wardrobe', () => {
  assert.throws(() => recommend({ hours: [], wardrobe: W }));
  assert.throws(() => recommend({ hours: [H(5)], wardrobe: [] }));
});

// ---------- New activities ----------
test('default activity list is Class, Walk, Subway, Run', async () => {
  const { DEFAULT_ACTIVITIES, ACTIVITIES } = await import('../src/mapper.js');
  assert.deepEqual(DEFAULT_ACTIVITIES, ['class', 'walk', 'subway', 'run']);
  DEFAULT_ACTIVITIES.forEach(a => assert.ok(ACTIVITIES[a], a));
});
test('run at 6°: much lighter than walking, no umbrella in rain', () => {
  const run = rec([H(6)], { activity: 'run' }), walk = rec([H(6)]);
  assert.ok(run.warmth < walk.warmth, `run ${run.warmth} vs walk ${walk.warmth}`);
  assert.equal(rec([H(10, { rain: 50 })], { activity: 'run' }).umbrella, false);
});
test('class at 8°: lighter than walking, take-it-off tip', () => {
  const cls = rec([H(8)], { activity: 'class' });
  assert.ok(cls.warmth <= rec([H(8)]).warmth);
  if (cls.outfit.outer) assert.ok(cls.notes.some(n => n.includes('in class')));
});
