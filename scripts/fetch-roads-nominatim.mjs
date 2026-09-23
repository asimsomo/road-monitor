#!/usr/bin/env node
// Fallback geometry source: Nominatim instead of Overpass.
//
// Overpass is the better tool for this job — it selects by tag and returns every
// matching way — but its public mirrors throttle aggressively, and once you are
// in the penalty box a full run takes hours. Nominatim is a different service
// with a different budget, and it returns road geometry as GeoJSON.
//
// Its usage policy allows at most 1 request/second and requires a real
// User-Agent; this script honours both. ~27 requests for 23 roads.
//
//   node scripts/fetch-roads-nominatim.mjs            # -> data/roads.nominatim.json
//   node scripts/fetch-roads-nominatim.mjs page-mill  # one road

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { ROADS } from './roads.config.mjs';
import { stitch, lengthMi, midpointOf, boundsOf } from './fetch-roads.mjs';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'road-monitor/1.0 (+https://github.com/asimsomo/road-monitor)';
const PACE_MS = 1200; // policy is 1 req/s; leave headroom
const OUT = new URL('../data/roads.nominatim.json', import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 1e5) / 1e5;

// Nominatim wants viewbox as left,top,right,bottom in lon/lat order, while the
// config stores bboxes as [south, west, north, east].
function viewbox([s, w, n, e]) {
  return `${w},${n},${e},${s}`;
}

async function search(name, road) {
  const params = new URLSearchParams({
    q: name,
    format: 'jsonv2',
    polygon_geojson: '1',
    limit: '40',
    viewbox: viewbox(road.bbox),
    bounded: '1',
  });

  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  return res.json();
}

// GeoJSON is [lon, lat]; Leaflet and the rest of this project use [lat, lon].
function toLines(geojson) {
  if (!geojson) return [];
  if (geojson.type === 'LineString') return [geojson.coordinates];
  if (geojson.type === 'MultiLineString') return geojson.coordinates;
  return []; // points and polygons are not roads
}

const inBox = ([lat, lon], [s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e;

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = only.length ? ROADS.filter((r) => only.includes(r.id)) : ROADS;

  const out = [];
  const problems = [];

  for (const [i, road] of targets.entries()) {
    const names = road.searchNames ?? [road.match.name];
    process.stdout.write(`[${i + 1}/${targets.length}] ${road.name} … `);

    const fragments = [];
    for (const name of names) {
      try {
        for (const hit of await search(name, road)) {
          for (const coords of toLines(hit.geojson)) {
            const line = coords.map(([lon, lat]) => [round(lat), round(lon)]);
            // bounded=1 filters by result centre, so a long way can still spill
            // well outside the box. Keep only what actually lies inside.
            if (line.filter((p) => inBox(p, road.bbox)).length >= 2) fragments.push(line);
          }
        }
      } catch (err) {
        problems.push(`${road.id} (${name}): ${err.message}`);
      }
      await sleep(PACE_MS);
    }

    if (!fragments.length) {
      console.log('NO MATCH');
      problems.push(`${road.id}: no geometry returned`);
      continue;
    }

    const lines = stitch(fragments.map((f) => ({ geometry: f.map(([lat, lon]) => ({ lat, lon })) })))
      .filter((l) => lengthMi(l) > 0.15);

    if (!lines.length) {
      console.log('ALL FRAGMENTS TOO SHORT');
      problems.push(`${road.id}: nothing longer than 0.15 mi`);
      continue;
    }

    const miles = lines.reduce((sum, l) => sum + lengthMi(l), 0);
    out.push({
      id: road.id,
      name: road.name,
      region: road.region,
      blurb: road.blurb,
      miles: Math.round(miles * 10) / 10,
      center: midpointOf(lines[0]),
      bounds: boundsOf(lines),
      lines,
    });
    console.log(`${lines.length} line(s), ${miles.toFixed(1)} mi`);
  }

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        attribution: 'Road geometry © OpenStreetMap contributors (ODbL), via Nominatim',
        generated: new Date().toISOString().slice(0, 10),
        roads: out,
      },
      null,
      1
    )
  );

  console.log(`\nWrote ${out.length}/${targets.length} roads to data/roads.nominatim.json`);
  if (problems.length) {
    console.log('\nNeeds attention:');
    for (const p of problems) console.log('  - ' + p);
  }
}

main();
