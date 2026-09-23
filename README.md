# Road Monitor

Bay Area mountain roads on a map, scored against the week's weather.

The map shows 23 of the peninsula's and East Bay's better driving roads. On top
of that it pulls a 7-day forecast for **each road's own location** and marks the
days worth going out: no rain, and a daytime high between 65 and 80°F.

Per-road forecasts matter more than they sound like they should. On a typical
summer day Tunitas Creek is fogged in at 58°F while San Antonio Valley, fifty
miles east, is 95°F and clear. A single regional forecast would call that day
one thing; the map calls it correctly for each road.

**Live: https://asimsomo.github.io/road-monitor/**

## How it works

Entirely static — no server, no API keys, nothing secret. GitHub Pages serves
the files and the browser does the rest.

| Piece | Source |
| --- | --- |
| Road geometry | OpenStreetMap, fetched once and committed to `data/roads.json` |
| Forecast | [Open-Meteo](https://open-meteo.com) — free, keyless, CORS-enabled, called from the browser |
| Basemaps | CARTO dark, Esri World Imagery, OpenTopoMap — all keyless |
| Map library | Leaflet 1.9 |

The forecast is one request covering all 23 road midpoints, cached in
`localStorage` for an hour.

## The rule

A road is a **good drive** on a given day when:

- `precipitation_sum < 0.01"` — no rain
- `65°F ≤ temperature_2m_max ≤ 80°F` — the daytime high, not the daily mean

Thresholds live in [`js/config.js`](js/config.js). Roads are coloured green for
good, blue for too cold, orange for too hot, purple for rain.

## Running it locally

ES modules need a real origin, so `file://` will not work:

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

## Refreshing the road data

Road geometry is committed, so the site never talks to Overpass at runtime.
Regenerate it only when the road list changes:

```sh
node scripts/fetch-roads.mjs             # all roads
node scripts/fetch-roads.mjs page-mill   # one road, while iterating
```

Roads are defined in [`scripts/roads.config.mjs`](scripts/roads.config.mjs) —
each entry is an OSM name or route ref plus a bounding box to keep same-named
roads elsewhere in California out of the results. The script stitches the
unordered way fragments Overpass returns back into continuous lines.

Note that the public `overpass-api.de` instance is often saturated; the script
falls through a list of mirrors. Regional mirrors are deliberately excluded —
they answer `200` with zero elements for anywhere outside their own country,
which looks exactly like "road not found".

## Roadmap

- [ ] Google Calendar integration: write good-weather days into a calendar as
      all-day events.

## Attribution & licence

Road geometry © OpenStreetMap contributors, licensed
[ODbL](https://opendatacommons.org/licenses/odbl/). Weather from Open-Meteo
(CC-BY-4.0). Basemap attribution is shown on the map.

Source code is MIT licensed — see [LICENSE](LICENSE). This is an independent
project and is not affiliated with any other site.
