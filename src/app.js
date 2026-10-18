// Layer Up NYC — screens. Milestone 1: Today, Trip, Settings on live weather. Ask arrives in milestone 3.
import { recommend, extrasThreshold, rainThreshold, ACTIVITIES, OCCASIONS } from './mapper.js';
import { fetchForecast, upcomingHours, hoursBetween, describeCode, localNowIso } from './weather.js';
import { getDeviceLocation, searchPlaces, placeLabel } from './location.js';
import { loadSettings, saveSettings, rememberPlace, DEFAULT_SETTINGS } from './store.js';

const NYC = { name: 'New York', lat: 40.7128, lon: -74.006, source: 'default' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  tab: 'today',
  settings: loadSettings(),
  place: null,
  forecast: null, fetchedAt: 0, loading: false, error: null, locNote: null,
  sel: null,                     // [start, end] indexes into upcoming hours
  sheet: null,                   // 'location'
  trip: { place: null, day: 0, hour: null, duration: 2, activity: null, occasion: 'casual', result: null, loading: false, error: null }
};

/* ---------- Formatting ---------- */
const U = () => state.settings.units;
const toUnit = c => (U().temp === 'F' ? c * 9 / 5 + 32 : c);
const fmtT = c => (c == null ? '–' : Math.round(toUnit(c)) + '°');
const fmtTU = c => (c == null ? '–' : Math.round(toUnit(c)) + (U().temp === 'F' ? '°F' : '°C'));
const fmtDiff = d => Math.round(U().temp === 'F' ? d * 9 / 5 : d);
const fmtWind = k => (k == null ? '–' : U().wind === 'mph' ? Math.round(k / 1.609) + ' mph' : Math.round(k) + ' km/h');
const fmtHour = h => (U().time === '24' ? String(h).padStart(2, '0') + ':00' : (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'));
const ago = ms => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'Just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const itemName = id => state.settings.wardrobe.find(i => i.id === id)?.name || '';
const toMapperHours = hrs => hrs.map(h => ({ time: fmtHour(h.hour), feelsC: h.feelsC, windKmh: h.windKmh, rainProb: h.rainProb }));

function save() { saveSettings(state.settings); }
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), 3200);
}
const icon = {
  pin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  chev: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  refresh: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  reset: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11a8 8 0 1 1 2.3 5.7"/><path d="M4 4v7h7"/></svg>',
  target: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F63C9" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>'
};

/* ---------- Data ---------- */
async function loadWeather() {
  if (!state.place) return;
  state.loading = true; state.error = null; render();
  try {
    state.forecast = await fetchForecast({ lat: state.place.lat, lon: state.place.lon, days: 2 });
    state.fetchedAt = Date.now();
    state.sel = null;
  } catch (e) {
    state.error = e.message || 'Something went wrong loading the weather.';
  } finally {
    state.loading = false; render();
  }
}

async function useDeviceLocation() {
  state.locNote = 'Finding your location…'; render();
  try {
    const p = await getDeviceLocation();
    const name = await placeLabel(p.lat, p.lon);
    setPlace({ name, lat: p.lat, lon: p.lon, source: 'device' });
    state.locNote = null;
  } catch (e) {
    state.locNote = e.message;
    if (!state.place) setPlace(NYC);
    else render();
  }
}

function setPlace(p) {
  state.place = p; state.sheet = null;
  state.settings.lastPlace = p;
  if (p.source !== 'default') state.settings = rememberPlace(state.settings, p);
  save(); loadWeather();
}

/* ---------- Today ---------- */
function todayModel() {
  const f = state.forecast;
  const up = upcomingHours(f, 18);
  const today = up[0]?.date;
  const restOfDayEnd = Math.max(...up.map((h, i) => (h.date === today ? i : -1)));
  const quick = [['Now', 0, 0], ['Next 3 hours', 0, Math.min(2, up.length - 1)]];
  const eve = up.map((h, i) => (h.date === today && h.hour >= 18 && h.hour <= 21 ? i : -1)).filter(i => i >= 0);
  if (eve.length >= 2) quick.push([`Evening ${fmtHour(up[eve[0]].hour)}–${fmtHour(up[eve[eve.length - 1]].hour)}`, eve[0], eve[eve.length - 1]]);
  if (restOfDayEnd >= 3) quick.push(['Rest of today', 0, restOfDayEnd]);
  return { f, up, today, restOfDayEnd, quick };
}

function renderToday() {
  const s = state;
  const head = `
    <div class="between">
      <button type="button" class="pill-btn loc-btn" data-action="open-location" aria-label="Change location">${icon.pin}<span>${esc(s.place?.name || 'Choose a place')}</span>${icon.chev}</button>
      <div class="row"><span class="updated" id="updated">${s.loading ? 'Updating…' : s.fetchedAt ? ago(s.fetchedAt) : ''}</span>
        <button type="button" class="pill-btn primary" data-action="refresh" ${s.loading ? 'disabled' : ''}>${icon.refresh}Refresh</button></div>
    </div>`;
  const note = s.locNote ? `<div class="banner info" role="status"><span>${esc(s.locNote)}</span>${s.locNote.startsWith('Finding') ? '' : '<button type="button" class="link" data-action="dismiss-note">OK</button>'}</div>` : '';
  if (s.error && !s.forecast) return head + note + `<div class="banner err" role="alert"><span>${esc(s.error)}</span><button type="button" class="link" data-action="refresh">Try again</button></div>`;
  if (!s.forecast) return head + note + `<div class="skeleton" style="height:120px"></div><div class="skeleton" style="height:96px"></div><div class="skeleton" style="height:230px"></div>`;

  const { f, up, restOfDayEnd, quick } = todayModel();
  const cur = f.current || up[0];
  const rainNow = up[0]?.rainProb ?? 0;
  const cond = describeCode(cur.code).text;
  const d = cur.feelsC - cur.tempC;
  const delta = d <= -3 ? (cur.windKmh >= 15 ? `Wind makes it feel ${Math.abs(fmtDiff(d))}° colder than it is.` : `Feels ${Math.abs(fmtDiff(d))}° colder than it is.`)
    : d >= 3 ? `Feels ${fmtDiff(d)}° warmer than it is.` : '';
  const err = s.error ? `<div class="banner err" role="alert"><span>${esc(s.error)} Showing the last forecast.</span></div>` : '';

  const sel = s.sel;
  const strip = up.slice(0, 12).map((h, i) => {
    const on = sel && i >= sel[0] && i <= sel[1];
    return `<button type="button" class="hour${i === 0 ? ' now' : ''}" data-action="pick-hour" data-i="${i}" aria-pressed="${!!on}" aria-label="${i === 0 ? 'Now' : fmtHour(h.hour)}, feels ${fmtT(h.feelsC)}">
      <span class="t">${i === 0 ? 'Now' : fmtHour(h.hour)}</span><span class="f">${fmtT(h.feelsC)}</span><span class="a">${fmtT(h.tempC)}</span><span class="r">${h.rainProb >= 10 ? h.rainProb + '%' : ''}</span></button>`;
  }).join('');
  const hint = !sel ? 'tap an hour, then another' : sel[0] === sel[1] ? 'tap a 2nd hour' : '';
  const chips = quick.map(([label, a, b]) => `<button type="button" class="chip" data-action="quick" data-a="${a}" data-b="${b}" aria-pressed="${!!(sel && sel[0] === a && sel[1] === b)}">${esc(label)}</button>`).join('');
  const acts = Object.entries(ACTIVITIES).map(([k, v]) => `<button type="button" aria-pressed="${s.settings.activity === k}" data-action="activity" data-v="${k}">${v.label.replace('Mostly inside', 'Inside')}</button>`).join('');

  // Window: selection, or rest of today (at least the next 6 hours late at night).
  let a = 0, b = restOfDayEnd >= 2 ? restOfDayEnd : Math.min(5, up.length - 1);
  if (sel) [a, b] = sel;
  const win = up.slice(a, b + 1);
  const r = recommend({ hours: toMapperHours(win), activity: s.settings.activity, occasion: 'casual', tolerance: s.settings.tolerance, wardrobe: s.settings.wardrobe });
  const label = sel ? (a === b ? (a === 0 ? 'Now' : fmtHour(win[0].hour)) : `${a === 0 ? 'Now' : fmtHour(win[0].hour)} – ${fmtHour(win[win.length - 1].hour)}`) : 'Wear today';
  const sub = sel ? `Feels ${fmtT(Math.max(...win.map(h => h.feelsC)))} → ${fmtT(Math.min(...win.map(h => h.feelsC)))}` : `Now → ${fmtHour(win[win.length - 1].hour)}`;

  return head + note + err + `
    <div class="hero">
      <div><div class="eyebrow">Feels like${cond ? ' · ' + esc(cond) : ''}</div><div class="big">${fmtT(cur.feelsC)}</div></div>
      <div class="facts"><div><span>Actual</span> <b>${fmtT(cur.tempC)}</b></div><div><span>Wind</span> <b>${fmtWind(cur.windKmh)}</b></div><div><span>Rain</span> <b>${rainNow}%</b></div></div>
    </div>
    ${delta ? `<div class="delta">${delta}</div>` : ''}
    <section aria-label="Hourly forecast" style="display:flex;flex-direction:column;gap:8px">
      <div class="between"><div class="eyebrow">Hourly · feels like</div>
        <div class="row"><span class="hint">${hint}</span>${sel ? `<button type="button" class="pill-btn" style="padding:4px 10px;min-height:30px;font-size:12px;border-color:var(--ink)" data-action="clear-sel" aria-label="Reset hour selection">${icon.reset}Reset</button>` : ''}</div></div>
      <div class="strip">${strip}</div>
      <div class="chips">${chips}</div>
    </section>
    <div class="between"><span class="eyebrow">Getting around</span></div>
    <div class="seg" role="group" aria-label="Getting around">${acts}</div>
    ${outfitCard(r, label, sub, sel ? win : null)}`;
}

function outfitCard(r, label, sub, windowHours, closable = true) {
  const o = r.outfit, W = state.settings.wardrobe;
  const warmthOf = id => W.find(i => i.id === id)?.warmth || 0;
  const rows = [
    ['Base', o.base === 'tshirt' ? 'T-shirt' : itemName(o.base), warmthOf(o.base), '#3A444F'],
    ['Mid', o.mid ? itemName(o.mid) : '—', o.mid ? warmthOf(o.mid) : 0, '#7C8792'],
    ['Outer', o.outer ? itemName(o.outer) : '—', o.outer ? warmthOf(o.outer) : 0, '#F6C343'],
    ['Extras', r.extras.length ? r.extras.map(itemName).join(' + ') : '—', r.extras.length ? 2 : 0, '#2F63C9']
  ].map(([slot, name, w, color]) => `<div class="layer"><span class="slot">${slot}</span><span class="meter"><i style="width:${Math.min(100, w * 14)}%;background:${color}"></i></span><b>${esc(name)}</b></div>`).join('');
  const tags = [
    ...r.notes.map(n => `<span class="tag${/^(Add|Wear)/.test(n) ? ' hot' : ''}">${esc(n)}</span>`),
    `<span class="tag">${r.umbrella ? `Umbrella: yes (${r.rain.maxProb}%)` : 'Umbrella: not needed'}</span>`
  ].join('');
  let detail = '';
  if (windowHours && windowHours.length > 1) {
    let prev = null;
    detail = `<div class="hours-detail">${r.perHour.map((p, i) => {
      const ex = p.extras ? 'extras' : 'none';
      const note = prev === null ? (p.extras ? 'Start with beanie + gloves' : 'Start') : ex !== prev ? (p.extras ? 'Add beanie + gloves' : 'Beanie + gloves off') : 'No change';
      const chg = prev !== null && ex !== prev; prev = ex;
      return `<div class="hd"><span>${esc(p.time)}</span><span class="fv">${fmtT(windowHours[i].feelsC)}</span><span class="${chg ? 'chg' : ''}">${note}</span></div>`;
    }).join('')}</div>`;
  }
  return `<section class="outfit" aria-label="What to wear">
    <div class="between"><span class="eyebrow">${esc(label)}</span>${windowHours && closable ? '<button type="button" class="icon-x" data-action="clear-sel" aria-label="Close window details">✕</button>' : windowHours ? '' : `<span class="sub">${esc(sub)}</span>`}</div>
    ${windowHours ? `<div class="sub">${esc(sub)}</div>` : ''}
    <h2>${esc(r.title)}</h2>
    <div class="layers">${rows}</div>
    ${detail}
    <div class="tags">${tags}</div>
  </section>`;
}

/* ---------- Location sheet ---------- */
function renderSheet() {
  const root = $('#sheet-root');
  if (state.sheet !== 'location') { root.innerHTML = ''; return; }
  const places = state.settings.places;
  root.innerHTML = `<div class="sheet-wrap" data-action="close-sheet-bg">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="locTitle">
      <div class="grab"></div>
      <div class="between"><h2 id="locTitle" style="margin:0;font-size:20px;font-weight:800">Change location</h2><button type="button" class="link" data-action="close-sheet">Done</button></div>
      <label class="sr" for="locSearch">Search a place</label>
      <div class="field"><input id="locSearch" type="search" placeholder="Search a neighborhood or city" autocomplete="off"></div>
      <div class="list" id="locResults"></div>
      <button type="button" class="pill-btn" style="justify-content:flex-start;border-radius:12px;padding:12px 14px;background:var(--bg);border:0" data-action="use-device">${icon.target}Use my current location</button>
      ${places.length ? `<div class="eyebrow">Recent</div><div class="list">${places.map((p, i) => `<button type="button" data-action="pick-recent" data-i="${i}"><span>${esc(p.name)}</span><small>${esc(p.detail || '')}</small></button>`).join('')}</div>` : ''}
    </div></div>`;
  const input = $('#locSearch');
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq, q = input.value;
      const box = $('#locResults');
      if (q.trim().length < 2) { box.innerHTML = ''; return; }
      box.innerHTML = '<p class="hint">Searching…</p>';
      try {
        const res = await searchPlaces(q);
        if (my !== seq) return;
        state._results = res;
        box.innerHTML = res.length ? res.map((p, i) => `<button type="button" data-action="pick-result" data-i="${i}"><span>${esc(p.name)}</span><small>${esc(p.detail)}</small></button>`).join('') : '<p class="hint">No places found. Try a nearby city.</p>';
      } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
    }, 350);
  });
  setTimeout(() => input.focus(), 50);
}

/* ---------- Trip ---------- */
function renderTrip() {
  const t = state.trip, s = state.settings;
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => { const d = new Date(Date.now() + i * 864e5); return [i, i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })]; });
  const nowH = new Date().getHours();
  const hour = t.hour ?? Math.min(23, nowH + 1);
  const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => t.day > 0 || h >= nowH);
  const act = t.activity || s.activity;
  const occ = Object.entries(OCCASIONS).map(([k, v]) => `<button type="button" class="chip" data-action="trip-occ" data-v="${k}" aria-pressed="${t.occasion === k}">${v.label}</button>`).join('');
  const acts = Object.entries(ACTIVITIES).map(([k, v]) => `<button type="button" aria-pressed="${act === k}" data-action="trip-act" data-v="${k}">${v.label.replace('Mostly inside', 'Inside')}</button>`).join('');
  let result = '';
  if (t.loading) result = '<div class="skeleton" style="height:240px"></div>';
  else if (t.error) result = `<div class="banner err" role="alert"><span>${esc(t.error)}</span></div>`;
  else if (t.result) {
    const { r, win, place } = t.result;
    const temps = win.map(h => h.tempC), feels = win.map(h => h.feelsC);
    const cond = describeCode(win[0].code).text;
    const label = `${place.name} · ${fmtHour(win[0].hour)}${win.length > 1 ? '–' + fmtHour(win[win.length - 1].hour) : ''}`;
    const sub = `Feels ${fmtT(Math.min(...feels))}${Math.min(...feels) !== Math.max(...feels) ? ' to ' + fmtT(Math.max(...feels)) : ''} · actual ${fmtT(Math.min(...temps))}–${fmtT(Math.max(...temps))} · wind up to ${fmtWind(Math.max(...win.map(h => h.windKmh)))}${cond ? ' · ' + cond : ''}`;
    result = outfitCard(r, label, sub, win, false);
  }
  return `<h1>Plan a trip</h1>
    <form class="card" id="tripForm" novalidate>
      <div class="field" style="position:relative"><label for="tripWhere">Where</label>
        <input id="tripWhere" type="search" autocomplete="off" placeholder="e.g. Brooklyn Bridge Park" value="${esc(t.place?.name || '')}">
        <div class="list" id="tripResults"></div></div>
      <div class="row" style="gap:10px">
        <label class="field" style="flex:1">Day<select id="tripDay">${days.map(([i, l]) => `<option value="${i}" ${t.day === i ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1">Time<select id="tripHour">${hours.map(h => `<option value="${h}" ${h === hour ? 'selected' : ''}>${fmtHour(h)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1">Outside for<select id="tripDur">${[1, 2, 3, 4].map(n => `<option value="${n}" ${t.duration === n ? 'selected' : ''}>${n} h</option>`).join('')}</select></label>
      </div>
      <div class="field">Getting there<div class="seg" role="group" aria-label="Getting there">${acts}</div></div>
      <div class="field">Occasion<div class="chips">${occ}</div></div>
      <button type="submit" class="pill-btn primary" style="justify-content:center;min-height:46px;font-size:15px">Get outfit</button>
    </form>
    ${result}`;
}

async function runTrip() {
  const t = state.trip;
  t.day = Number($('#tripDay').value); t.hour = Number($('#tripHour').value); t.duration = Number($('#tripDur').value);
  if (!t.place) { t.error = 'Pick a place from the search results first.'; t.result = null; render(); return; }
  t.loading = true; t.error = null; render();
  try {
    const f = await fetchForecast({ lat: t.place.lat, lon: t.place.lon, days: 7 });
    const base = localNowIso(f).slice(0, 10);
    const d = new Date(base + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + t.day);
    const startIso = d.toISOString().slice(0, 10) + 'T' + String(t.hour).padStart(2, '0') + ':00';
    const win = hoursBetween(f, startIso, t.duration);
    if (!win.length) throw new Error('No forecast for that time yet. Pick a time within the next 7 days.');
    const r = recommend({ hours: toMapperHours(win), activity: t.activity || state.settings.activity, occasion: t.occasion, tolerance: state.settings.tolerance, wardrobe: state.settings.wardrobe });
    t.result = { r, win, place: t.place };
    state.settings = rememberPlace(state.settings, t.place); save();
  } catch (e) { t.error = e.message; t.result = null; }
  finally { t.loading = false; render(); }
}

function wireTrip() {
  const input = $('#tripWhere'); if (!input) return;
  let timer, seq = 0;
  input.addEventListener('input', () => {
    state.trip.place = null;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const my = ++seq, q = input.value, box = $('#tripResults');
      if (q.trim().length < 2) { box.innerHTML = ''; return; }
      try {
        const res = await searchPlaces(q);
        if (my !== seq) return;
        state._tripResults = res;
        box.innerHTML = res.map((p, i) => `<button type="button" data-action="trip-place" data-i="${i}"><span>${esc(p.name)}</span><small>${esc(p.detail)}</small></button>`).join('') || '<p class="hint">No places found.</p>';
      } catch (e) { box.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
    }, 350);
  });
  $('#tripForm').addEventListener('submit', e => { e.preventDefault(); runTrip(); });
}

/* ---------- Settings ---------- */
const TOL = {
  cold: { name: 'Cold', left: 'Feel the cold', right: 'Handle the cold', effect: v => `Beanie + gloves below ${fmtTU(extrasThreshold({ cold: v }))}${v < 0 ? ', thermals sooner' : v > 0 ? ', layers later' : ''}` },
  heat: { name: 'Heat', left: 'Overheat easily', right: 'Handle the heat', effect: v => (v >= 1 ? 'When unsure, wear the warmer layer' : v <= -1 ? 'Fewer layers; easy to shed on the subway' : 'Balanced layers') },
  rain: { name: 'Rain', left: 'Hate getting wet', right: "Don't mind", effect: v => `Flag rain from ${rainThreshold({ rain: v })}% chance` }
};
const sign = v => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');

function renderSettings() {
  const s = state.settings;
  const tol = Object.entries(TOL).map(([k, d]) => `<div class="tol">
      <div class="between"><label for="tol-${k}" style="font-size:16px;font-weight:700">${d.name}</label><span class="val" id="val-${k}">${sign(s.tolerance[k])}</span></div>
      <input id="tol-${k}" type="range" min="-3" max="3" step="1" value="${s.tolerance[k]}" data-tol="${k}" aria-describedby="eff-${k}">
      <div class="ends"><span>${d.left}</span><span>${d.right}</span></div>
      <div class="effect" id="eff-${k}">${esc(d.effect(s.tolerance[k]))}</div></div>`).join('');
  const seg = (key, opts) => `<div class="seg" role="group" style="width:168px">${opts.map(([v, l]) => `<button type="button" data-action="unit" data-k="${key}" data-v="${v}" aria-pressed="${s.units[key] === v}">${l}</button>`).join('')}</div>`;
  const acts = Object.entries(ACTIVITIES).map(([k, v]) => `<button type="button" aria-pressed="${s.activity === k}" data-action="activity" data-v="${k}">${v.label.replace('Mostly inside', 'Inside')}</button>`).join('');
  const ward = s.wardrobe.filter(i => i.slot !== 'carry').map(i => `<div class="ward" data-item="${i.id}">
      <div class="between"><b>${esc(i.name)}</b><span class="hint">${esc(i.slot)}</span></div>
      <label class="sr" for="w-${i.id}">${esc(i.name)} warmth</label>
      <div class="w-range"><input id="w-${i.id}" type="range" min="0" max="10" step="1" value="${i.warmth}" data-ward="${i.id}" data-f="warmth"><span class="val" id="wv-${i.id}">${i.warmth}</span></div>
      ${['base', 'head', 'hands'].includes(i.slot) ? '' : `<div class="checks">
        <label><input type="checkbox" data-ward="${i.id}" data-f="wind" ${i.wind >= 0.5 ? 'checked' : ''}>Blocks wind</label>
        <label><input type="checkbox" data-ward="${i.id}" data-f="water" ${i.water >= 0.5 ? 'checked' : ''}>Water-resistant</label>
        <label><input type="checkbox" data-ward="${i.id}" data-f="dressy" ${i.dressy >= 6 ? 'checked' : ''}>Dressy</label></div>`}
    </div>`).join('');
  return `<h1>Settings</h1>
    <section class="card"><div class="eyebrow">How much can you take?</div>${tol}</section>
    <section class="card"><div class="eyebrow">Units</div>
      <div class="between"><b>Temperature</b>${seg('temp', [['C', '°C'], ['F', '°F']])}</div>
      <div class="between"><b>Wind</b>${seg('wind', [['kmh', 'km/h'], ['mph', 'mph']])}</div>
      <div class="between"><b>Time</b>${seg('time', [['12', '12-hour'], ['24', '24-hour']])}</div></section>
    <section class="card"><div class="eyebrow">Usually getting around by</div><div class="seg" role="group" aria-label="Usually getting around by">${acts}</div></section>
    <section class="card"><div class="between"><div class="eyebrow">My wardrobe · warmth 0–10</div><span class="hint">Umbrella: always in bag</span></div>${ward}</section>
    <section class="card"><div class="between"><span class="hint">Saved on this device. Login + sync come in milestone 2.</span>
      <button type="button" class="link" data-action="reset-all" id="resetAll" style="color:var(--bad)">Reset all</button></div></section>`;
}

function wireSettings() {
  document.querySelectorAll('[data-tol]').forEach(el => {
    const k = el.dataset.tol;
    el.addEventListener('input', () => { const v = Number(el.value); state.settings.tolerance[k] = v; $('#val-' + k).textContent = sign(v); $('#eff-' + k).textContent = TOL[k].effect(v); });
    el.addEventListener('change', save);
  });
  document.querySelectorAll('[data-ward]').forEach(el => {
    const item = state.settings.wardrobe.find(i => i.id === el.dataset.ward), f = el.dataset.f;
    if (f === 'warmth') {
      el.addEventListener('input', () => { item.warmth = Number(el.value); $('#wv-' + item.id).textContent = el.value; });
      el.addEventListener('change', save);
    } else {
      el.addEventListener('change', () => {
        if (f === 'dressy') item.dressy = el.checked ? 8 : 3; else item[f] = el.checked ? 0.8 : 0.2;
        save();
      });
    }
  });
}

/* ---------- Ask (milestone 3) ---------- */
function renderAsk() {
  return `<h1>Ask</h1>
    <section class="card"><b>Coming in milestone 3</b>
      <p class="hint" style="font-size:14px">Describe your day ("subway at 9, walking home at 5") and get an outfit, or tell it "I froze yesterday" and it will suggest a tolerance change for you to approve. Unlocked with Face ID / Touch ID.</p>
      <p class="hint" style="font-size:14px">Until then: use <b>Trip</b> for a specific plan, and adjust the sliders in <b>Settings</b>.</p></section>`;
}

/* ---------- Render + events ---------- */
function render() {
  const screen = $('#screen');
  const html = state.tab === 'today' ? renderToday() : state.tab === 'trip' ? renderTrip() : state.tab === 'ask' ? renderAsk() : renderSettings();
  screen.innerHTML = html;
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.toggleAttribute('aria-current', false));
  const cur = document.querySelector(`.tabs [data-tab="${state.tab}"]`); if (cur) cur.setAttribute('aria-current', 'page');
  if (state.tab === 'trip') wireTrip();
  if (state.tab === 'settings') wireSettings();
  renderSheet();
}

document.addEventListener('click', e => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { state.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action, i = Number(el.dataset.i);
  switch (a) {
    case 'refresh': loadWeather(); break;
    case 'open-location': state.sheet = 'location'; renderSheet(); break;
    case 'close-sheet': state.sheet = null; renderSheet(); break;
    case 'close-sheet-bg': if (e.target === el) { state.sheet = null; renderSheet(); } break;
    case 'use-device': state.sheet = null; renderSheet(); useDeviceLocation(); break;
    case 'pick-result': { const p = state._results[i]; setPlace({ name: p.name, detail: p.detail, lat: p.lat, lon: p.lon, source: 'search' }); break; }
    case 'pick-recent': { const p = state.settings.places[i]; setPlace({ ...p, source: 'recent' }); break; }
    case 'dismiss-note': state.locNote = null; render(); break;
    case 'pick-hour': {
      const cur = state.sel;
      if (!cur || cur[0] !== cur[1]) state.sel = [i, i];
      else if (cur[0] === i) state.sel = null;
      else state.sel = [Math.min(cur[0], i), Math.max(cur[0], i)];
      render(); break;
    }
    case 'quick': { const qa = Number(el.dataset.a), qb = Number(el.dataset.b); state.sel = state.sel && state.sel[0] === qa && state.sel[1] === qb ? null : [qa, qb]; render(); break; }
    case 'clear-sel': state.sel = null; render(); break;
    case 'activity': state.settings.activity = el.dataset.v; save(); render(); break;
    case 'unit': state.settings.units[el.dataset.k] = el.dataset.v; save(); render(); break;
    case 'trip-occ': state.trip.occasion = el.dataset.v; keepTripInputs(); render(); break;
    case 'trip-act': state.trip.activity = el.dataset.v; keepTripInputs(); render(); break;
    case 'trip-place': { const p = state._tripResults[i]; state.trip.place = p; $('#tripWhere').value = p.name; $('#tripResults').innerHTML = ''; break; }
    case 'reset-all':
      if (el.dataset.armed) { state.settings = JSON.parse(JSON.stringify({ ...DEFAULT_SETTINGS, places: state.settings.places, lastPlace: state.settings.lastPlace })); save(); render(); toast('Settings reset to defaults'); }
      else { el.dataset.armed = '1'; el.textContent = 'Tap again to reset'; setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = 'Reset all'; } }, 3000); }
      break;
  }
});
function keepTripInputs() {
  const d = $('#tripDay'), h = $('#tripHour'), du = $('#tripDur');
  if (d) state.trip.day = Number(d.value); if (h) state.trip.hour = Number(h.value); if (du) state.trip.duration = Number(du.value);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.sheet) { state.sheet = null; renderSheet(); } });
setInterval(() => { const u = $('#updated'); if (u && state.fetchedAt && !state.loading) u.textContent = ago(state.fetchedAt); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && state.fetchedAt && Date.now() - state.fetchedAt > 30 * 60000) loadWeather(); });

/* ---------- Start ---------- */
render();
if (state.settings.lastPlace) { state.place = state.settings.lastPlace; loadWeather(); }
else useDeviceLocation();
