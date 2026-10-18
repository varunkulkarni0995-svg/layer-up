// Default wardrobe. Ratings are STARTING ASSUMPTIONS until Varun confirms them;
// every value is editable in Settings and stored per user.
//
// warmth : 0–10, roughly how much insulation the item adds
// wind   : 0–1, how well it blocks wind (outer layers matter most)
// water  : 0–1, how well it keeps rain out
// dressy : 0–10, how formal it looks as the visible layer
export const DEFAULT_WARDROBE = [
  { id: 'tshirt',   name: 'T-shirt',     slot: 'base',  warmth: 1, wind: 0,   water: 0,   dressy: 3, implicit: true },
  { id: 'thermals', name: 'Thermals',    slot: 'base',  warmth: 2, wind: 0,   water: 0,   dressy: 3 },
  { id: 'hoodie',   name: 'Hoodie',      slot: 'mid',   warmth: 3, wind: 0.2, water: 0,   dressy: 2 },
  { id: 'nice',     name: 'Nice jacket', slot: 'outer', warmth: 3, wind: 0.5, water: 0.3, dressy: 8 },
  { id: 'overcoat', name: 'Overcoat',    slot: 'outer', warmth: 5, wind: 0.7, water: 0.3, dressy: 7 },
  { id: 'puffer',   name: 'Puffer',      slot: 'outer', warmth: 7, wind: 0.8, water: 0.5, dressy: 3 },
  { id: 'beanie',   name: 'Beanie',      slot: 'head',  warmth: 1, wind: 0,   water: 0,   dressy: 3 },
  { id: 'gloves',   name: 'Gloves',      slot: 'hands', warmth: 1, wind: 0,   water: 0,   dressy: 4 },
  { id: 'umbrella', name: 'Umbrella',    slot: 'carry', warmth: 0, wind: 0,   water: 1,   dressy: 5, alwaysCarried: true }
];

// Tolerance sliders run from -3 to +3 (0 = typical person).
export const DEFAULT_TOLERANCE = { heat: 2, cold: 0, rain: -3 };
