// Vision client. One interface, one adapter per provider.
//
// The key belongs to the user and never leaves their browser except to go to the
// provider they chose. There is no server in this path — which is also why the
// repo can stay public.
//
// Every adapter asks for the SAME JSON Schema (garment.js) using whatever
// structured-output mechanism that provider offers, so the parsed result is
// identical regardless of which one ran.

import { GARMENT_SCHEMA, buildPrompt, normalise } from './garment.js';

export const PROVIDERS = {
  gemini: {
    label: 'Gemini',
    defaultModel: 'gemini-2.0-flash',
    keyHint: 'Starts with AIza. From aistudio.google.com',
    docs: 'https://aistudio.google.com/apikey'
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    keyHint: 'Starts with sk-. From platform.openai.com',
    docs: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    label: 'Claude',
    defaultModel: 'claude-sonnet-4-5',
    keyHint: 'Starts with sk-ant-. From console.anthropic.com',
    docs: 'https://console.anthropic.com/settings/keys'
  }
};

export class VisionError extends Error {
  constructor(message, { kind = 'unknown', status = 0, provider = '' } = {}) {
    super(message);
    this.kind = kind;            // auth | rate | network | parse | server | unknown
    this.status = status;
    this.provider = provider;
  }
}

/**
 * Analyse one garment photo.
 * @param {{ dataUrl: string, provider: string, apiKey: string, model?: string,
 *           wardrobe?: Array, signal?: AbortSignal, fetchImpl?: Function }} opts
 * @returns {Promise<{ result: object, raw: object, meta: object }>}
 */
export async function analyseGarment(opts) {
  const { dataUrl, provider, apiKey, wardrobe = [], signal } = opts;
  const model = opts.model || PROVIDERS[provider]?.defaultModel;
  const doFetch = opts.fetchImpl || globalThis.fetch;

  if (!PROVIDERS[provider]) throw new VisionError(`Unknown provider "${provider}"`, { kind: 'unknown' });
  if (!apiKey) throw new VisionError('No API key set for ' + PROVIDERS[provider].label, { kind: 'auth', provider });

  const { base64, mediaType } = splitDataUrl(dataUrl);
  const prompt = buildPrompt(wardrobe);
  const started = Date.now();

  const adapter = ADAPTERS[provider];
  const req = adapter.request({ base64, mediaType, prompt, model, apiKey });

  let res;
  try {
    res = await doFetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new VisionError('Could not reach ' + PROVIDERS[provider].label + '. Check your connection.', { kind: 'network', provider });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new VisionError(describeHttp(res.status, text, provider), {
      kind: res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate' : res.status >= 500 ? 'server' : 'unknown',
      status: res.status, provider
    });
  }

  const payload = await res.json();
  let raw;
  try {
    raw = adapter.extract(payload);
  } catch (_) {
    throw new VisionError('The model did not return the expected shape.', { kind: 'parse', provider });
  }

  const result = normalise(raw);
  if (!result) throw new VisionError('The model returned something unusable.', { kind: 'parse', provider });

  return { result, raw, meta: { provider, model, ms: Date.now() - started } };
}

/* ---------- Adapters ---------- */

const ADAPTERS = {
  // https://ai.google.dev — responseSchema forces the shape.
  gemini: {
    request({ base64, mediaType, prompt, model, apiKey }) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: {
          contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mediaType, data: base64 } }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(GARMENT_SCHEMA)
          }
        }
      };
    },
    extract(payload) {
      const text = payload?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('');
      return JSON.parse(text);
    }
  },

  // Chat Completions with a strict json_schema response format.
  openai: {
    request({ base64, mediaType, prompt, model, apiKey }) {
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: {
          model,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } }
            ]
          }],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'garment_reading', strict: false, schema: GARMENT_SCHEMA }
          }
        }
      };
    },
    extract(payload) {
      return JSON.parse(payload?.choices?.[0]?.message?.content);
    }
  },

  // Messages API. Browser calls need the explicit opt-in header; the schema rides
  // on a forced tool call, which is how this API pins an output shape.
  anthropic: {
    request({ base64, mediaType, prompt, model, apiKey }) {
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: {
          model,
          max_tokens: 1024,
          temperature: 0,
          tools: [{ name: 'record_garment', description: 'Record the reading of this garment.', input_schema: GARMENT_SCHEMA }],
          tool_choice: { type: 'tool', name: 'record_garment' },
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: prompt }
            ]
          }]
        }
      };
    },
    extract(payload) {
      const block = payload?.content?.find(b => b.type === 'tool_use');
      if (!block) throw new Error('no tool_use block');
      return block.input;
    }
  }
};

/* ---------- Helpers ---------- */

// Gemini's schema dialect is a subset: no additionalProperties, no union types,
// and enums only on strings. Translate rather than hand it JSON Schema wholesale.
export function toGeminiSchema(node) {
  if (!node || typeof node !== 'object') return node;
  const type = Array.isArray(node.type) ? node.type.find(t => t !== 'null') || 'string' : node.type;
  const out = { type: String(type).toUpperCase() };
  if (node.description) out.description = node.description;
  if (type === 'object') {
    out.properties = Object.fromEntries(Object.entries(node.properties || {}).map(([k, v]) => [k, toGeminiSchema(v)]));
    const req = (node.required || []).filter(k => out.properties[k]);
    if (req.length) out.required = req;
  } else if (type === 'array') {
    out.items = toGeminiSchema(node.items || { type: 'string' });
  } else if (type === 'string' && Array.isArray(node.enum)) {
    const vals = node.enum.filter(v => typeof v === 'string');
    if (vals.length) { out.format = 'enum'; out.enum = vals; }
  }
  return out;
}

export function splitDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
  if (!m) throw new VisionError('That image could not be read.', { kind: 'parse' });
  return { mediaType: m[1], base64: m[2] };
}

function describeHttp(status, text, provider) {
  const name = PROVIDERS[provider]?.label || provider;
  if (status === 401 || status === 403) return `${name} rejected the key. Check it in Settings.`;
  if (status === 429) return `${name} is rate limiting. Wait a moment and try again.`;
  if (status === 413) return 'That image is too large. Try again — it should have been resized.';
  if (status >= 500) return `${name} had a server error. Try again shortly.`;
  const detail = String(text || '').slice(0, 160);
  return `${name} returned ${status}${detail ? ': ' + detail : ''}`;
}

/**
 * Downscale and compress before upload. A 12MP original buys nothing and costs
 * latency and tokens on every call.
 */
export async function prepareImage(file, { maxEdge = 768, quality = 0.8 } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
}

/** Small square thumbnail kept with the wardrobe item. The original is never stored. */
export async function makeThumbnail(dataUrl, size = 160) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.7);
}
