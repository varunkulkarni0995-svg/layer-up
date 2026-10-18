// Layer Up mapper: weather + how you travel + occasion + tolerance + wardrobe → outfit.
// Pure functions, no network, no UI. Same input always gives the same answer.

// Activity library. Users pick which ones they see (Settings); the rest stay available for later.
// feelsAdj: how the activity changes what you feel (°C). overheatRisk: extra cost of being overdressed.
// noUmbrella: hands not free, so rain needs a water-resistant outer instead. shed: tip when an outer layer comes off.
export const ACTIVITIES = {
  class:  { label: 'Class',  feelsAdj: 3,  overheatRisk: 0.8, exposed: true,  shed: 'Take the outer layer off in class' },
  walk:   { label: 'Walk',   feelsAdj: 0,  overheatRisk: 0,   exposed: true },
  subway: { label: 'Subway', feelsAdj: 2,  overheatRisk: 0.6, exposed: true,  shed: 'Take the outer layer off on the train' },
  run:    { label: 'Run',    feelsAdj: 8,  overheatRisk: 1.2, exposed: true,  noUmbrella: true, shed: "You'll warm up fast: start a little cool" },
  bike:   { label: 'Bike',   feelsAdj: -3, overheatRisk: 0.2, exposed: true,  noUmbrella: true },
  inside: { label: 'Inside', feelsAdj: 4,  overheatRisk: 0.8, exposed: false, shed: 'Take the outer layer off indoors' }
};
export const DEFAULT_ACTIVITIES = ['class', 'walk', 'subway', 'run'];

export const OCCASIONS = {
  casual:   { label: 'Casual',   minDressy: 0 },
  work:     { label: 'Work',     minDressy: 5 },
  dinner:   { label: 'Dinner',   minDressy: 6 },
  date:     { label: 'Date',     minDressy: 7 },
  outdoors: { label: 'Outdoors', minDressy: 0 },
  gym:      { label: 'Gym',      minDressy: 0 }
};

const COMFORT_C = 20;          // feels-like at which a T-shirt alone is comfortable
const POINTS_PER_DEGREE = 0.6; // warmth points needed per °C below comfort
const RAIN_THRESHOLDS = [20, 28, 37, 45, 53, 62, 70]; // index = rain tolerance + 3
const STRONG_WIND_KMH = 25;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Beanie + gloves are added when feels-like drops below this (°C): 6 − 2 × cold tolerance. */
export function extrasThreshold(tolerance) {
  return 6 - 2 * clamp(tolerance.cold ?? 0, -3, 3);
}

/** % rain chance at which rain is flagged. */
export function rainThreshold(tolerance) {
  return RAIN_THRESHOLDS[clamp(tolerance.rain ?? 0, -3, 3) + 3];
}

/** What you actually feel for one hour on this trip. */
export function effectiveFeels(hour, activity = 'walk') {
  const a = ACTIVITIES[activity] || ACTIVITIES.walk;
  return hour.feelsC + a.feelsAdj;
}

/** Warmth points needed for one hour. */
export function warmthNeed(hour, { activity = 'walk', tolerance = {} } = {}) {
  const comfort = COMFORT_C - 1.5 * clamp(tolerance.cold ?? 0, -3, 3);
  const feels = effectiveFeels(hour, activity);
  return Math.max(0, (comfort - feels) * POINTS_PER_DEGREE);
}

function bySlot(wardrobe) {
  const g = { base: [], mid: [], outer: [], head: [], hands: [], carry: [] };
  wardrobe.forEach(i => (g[i.slot] || (g[i.slot] = [])).push(i));
  return g;
}

/**
 * Pick the best outfit for a set of hours (one hour or a window).
 * Dresses for the hardest hour in the window and reports what to add or remove as hours change.
 */
export function recommend({ hours, activity = 'walk', occasion = 'casual', tolerance = {}, wardrobe, _relax = 0 }) {
  // _relax: 0 = all rules, 1 = drop dress code, 2 = also drop rain/wind gear rules. Always ends at 2.
  if (!hours || !hours.length) throw new Error('recommend() needs at least one hour of weather');
  if (!wardrobe || !wardrobe.length) throw new Error('recommend() needs a wardrobe');
  const act = ACTIVITIES[activity] || ACTIVITIES.walk;
  const occ = OCCASIONS[occasion] || OCCASIONS.casual;
  const slots = bySlot(wardrobe);

  const feelsList = hours.map(h => effectiveFeels(h, activity));
  const minFeels = Math.min(...feelsList);
  const needs = hours.map(h => warmthNeed(h, { activity, tolerance }));
  const need = Math.max(...needs);
  const maxRain = Math.max(...hours.map(h => h.rainProb ?? 0));
  const maxWind = Math.max(...hours.map(h => h.windKmh ?? 0));
  const rainy = act.exposed && maxRain >= rainThreshold(tolerance);
  const windy = act.exposed && maxWind >= STRONG_WIND_KMH;
  const extrasCut = extrasThreshold(tolerance);
  const wantExtras = act.exposed && minFeels < extrasCut;
  const dressyOccasion = occ.minDressy >= 6;
  // Thermals only when it's properly cold, or as slim warmth under dressy clothes.
  const thermalsOk = minFeels <= extrasCut - 2 || dressyOccasion;
  const heat = clamp(tolerance.heat ?? 0, -3, 3);

  // Extras are decided by the threshold rule, not by the warmth sum.
  const head = wantExtras ? slots.head[0] || null : null;
  const hands = wantExtras ? slots.hands[0] || null : null;
  const extrasWarmth = (head?.warmth || 0) + (hands?.warmth || 0);

  const bases = slots.base.length ? slots.base : [{ id: 'none', name: '—', warmth: 0, dressy: 0 }];
  const mids = [null, ...slots.mid];
  const outers = [null, ...slots.outer];

  const W_UNDER = 3;
  const W_OVER = Math.max(0.3, 1.5 - 0.4 * heat) + act.overheatRisk;
  let best = null;

  for (const base of bases) for (const mid of mids) for (const outer of outers) {
    const visible = outer || mid || base;
    const reasons = [];
    // Hard rules
    if (_relax < 1 && occ.minDressy && (visible.dressy ?? 0) < occ.minDressy) continue;
    if (_relax < 1 && dressyOccasion && mid && (mid.dressy ?? 0) < 4) continue;          // no hoodie under the nice jacket at dinner
    if (base.id === 'thermals' && !thermalsOk) continue;
    if (_relax < 2 && rainy && act.noUmbrella && (!outer || outer.water < 0.5)) continue; // can't hold an umbrella on a bike or a run
    if (_relax < 2 && windy && need > 6 && (!outer || outer.wind < 0.5)) continue;

    const warmth = base.warmth + (mid?.warmth || 0) + (outer?.warmth || 0) + extrasWarmth;
    const under = Math.max(0, need - warmth);
    const over = Math.max(0, warmth - need);
    const layers = (mid ? 1 : 0) + (outer ? 1 : 0) + (base.implicit ? 0 : 1);
    let cost = under * W_UNDER + over * W_OVER + layers * 0.3;
    if (activity === 'subway' && outer && mid) cost -= 0.2; // easy to shed one layer underground
    const carriesUmbrella = (slots.carry || []).some(c => c.alwaysCarried && c.water >= 0.5);
    if (rainy && outer && outer.water >= 0.5) cost -= carriesUmbrella ? 0.2 : 0.5; // prefer a water-resistant shell when wet
    if (under > 1.5) reasons.push('may feel cold');
    if (!best || cost < best.cost) best = { base, mid, outer, warmth, cost, under, over, reasons };
  }

  if (!best) {
    // Nothing met the hard rules. Relax one level at a time; level 2 has no hard rules left, so this always ends.
    if (_relax >= 2) throw new Error('recommend() could not build any outfit from this wardrobe');
    const r = recommend({ hours, activity, occasion, tolerance, wardrobe, _relax: _relax + 1 });
    if (_relax === 0 && occ.minDressy && !r.notes.some(n => n.startsWith('Nothing dressy'))) r.notes.push(`Nothing dressy enough for ${occ.label.toLowerCase()} in your wardrobe`);
    return r;
  }

  const pieces = [best.base, best.mid, best.outer].filter(p => p && !p.implicit && p.id !== 'none');
  const title = pieces.length ? pieces.map(p => p.name).join(' + ') : best.base.name;
  const extras = [head, hands].filter(Boolean);

  // Per-hour guidance: when extras become needed inside the window.
  const perHour = hours.map((h, i) => {
    const f = feelsList[i];
    const needsExtras = act.exposed && f < extrasCut;
    return { time: h.time, feelsC: Math.round(f), need: round1(needs[i]), extras: needsExtras };
  });
  const firstExtras = perHour.find(p => p.extras);
  const notes = [];
  if (extras.length && firstExtras && firstExtras !== perHour[0]) notes.push(`Add ${extras.map(e => e.name.toLowerCase()).join(' + ')} from ${firstExtras.time}`);
  else if (extras.length) notes.push(`Wear ${extras.map(e => e.name.toLowerCase()).join(' + ')}`);
  if (act.shed && best.outer) notes.push(act.shed);
  if (windy) notes.push(`Windy (up to ${Math.round(maxWind)} km/h)`);
  if (best.under > 1.5) notes.push('Warmest combo you own is still a little light');
  if (_relax >= 2 && rainy && act.noUmbrella && !(best.outer && best.outer.water >= 0.5)) notes.push("You'll get wet: none of your outer layers is water-resistant");
  if (_relax >= 2 && windy && need > 6 && !(best.outer && best.outer.wind >= 0.5)) notes.push('None of your outer layers blocks wind');

  const umbrella = rainy && !act.noUmbrella;
  return {
    title,
    outfit: { base: best.base.id, mid: best.mid?.id || null, outer: best.outer?.id || null, head: head?.id || null, hands: hands?.id || null },
    extras: extras.map(e => e.id),
    umbrella,
    rain: { maxProb: maxRain, flagged: rainy, threshold: rainThreshold(tolerance) },
    need: round1(need),
    warmth: round1(best.warmth),
    minFeelsC: Math.round(minFeels),
    perHour,
    notes
  };
}

const round1 = v => Math.round(v * 10) / 10;
