// Scoring for the eval harness. Pure functions — no network, no DOM.
//
// Three things are measured, and the third is the one that makes the other two
// actionable:
//   correctness   — is the reading right
//   hallucination — does it invent, and does it abstain when it should
//   calibration   — does a stated confidence of 0.9 mean 90%
//
// Without calibration the confidence floors in garment.js are arbitrary numbers.

export const PASS = {
  slotAccuracy: 0.95,
  nameUsable: 0.90,
  warmthMae: 1.5,
  flagAccuracy: 0.85,
  correctionRate: 0.33,
  abstainRate: 1.0,
  evidenceMatch: 0.95,
  calibrationGap: 0.10
};

const FLAGS = ['wind', 'water', 'dressy'];
// Continuous fields are scored as the binary the UI actually exposes.
const asBool = (field, v) => (field === 'dressy' ? v >= 6 : v >= 0.5);

/**
 * @param {Array<{fixture, truth, result, gate, error}>} runs
 * `truth` is the hand-labelled garment; null for a negative fixture that should be rejected.
 */
export function scoreCorrectness(runs) {
  const rows = runs.filter(r => r.truth && r.result?.garment);
  if (!rows.length) return { n: 0 };

  const slotHits = rows.filter(r => r.result.garment.slot === r.truth.slot).length;
  const warmthErrs = rows.map(r => Math.abs(r.result.garment.warmth - r.truth.warmth));
  const mae = warmthErrs.reduce((a, b) => a + b, 0) / warmthErrs.length;
  const within2 = warmthErrs.filter(e => e <= 2).length / warmthErrs.length;

  const flags = {};
  for (const f of FLAGS) {
    let tp = 0, fp = 0, fn = 0, hit = 0;
    for (const r of rows) {
      const p = asBool(f, r.result.garment[f]), t = asBool(f, r.truth[f]);
      if (p && t) tp++; else if (p && !t) fp++; else if (!p && t) fn++;
      if (p === t) hit++;
    }
    flags[f] = {
      accuracy: hit / rows.length,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null
    };
  }

  const corrected = rows.filter(r => r.corrected).length;

  return {
    n: rows.length,
    slotAccuracy: slotHits / rows.length,
    warmthMae: mae,
    warmthWithin2: within2,
    flags,
    correctionRate: runs.some(r => 'corrected' in r) ? corrected / rows.length : null,
    pass: {
      slotAccuracy: slotHits / rows.length >= PASS.slotAccuracy,
      warmthMae: mae <= PASS.warmthMae,
      flags: FLAGS.every(f => flags[f].accuracy >= PASS.flagAccuracy)
    }
  };
}

/**
 * Negative fixtures carry truth === null and must be rejected.
 * `evidenceChecked` is the human spot-check: { checked, matched }.
 */
export function scoreHallucination(runs, evidenceChecked = null) {
  const negatives = runs.filter(r => r.truth === null);
  const abstained = negatives.filter(r => r.gate?.verdict === 'reject').length;

  // Claims a photo cannot support. Cheap textual screen that catches the common case.
  const BANNED = /\b(merino|cashmere|gore[- ]?tex|polyester|\d{1,3}\s?%|nike|adidas|uniqlo|patagonia|zara|machine wash|dry clean)\b/i;
  const positives = runs.filter(r => r.result?.garment);
  const offenders = positives.filter(r => {
    const text = [r.result.garment.name, r.result.garment.warmth_basis, ...(r.result.visible_evidence || [])].join(' ');
    return BANNED.test(text);
  });

  return {
    negatives: negatives.length,
    abstainRate: negatives.length ? abstained / negatives.length : null,
    leaked: negatives.filter(r => r.gate?.verdict !== 'reject').map(r => r.fixture),
    unobservableClaims: offenders.length,
    offenders: offenders.map(r => r.fixture),
    evidenceMatch: evidenceChecked && evidenceChecked.checked ? evidenceChecked.matched / evidenceChecked.checked : null,
    pass: {
      abstainRate: negatives.length ? abstained / negatives.length >= PASS.abstainRate : null,
      unobservableClaims: offenders.length === 0
    }
  };
}

/**
 * Bucket predictions by stated confidence and compare with observed accuracy.
 * A field counts as correct when it matches the hand label.
 */
export function scoreCalibration(runs, bucketSize = 0.1) {
  const points = [];
  for (const r of runs) {
    if (!r.truth || !r.result?.garment || !r.result.confidence) continue;
    const g = r.result.garment, t = r.truth, c = r.result.confidence;
    points.push({ conf: c.slot, correct: g.slot === t.slot });
    points.push({ conf: c.warmth, correct: Math.abs(g.warmth - t.warmth) <= 1 });
    for (const f of FLAGS) points.push({ conf: c[f], correct: asBool(f, g[f]) === asBool(f, t[f]) });
  }
  if (!points.length) return { n: 0, buckets: [] };

  const buckets = [];
  for (let lo = 0; lo < 1; lo += bucketSize) {
    const hi = lo + bucketSize;
    const inside = points.filter(p => p.conf >= lo && (hi >= 1 ? p.conf <= hi : p.conf < hi));
    if (!inside.length) continue;
    const stated = inside.reduce((a, p) => a + p.conf, 0) / inside.length;
    const actual = inside.filter(p => p.correct).length / inside.length;
    buckets.push({ lo: round(lo), hi: round(hi), n: inside.length, stated, actual, gap: actual - stated });
  }

  // Expected calibration error: average gap, weighted by how many points sit in each bucket.
  const ece = buckets.reduce((a, b) => a + (b.n / points.length) * Math.abs(b.gap), 0);
  const worst = buckets.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a), buckets[0] || { gap: 0 });

  return {
    n: points.length,
    buckets,
    ece,
    worstGap: worst.gap,
    overconfident: buckets.filter(b => b.gap < -PASS.calibrationGap).map(b => b.lo),
    pass: { ece: ece <= PASS.calibrationGap, worstGap: Math.abs(worst.gap) <= PASS.calibrationGap }
  };
}

export function scoreAll(runs, evidenceChecked) {
  const correctness = scoreCorrectness(runs);
  const hallucination = scoreHallucination(runs, evidenceChecked);
  const calibration = scoreCalibration(runs);
  const errors = runs.filter(r => r.error).length;
  return {
    ranAt: new Date().toISOString(),
    total: runs.length,
    errors,
    correctness,
    hallucination,
    calibration,
    verdict: overallVerdict({ correctness, hallucination, calibration })
  };
}

function overallVerdict({ correctness, hallucination, calibration }) {
  const checks = [
    correctness.pass?.slotAccuracy,
    correctness.pass?.warmthMae,
    correctness.pass?.flags,
    hallucination.pass?.abstainRate,
    hallucination.pass?.unobservableClaims,
    calibration.pass?.ece
  ].filter(v => v !== null && v !== undefined);
  if (!checks.length) return 'no data';
  const failed = checks.filter(v => v === false).length;
  return failed === 0 ? 'pass' : failed <= 2 ? 'needs work' : 'fail';
}

/** Flatten runs for CSV export, one row per fixture. */
export function toCsv(runs) {
  const head = ['fixture', 'kind', 'verdict', 'name', 'slot', 'warmth', 'wind', 'water', 'dressy',
    'truth_slot', 'truth_warmth', 'conf_slot', 'conf_warmth', 'evidence', 'error'];
  const cell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [head.join(',')];
  for (const r of runs) {
    const g = r.result?.garment || {}, c = r.result?.confidence || {}, t = r.truth || {};
    lines.push([
      r.fixture, r.truth === null ? 'negative' : 'labelled', r.gate?.verdict || 'error',
      g.name, g.slot, g.warmth, g.wind, g.water, g.dressy,
      t.slot, t.warmth, c.slot, c.warmth,
      (r.result?.visible_evidence || []).join('; '), r.error || ''
    ].map(cell).join(','));
  }
  return lines.join('\n');
}

const round = n => Math.round(n * 100) / 100;
