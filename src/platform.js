// Client for varun-platform: Google sign-in, access requests, the AI gateway,
// and wardrobe sync. Loaded only when the backend is configured, so the app
// keeps working on this device alone without it.
import { PLATFORM, platformReady } from './config.js';

let clientP = null;
export function client() {
  if (!platformReady()) return Promise.resolve(null);
  if (!clientP) clientP = import('https://esm.sh/@supabase/supabase-js@2.49.1').then(({ createClient }) =>
    createClient(PLATFORM.url, PLATFORM.key, { auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' } }));
  return clientP;
}

export async function session() {
  const sb = await client(); if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session || null;
}

export async function onAuthChange(fn) {
  const sb = await client(); if (!sb) return;
  sb.auth.onAuthStateChange((_e, s) => fn(s));
}

export async function signIn() {
  const sb = await client(); if (!sb) throw new Error('Server access is not set up yet.');
  const redirectTo = location.origin + location.pathname;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
  if (error) throw error;
}

export async function signOut() {
  const sb = await client(); if (sb) await sb.auth.signOut();
}

/** 'none' | 'pending' | 'approved' | 'declined' */
export async function accessStatus() {
  const sb = await client(); const s = await session(); if (!sb || !s) return 'none';
  const { data } = await sb.from('access').select('status').eq('user_id', s.user.id).eq('app', PLATFORM.app).maybeSingle();
  return data?.status || 'none';
}

export async function requestAccess(note = '') {
  const sb = await client(); const s = await session(); if (!sb || !s) throw new Error('Sign in first.');
  const row = { user_id: s.user.id, app: PLATFORM.app, email: s.user.email, name: s.user.user_metadata?.full_name || null, note: note.slice(0, 200) || null };
  const cur = await accessStatus();
  const { error } = cur === 'declined'
    ? await sb.from('access').update({ status: 'pending', note: row.note, requested_at: new Date().toISOString() }).eq('user_id', s.user.id).eq('app', PLATFORM.app)
    : await sb.from('access').insert(row);
  if (error) throw error;
  return accessStatus();
}

export class GatewayError extends Error {
  constructor(message, why, status, attempts) { super(message); this.why = why; this.status = status; this.attempts = attempts || []; }
}

/** Read a garment through the server's keys. Same result shape as readGarment(). */
export async function readGarmentViaServer({ dataUrl, wardrobe }) {
  const s = await session(); if (!s) throw new GatewayError('Sign in to use server access.', 'signed_out', 401);
  let res;
  try {
    res = await fetch(`${PLATFORM.url}/functions/v1/ai-gateway`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}`, apikey: PLATFORM.key },
      body: JSON.stringify({ app: PLATFORM.app, task: 'garment', image: dataUrl,
        wardrobe: (wardrobe || []).map(i => ({ name: i.name, slot: i.slot, warmth: i.warmth, implicit: !!i.implicit })) })
    });
  } catch (_) { throw new GatewayError("Couldn't reach the Layer Up server. Check your connection.", 'network', 0); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new GatewayError(body.message || `Server error ${res.status}`, body.why || 'unknown', res.status, body.attempts);
  return body;
}

/* ---------- wardrobe sync ---------- */
export async function loadWardrobe() {
  const sb = await client(); const s = await session(); if (!sb || !s) return null;
  const { data, error } = await sb.from('layerup_wardrobe').select('items, eval_log, updated_at').eq('user_id', s.user.id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function saveWardrobe(items, evalLog) {
  const sb = await client(); const s = await session(); if (!sb || !s) return false;
  const { error } = await sb.from('layerup_wardrobe').upsert({ user_id: s.user.id, items, eval_log: (evalLog || []).slice(-200), updated_at: new Date().toISOString() });
  if (error) throw error;
  return true;
}
