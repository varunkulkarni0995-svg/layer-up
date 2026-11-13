// Eval harness. Deliberately part of the app rather than a standalone script:
// it imports the same vision.js and garment.js the product runs, so a prompt or
// schema change is reflected here automatically. A separate script would drift
// and the numbers would quietly stop meaning anything.
//
// Nothing runs until you press Run — it spends your API credits.

import { analyseGarment, prepareImage, PROVIDERS, VisionError } from './vision.js';
import { gate, SLOTS } from './garment.js';
import { scoreAll, toCsv, PASS } from './evals.js';
import { loadSettings, saveSettings } from './store.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FIXKEY = 'layerup.evalfixtures.v1';

const state = {
  settings: loadSettings(),
  fixtures: loadFixtures(),   // { id, name, dataUrl, truth|null }
  runs: [],
  running: false,
  progress: 0,
  report: null
};

function loadFixtures() {
  try { return JSON.parse(localStorage.getItem(FIXKEY)) || []; } catch (_) { return []; }
}
function saveFixtures() {
  try { localStorage.setItem(FIXKEY, JSON.stringify(state.fixtures)); } catch (e) { alert('Could not save fixtures — browser storage is full. Remove a few.'); }
}

/* ---------- Render ---------- */

function render() {
  const s = state.settings, p = s.provider, hasKey = !!(s.aiKeys || {})[p];
  const labelled = state.fixtures.filter(f => f.truth).length;
  const negatives = state.fixtures.filter(f => f.truth === null).length;

  $('#root').innerHTML = `
    <section class="card">
      <div class="between"><div class="eyebrow">Provider</div>
        <span class="hint">${hasKey ? esc(PROVIDERS[p].label) + ' key found' : 'No key — set one in the app'}</span></div>
      <div class="seg" role="group" style="width:100%">${Object.entries(PROVIDERS).map(([k, v]) =>
        `<button type="button" data-act="provider" data-v="${k}" aria-pressed="${p === k}">${v.label}</button>`).join('')}</div>
      <p class="hint" style="font-size:13px;margin:0">Model: ${esc((s.aiModels || {})[p] || PROVIDERS[p].defaultModel)}</p>
    </section>

    <section class="card">
      <div class="between"><div class="eyebrow">Fixtures</div>
        <span class="hint">${labelled} labelled · ${negatives} negative</span></div>
      <p class="hint" style="font-size:13px;margin:0">
        Add photos of garments you own and label each one by hand — that label is the ground truth.
        Add photos with <b>no</b> garment in them as negatives: the model must refuse those.
      </p>
      <label class="sr" for="fxFiles">Add fixture photos</label>
      <input id="fxFiles" type="file" accept="image/*" multiple>
      ${state.fixtures.length ? `<div class="fixtures">${state.fixtures.map(fixtureCard).join('')}</div>
        <button type="button" class="link" data-act="clear-fx" style="color:var(--bad)">Remove all fixtures</button>` : ''}
    </section>

    <section class="card">
      <div class="between"><div class="eyebrow">Run</div>
        <span class="hint">${state.running ? `${state.progress} / ${state.fixtures.length}` : `${state.fixtures.length} calls`}</span></div>
      <p class="hint" style="font-size:13px;margin:0">One API call per fixture, on your key. Nothing runs until you press this.</p>
      <button type="button" class="pill-btn primary" data-act="run"
        ${!hasKey || !state.fixtures.length || state.running ? 'disabled' : ''}
        style="width:100%;justify-content:center">${state.running ? 'Running…' : 'Run evals'}</button>
      ${state.running ? `<div class="bar"><i style="width:${Math.round(100 * state.progress / Math.max(1, state.fixtures.length))}%"></i></div>` : ''}
    </section>

    ${state.report ? reportView(state.report) : ''}
    ${state.runs.length ? runsTable(state.runs) : ''}`;

  const files = $('#fxFiles');
  if (files) files.addEventListener('change', () => addFixtures([...files.files]));
  document.querySelectorAll('[data-fx]').forEach(el => {
    const f = state.fixtures.find(x => x.id === el.dataset.fx);
    el.addEventListener('change', () => {
      const field = el.dataset.f;
      if (field === 'kind') {
        f.truth = el.value === 'negative' ? null : (f.truth || { slot: 'outer', warmth: 5, wind: 0.2, water: 0.2, dressy: 4 });
      } else if (f.truth) {
        f.truth[field] = field === 'slot' ? el.value : Number(el.value);
      }
      saveFixtures(); render();
    });
  });
}

function fixtureCard(f) {
  const t = f.truth;
  const opt = (v, cur) => `<option value="${v}"${cur === v ? ' selected' : ''}>${v}</option>`;
  return `<div class="fx">
    <img src="${f.dataUrl}" alt="">
    <select data-fx="${f.id}" data-f="kind">
      ${opt('labelled', t ? 'labelled' : '')}${opt('negative', t ? '' : 'negative')}
    </select>
    ${t ? `
      <select data-fx="${f.id}" data-f="slot">${SLOTS.filter(x => x !== 'carry').map(x => opt(x, t.slot)).join('')}</select>
      <label class="sr" for="w-${f.id}">warmth</label>
      <input id="w-${f.id}" type="number" min="0" max="10" value="${t.warmth}" data-fx="${f.id}" data-f="warmth" title="warmth 0-10">
      <input type="number" min="0" max="1" step="0.1" value="${t.wind}" data-fx="${f.id}" data-f="wind" title="wind 0-1">
      <input type="number" min="0" max="1" step="0.1" value="${t.water}" data-fx="${f.id}" data-f="water" title="water 0-1">
      <input type="number" min="0" max="10" value="${t.dressy}" data-fx="${f.id}" data-f="dressy" title="dressy 0-10">`
      : '<p class="hint" style="font-size:11px;margin:4px 0 0">Must be refused</p>'}
  </div>`;
}

function reportView(r) {
  const c = r.correctness, h = r.hallucination, k = r.calibration;
  const mark = v => (v === null || v === undefined ? '<span class="hint">—</span>' : v ? '<span class="ok">pass</span>' : '<span class="bad">fail</span>');
  const pct = v => (v === null || v === undefined ? '—' : (v * 100).toFixed(0) + '%');

  return `<section class="card">
    <div class="between"><div class="eyebrow">Result</div>
      <span class="verdict ${r.verdict === 'pass' ? 'ok' : 'bad'}">${esc(r.verdict)}</span></div>
    <table>
      <tr><th>Metric</th><th class="num">Value</th><th class="num">Bar</th><th></th></tr>
      <tr><td>Layer slot accuracy</td><td class="num">${pct(c.slotAccuracy)}</td><td class="num">≥ ${pct(PASS.slotAccuracy)}</td><td>${mark(c.pass?.slotAccuracy)}</td></tr>
      <tr><td>Warmth mean error</td><td class="num">${c.warmthMae?.toFixed(2) ?? '—'}</td><td class="num">≤ ${PASS.warmthMae}</td><td>${mark(c.pass?.warmthMae)}</td></tr>
      <tr><td>Warmth within 2</td><td class="num">${pct(c.warmthWithin2)}</td><td class="num">—</td><td></td></tr>
      ${['wind', 'water', 'dressy'].map(f => `<tr><td>${f} accuracy</td><td class="num">${pct(c.flags?.[f]?.accuracy)}</td><td class="num">≥ ${pct(PASS.flagAccuracy)}</td><td>${mark(c.flags?.[f]?.accuracy >= PASS.flagAccuracy)}</td></tr>`).join('')}
      <tr><td>Abstained on negatives</td><td class="num">${pct(h.abstainRate)}</td><td class="num">100%</td><td>${mark(h.pass?.abstainRate)}</td></tr>
      <tr><td>Unobservable claims</td><td class="num">${h.unobservableClaims}</td><td class="num">0</td><td>${mark(h.pass?.unobservableClaims)}</td></tr>
      <tr><td>Calibration error (ECE)</td><td class="num">${k.ece?.toFixed(3) ?? '—'}</td><td class="num">≤ ${PASS.calibrationGap}</td><td>${mark(k.pass?.ece)}</td></tr>
      <tr><td>Call errors</td><td class="num">${r.errors}</td><td class="num">0</td><td>${mark(r.errors === 0)}</td></tr>
    </table>
    ${h.leaked?.length ? `<p class="hint"><b class="bad">Leaked:</b> ${h.leaked.map(esc).join(', ')} — a negative fixture produced a confident reading.</p>` : ''}
    ${h.offenders?.length ? `<p class="hint"><b class="bad">Unobservable:</b> ${h.offenders.map(esc).join(', ')}</p>` : ''}
    ${k.buckets?.length ? `<div class="eyebrow" style="margin-top:8px">Calibration</div>
      <table><tr><th>Stated</th><th class="num">n</th><th class="num">Actual</th><th class="num">Gap</th></tr>
      ${k.buckets.map(b => `<tr><td>${b.lo.toFixed(1)}–${b.hi.toFixed(1)}</td><td class="num">${b.n}</td>
        <td class="num">${pct(b.actual)}</td><td class="num ${Math.abs(b.gap) > PASS.calibrationGap ? 'bad' : ''}">${(b.gap * 100).toFixed(0)}</td></tr>`).join('')}</table>
      <p class="hint" style="font-size:13px">A negative gap means over-confidence. If a bucket is badly off, move the floors in <code>garment.js</code> before touching the prompt.</p>` : ''}
    <button type="button" class="pill-btn" data-act="csv" style="width:100%;justify-content:center">Download CSV</button>
  </section>`;
}

function runsTable(runs) {
  return `<section class="card"><div class="eyebrow">Per fixture</div>
    <table><tr><th>Fixture</th><th>Verdict</th><th>Read as</th><th class="num">Warmth</th><th>Evidence</th></tr>
    ${runs.map(r => `<tr>
      <td>${esc(r.fixture)}${r.truth === null ? ' <span class="hint">(neg)</span>' : ''}</td>
      <td class="${r.truth === null ? (r.gate?.verdict === 'reject' ? 'ok' : 'bad') : ''}">${esc(r.error ? 'error' : r.gate?.verdict || '—')}</td>
      <td>${esc(r.result?.garment?.name || r.gate?.reason || r.error || '—')}</td>
      <td class="num">${r.result?.garment ? r.result.garment.warmth + (r.truth ? ` (${r.truth.warmth})` : '') : '—'}</td>
      <td class="hint">${esc((r.result?.visible_evidence || []).join(', '))}</td>
    </tr>`).join('')}</table></section>`;
}

/* ---------- Actions ---------- */

async function addFixtures(files) {
  for (const file of files) {
    try {
      const { dataUrl } = await prepareImage(file, { maxEdge: 768 });
      state.fixtures.push({
        id: 'fx' + Math.random().toString(36).slice(2, 8),
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 32),
        dataUrl,
        truth: { slot: 'outer', warmth: 5, wind: 0.2, water: 0.2, dressy: 4 }
      });
    } catch (_) { /* skip unreadable file */ }
  }
  saveFixtures(); render();
}

async function runAll() {
  const s = state.settings, provider = s.provider;
  state.running = true; state.progress = 0; state.runs = []; state.report = null; render();

  for (const f of state.fixtures) {
    const run = { fixture: f.name, truth: f.truth, result: null, gate: null, error: null };
    try {
      const { result, meta } = await analyseGarment({
        dataUrl: f.dataUrl, provider,
        apiKey: (s.aiKeys || {})[provider],
        model: (s.aiModels || {})[provider] || undefined,
        wardrobe: s.wardrobe
      });
      run.result = result; run.meta = meta; run.gate = gate(result);
    } catch (e) {
      run.error = e instanceof VisionError ? e.message : String(e?.message || e);
      // A refusal that surfaces as an error still counts as not-accepting a negative.
      run.gate = { verdict: 'reject', reason: 'error' };
      if (e?.kind === 'auth') { state.runs.push(run); break; }
    }
    state.runs.push(run);
    state.progress++;
    render();
  }

  state.running = false;
  state.report = scoreAll(state.runs);
  render();
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act;
  if (a === 'provider') { state.settings.provider = el.dataset.v; saveSettings(state.settings); render(); }
  if (a === 'run') runAll();
  if (a === 'clear-fx') { state.fixtures = []; saveFixtures(); state.runs = []; state.report = null; render(); }
  if (a === 'csv') {
    const blob = new Blob([toCsv(state.runs)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url; a2.download = `layerup-eval-${new Date().toISOString().slice(0, 10)}.csv`; a2.click();
    URL.revokeObjectURL(url);
  }
});

render();
