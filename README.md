# Layer Up NYC

What to wear today, based on how the weather **feels**, how you're getting around, and how much cold, heat and rain you can take.

## Status

| Milestone | Scope | Status |
|---|---|---|
| 1 | Mapper, live weather, device location, Outfit / Trip / Settings | Done |
| 2 | Supabase: Google login (owner only), profile + wardrobe sync, 10-day activity log | Next |
| 3 | Ask chat via Supabase Edge Function + Gemini, unlocked with a passkey (Face ID / Touch ID) | Planned |

## How it decides

1. **Weather** (Open-Meteo, hourly): feels-like temperature, wind, rain chance.
2. **Warmth needed** per hour = how far feels-like is below a comfortable 20°C, adjusted for your cold tolerance and how you travel (subway is warmer, biking adds wind).
3. **Mapper** picks one item per layer (base, mid, outer) so warmth adds up to what's needed, with rules:
   - beanie + gloves below `6 − 2 × cold tolerance` °C
   - rain above your threshold → umbrella (or a water-resistant outer on a bike)
   - strong wind on a cold day → wind-blocking outer
   - dressy occasions → dressy visible layer, no hoodie
   - heat tolerance sets how much extra warmth is acceptable
4. For a time window it dresses for the coldest hour and says when to add layers.

No AI is used to choose clothes: same input, same answer, instantly and for free.

## Run locally

ES modules need a web server (opening the file directly won't load them):

```
python3 -m http.server 8000
# open http://localhost:8000
```

Location access needs `https` or `localhost`.

## Tests

```
npm test        # 61 unit tests: mapper, weather, location, settings
```

## Data

- Weather: [Open-Meteo](https://open-meteo.com) (free, no key)
- Place search: Open-Meteo geocoding
- Neighbourhood names: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (Nominatim)
- Settings are saved in this browser until milestone 2.
