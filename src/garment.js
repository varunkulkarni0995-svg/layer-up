// Garment proposals from a photo: the schema the model must fill, the gates that
// decide whether a proposal is shown, and the mapping onto a wardrobe item.
//
// Nothing here calls a network. Everything is pure so it can be tested and so the
// eval harness scores exactly the logic the app runs.

export const SLOTS = ['base', 'mid', 'outer', 'head', 'hands', 'carry'];

export const REJECT_REASONS = {
  no_garment: "I can't find a garment here. Point the camera at one item of clothing.",
  multiple_garments: 'I can see more than one item. Shoot them one at a time — it keeps the ratings accurate.',
  too_dark: 'Too dark to make out the fabric. Try near a window, or turn a light on.',
  too_blurry: 'That came out blurry. Hold still for a second and tap to focus.',
  too_close: 'I can only see part of it. Step back so the whole garment is in frame.',
  obscured: "Something's covering part of it. Lay it flat and shoot from above."
};

// Floors below which a field is not trusted. Tuned against real data — see /eval.
export const FLOORS = { slot: 0.80, name: 0.70, warmth: 0.50, wind: 0.60, water: 0.60, dressy: 0.60 };

// Reference points used to anchor warmth when the wardrobe is too small to anchor itself.
export const WARMTH_ANCHORS = [
  { name: 'T-shirt', warmth: 1 },
  { name: 'Hoodie', warmth: 3 },
  { name: 'Overcoat', warmth: 5 },
  { name: 'Winter puffer', warmth: 7 }
];

/** JSON Schema for the model's structured output. Shared by every provider adapter. */
export const GARMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['usable', 'reject_reason', 'garment', 'confidence', 'visible_evidence', 'clarify'],
  properties: {
    usable: { type: 'boolean', description: 'False when the photo cannot support a reliable reading.' },
    reject_reason: {
      type: ['string', 'null'],
      enum: [...Object.keys(REJECT_REASONS), null],
      description: 'Required when usable is false; null otherwise.'
    },
    garment: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'slot', 'warmth', 'wind', 'water', 'dressy', 'warmth_basis'],
      properties: {
        name: { type: 'string', description: 'Short, recognisable. Colour plus item: "Navy wool overcoat".' },
        slot: { type: 'string', enum: SLOTS, description: 'base next to skin, mid over it, outer on top, head, hands, carry.' },
        warmth: { type: 'integer', minimum: 0, maximum: 10, description: 'Insulation added, on the anchors given in the prompt.' },
        wind: { type: 'number', minimum: 0, maximum: 1, description: 'How well it blocks wind. 0 none, 1 windproof shell.' },
        water: { type: 'number', minimum: 0, maximum: 1, description: 'How well it keeps rain out. 0 none, 1 waterproof.' },
        dressy: { type: 'integer', minimum: 0, maximum: 10, description: 'How formal it looks as the visible layer.' },
        warmth_basis: { type: 'string', description: 'One short line naming what in the image sets the warmth.' }
      }
    },
    confidence: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'slot', 'warmth', 'wind', 'water', 'dressy'],
      properties: Object.fromEntries(
        ['name', 'slot', 'warmth', 'wind', 'water', 'dressy'].map(k => [k, { type: 'number', minimum: 0, maximum: 1 }])
      )
    },
    visible_evidence: {
      type: 'array', items: { type: 'string' }, maxItems: 6,
      description: 'Only what is actually visible in the image. This is checked.'
    },
    clarify: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['field', 'question', 'options'],
      properties: {
        field: { type: 'string', enum: ['name', 'slot', 'warmth', 'wind', 'water', 'dressy'] },
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 3 }
      }
    }
  }
};

/** The instruction sent with every photo. Anchors come from the user's own wardrobe when it has enough items. */
export function buildPrompt(wardrobe = []) {
  const owned = wardrobe.filter(i => i.slot !== 'carry' && !i.implicit);
  const useOwn = owned.length >= 4;
  const anchors = useOwn
    ? owned.slice(0, 8).map(i => `${i.name} ${i.warmth}`).join(', ')
    : WARMTH_ANCHORS.map(a => `${a.name} ${a.warmth}`).join(', ');

  return [
    'You are rating one garment from a photograph so a layering engine can use it.',
    '',
    'Rules:',
    '1. State only what is visible in the image. Never name a brand, a fibre composition or a care instruction — none of that is reliably readable from a photo.',
    '2. If you cannot identify the garment with confidence, set usable to false and give a reject_reason. Abstaining is a correct answer.',
    '3. visible_evidence must list only things you can actually see. It is checked against the image.',
    '4. Rate warmth on this scale, where these are the reference points' + (useOwn ? " from the user's own wardrobe" : '') + `: ${anchors}.`,
    '5. Set clarify only when one field falls below confidence 0.6, and only for the single least certain field. Otherwise clarify is null.',
    '6. Confidence is per field. Category is usually certain; warmth and water resistance rarely are. Do not report a uniform score.',
    '',
    'slot: base = next to the skin, mid = worn over a base, outer = worn on top, head, hands, carry.'
  ].join('\n');
}

/** Narrow a raw model object to the schema, coercing ranges. Returns null when unusable as data. */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clampN = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const out = {
    usable: raw.usable === true,
    reject_reason: Object.prototype.hasOwnProperty.call(REJECT_REASONS, raw.reject_reason) ? raw.reject_reason : null,
    garment: null,
    confidence: null,
    visible_evidence: Array.isArray(raw.visible_evidence) ? raw.visible_evidence.filter(s => typeof s === 'string').slice(0, 6) : [],
    clarify: null
  };
  if (raw.garment && typeof raw.garment === 'object') {
    const g = raw.garment;
    out.garment = {
      name: String(g.name || '').trim().slice(0, 60),
      slot: SLOTS.includes(g.slot) ? g.slot : 'outer',
      warmth: Math.round(clampN(g.warmth, 0, 10, 3)),
      wind: clampN(g.wind, 0, 1, 0.2),
      water: clampN(g.water, 0, 1, 0.2),
      dressy: Math.round(clampN(g.dressy, 0, 10, 4)),
      warmth_basis: String(g.warmth_basis || '').trim().slice(0, 140)
    };
  }
  if (raw.confidence && typeof raw.confidence === 'object') {
    out.confidence = Object.fromEntries(
      ['name', 'slot', 'warmth', 'wind', 'water', 'dressy'].map(k => [k, clampN(raw.confidence[k], 0, 1, 0)])
    );
  }
  const c = raw.clarify;
  if (c && typeof c === 'object' && c.field && c.question && Array.isArray(c.options) && c.options.length >= 2) {
    out.clarify = { field: String(c.field), question: String(c.question).slice(0, 160), options: c.options.slice(0, 3).map(String) };
  }
  // A usable result with no garment is incoherent; treat as a failed read.
  if (out.usable && (!out.garment || !out.confidence)) return null;
  return out;
}

/**
 * Decide what the app does with a proposal.
 * Returns { verdict: 'reject' | 'ask' | 'accept', reason?, message?, clarify?, lowFields: [] }
 *
 * Two gates, deliberately. The model's own `usable` flag catches a bad photo; the
 * confidence floor on `slot` catches the case where it knows it is a garment but
 * not what kind — which produces a confident-looking entry that is useless.
 */
export function gate(result, floors = FLOORS) {
  if (!result) return { verdict: 'reject', reason: 'no_garment', message: REJECT_REASONS.no_garment, lowFields: [] };
  if (!result.usable) {
    const reason = result.reject_reason || 'no_garment';
    return { verdict: 'reject', reason, message: REJECT_REASONS[reason] || REJECT_REASONS.no_garment, lowFields: [] };
  }
  const conf = result.confidence || {};
  if ((conf.slot ?? 0) < floors.slot) {
    return { verdict: 'reject', reason: 'obscured', message: REJECT_REASONS.obscured, lowFields: ['slot'] };
  }
  const lowFields = Object.keys(floors).filter(k => k !== 'slot' && (conf[k] ?? 0) < floors[k]);
  // Warmth below its floor is flagged in the form rather than asked about — it is
  // subjective, so a question cannot settle it; the user's own slider can.
  const askable = lowFields.filter(k => k !== 'warmth');
  if (askable.length) {
    const worst = askable.reduce((a, b) => ((conf[a] ?? 0) <= (conf[b] ?? 0) ? a : b));
    const clarify = result.clarify && askable.includes(result.clarify.field)
      ? result.clarify
      : { field: worst, question: defaultQuestion(worst), options: defaultOptions(worst) };
    return { verdict: 'ask', clarify, lowFields };
  }
  return { verdict: 'accept', lowFields };
}

function defaultQuestion(field) {
  return {
    name: 'What would you call this?',
    wind: 'Does this block wind?',
    water: 'Does this keep rain out?',
    dressy: 'Could you wear this somewhere smart?'
  }[field] || 'Is that right?';
}

function defaultOptions(field) {
  return {
    wind: ['Yes', 'A bit', 'No'],
    water: ['Waterproof', 'Shower-proof', 'No'],
    dressy: ['Yes', 'Casual only']
  }[field] || ['Yes', 'No'];
}

/** Apply a clarifying answer onto the garment. */
export function applyAnswer(garment, field, answer) {
  const g = { ...garment };
  const a = String(answer).toLowerCase();
  if (field === 'wind') g.wind = a.startsWith('yes') ? 0.8 : a.startsWith('a bit') ? 0.5 : 0.1;
  else if (field === 'water') g.water = a.startsWith('water') ? 0.95 : a.startsWith('shower') ? 0.5 : 0.1;
  else if (field === 'dressy') g.dressy = a.startsWith('yes') ? 8 : 3;
  else if (field === 'name') g.name = answer;
  return g;
}

/** Turn a confirmed proposal into a wardrobe item the mapper understands. */
export function toWardrobeItem(garment, existingIds = []) {
  const base = slugify(garment.name) || 'item';
  let id = base, n = 2;
  while (existingIds.includes(id)) id = `${base}-${n++}`;
  return {
    id,
    name: garment.name,
    slot: garment.slot,
    warmth: garment.warmth,
    wind: garment.wind,
    water: garment.water,
    dressy: garment.dressy,
    addedBy: 'photo'
  };
}

export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
}

/** One row of evaluation data: what was proposed, what the user kept. */
export function diffProposal(proposed, final) {
  const fields = ['name', 'slot', 'warmth', 'wind', 'water', 'dressy'];
  const changed = fields.filter(f => {
    if (typeof proposed[f] === 'number') return Math.abs(proposed[f] - final[f]) > 1e-9;
    return proposed[f] !== final[f];
  });
  return { changed, corrected: changed.length > 0 };
}
