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
npm test        # 63 unit tests: mapper, weather, location, settings
```

## Data

- Weather: [Open-Meteo](https://open-meteo.com) (free, no key)
- Place search (type-as-you-go, biased to your location): [Photon](https://photon.komoot.io) on OpenStreetMap data; Open-Meteo geocoding as a fallback
- Your location: the browser's Geolocation API (the OS location service: GPS on phones, Wi-Fi on laptops)
- Neighbourhood names: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (Nominatim)
- Settings are saved in this browser until milestone 2.

## Add a garment by photo (v0.2)

Photograph a garment; a vision model proposes its name, layer slot, warmth and
properties; you confirm or correct before anything is saved.

- **Bring your own key.** Gemini, OpenAI or Claude, set in Settings. It lives in
  your browser and goes nowhere but the provider you picked — which is why this
  repo can stay public and why there is no server in the path.
- **The model proposes, you decide.** Nothing is written to the wardrobe until you
  press Save. Every AI-proposed field is badged until you touch it.
- **Warmth is treated as a guess.** It is rated against your own wardrobe once you
  own four items, against fixed anchors before that. It is your scale, so the
  slider is yours to move.
- **A bad photo is refused with a reason**, not a silent guess. An uncertain field
  raises one question, never a conversation.

### Evals

`/eval.html` runs the same `VisionClient` the app uses — not a reimplementation, so
prompt and schema changes are picked up automatically. Add fixture photos, label
them by hand, add a few with no garment at all, then Run.

It scores three things:

| | What it answers |
| --- | --- |
| Correctness | Slot accuracy, warmth error, per-flag precision and recall |
| Hallucination | Does it abstain on negatives; does it claim what a photo cannot show |
| Calibration | Does a stated confidence of 0.9 mean 90% |

Calibration is what makes the other two actionable: the confidence floors in
`garment.js` are only meaningful if the scores are. If a bucket is badly off,
move the floors before touching the prompt.

Every call spends your own credits, so nothing runs until you press Run.
