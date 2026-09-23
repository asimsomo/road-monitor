# Road Monitor

Bay Area driving roads on a map, scored against the week's weather.

52 roads across the peninsula, the Santa Cruz mountains, the East Bay hills, the
Diablo range and the coast. On top of the map it pulls a 7-day forecast for
**each road's own location** and marks the days worth going out: no rain, and a
daytime high between 65 and 80°F.

Per-road forecasts matter more than they sound like they should. On a typical
day the coastal runs sit in fog at 64°F while San Antonio Valley, fifty miles
east, is 91°F and clear — that is a real spread seen on a single afternoon here.
One regional forecast would call that day a single thing; this map calls it
correctly for each road.

**Live: https://asimsomo.github.io/road-monitor/**

## How it works

Entirely static — no server, no API keys, nothing secret. GitHub Pages serves
the files and the browser does the rest.

| Piece | Source |
| --- | --- |
| Roads | Alpine Speed Stars' map layer, used with permission (see below) |
| Forecast | [Open-Meteo](https://open-meteo.com) — free, keyless, CORS-enabled, called from the browser |
| Basemaps | Esri Dark Gray Canvas, Esri World Imagery, OpenTopoMap — all keyless |
| Map library | Leaflet 1.9 |

The forecast is a single request covering all 52 road midpoints, cached in
`localStorage` for an hour.

## The rule

A road is a **good drive** on a given day when:

- `precipitation_sum < 0.01"` — no rain
- `65°F ≤ temperature_2m_max ≤ 80°F` — the daytime high, not the daily mean

Thresholds live in [`js/config.js`](js/config.js). Roads are coloured green for
good, blue for too cold, orange for too hot, purple for rain.

## Rebuilding the road data

Road geometry is committed, so the published site never calls anything at
runtime beyond the weather API.

```sh
node scripts/fetch-roads-kml.mjs             # refetch source, rebuild
node scripts/fetch-roads-kml.mjs --cached    # rebuild from the cached copy
```

Two details that are easy to get wrong, both learned the hard way:

- The source stores **each road twice** — once as a standalone line, and again
  inside a per-road folder beside its A/B endpoint markers. Grouping by name
  without deduplicating doubles every road (Alpine Rd reads 14.9 mi against a
  true 7.5) and draws it twice. `dedupe()` matches on endpoints in either
  direction, since repeats may be stored reversed.
- KML coordinates are `lon,lat`; Leaflet and everything else here use
  `[lat, lon]`.

### The OpenStreetMap fallback

[`scripts/fetch-roads.mjs`](scripts/fetch-roads.mjs) builds the same file from
OpenStreetMap via Overpass. It is kept as a fallback, but it is **not** the
primary source, for a specific reason: selecting ways by name inside a bounding
box cannot distinguish two different roads that share a name. It welded a
suburban arterial in Menlo Park onto Alpine Road — one 7.4 mi chain and one
7.3 mi chain, presented as a single 15.8 mi road — and attached four driveway
stubs to Highway 84. `selectLines()` mitigates this by dropping short fragments
and keeping one run, with an optional `anchor` to disambiguate, but curated
geometry beats heuristics.

Also worth knowing if you run it:

- Node's `fetch` sends no `User-Agent`, and Overpass front-ends answer anonymous
  requests with a flat `406`.
- Regional mirrors like `overpass.osm.ch` carry only their own country and
  answer `200` with zero elements for everywhere else — indistinguishable from
  "road not found" unless you are looking for it.
- The public mirrors throttle hard. Saves are incremental and `--missing` fetches
  only what is absent, so runs resume rather than restart.

[`scripts/fetch-roads-nominatim.mjs`](scripts/fetch-roads-nominatim.mjs) is a
third route, useful when Overpass is throttling. It returns a capped set of
named places rather than every matching way, so roads come back truncated
(Page Mill 7.1 mi against a true 9.4). Last resort.

## Tests

```sh
node --test scripts/geometry.test.mjs
```

Covers the stitching and measurement helpers — shuffled and reversed fragments,
disconnected fragments, along-the-road midpoints, distance accuracy.

## Running locally

ES modules need a real origin, so `file://` will not work:

```sh
python3 -m http.server 8000     # → http://localhost:8000
```

## Credits

Road selection and traced geometry come from
**[Alpine Speed Stars](https://www.alpinespeedstars.com/map/)**, used with the
owner's permission. The curation is the valuable part — one line per driving
run, with routes split the way people actually drive them (Highway 84 as two
runs, Highway 9 as four) — and it is not something a name-and-bounding-box query
reproduces.

Weather from [Open-Meteo](https://open-meteo.com) (CC-BY 4.0). Basemap
attribution is shown on the map. The OpenStreetMap fallback path produces data
© OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/).

Source code is MIT licensed — see [LICENSE](LICENSE).
