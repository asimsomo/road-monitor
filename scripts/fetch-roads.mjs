#!/usr/bin/env node
// Builds data/roads.json from OpenStreetMap via the Overpass API.
//
// Run this when the road list in roads.config.mjs changes. The output is
// committed, so the published site never talks to Overpass — it just loads JSON.
//
//   node scripts/fetch-roads.mjs            # all roads
//   node scripts/fetch-roads.mjs page-mill  # just one, for iterating

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ROADS } from './roads.config.mjs';

// Mirrors, fastest first. Must be planet-wide instances — regional mirrors like
// overpass.osm.ch carry only their own country and answer 200 with zero
// elements for everywhere else, which looks like "road not found".
// overpass-api.de is frequently saturated and refuses connections, so it's last.
const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const PAUSE_MS = 3000; // be polite to a free, shared service
const USER_AGENT =
  'road-monitor/1.0 (+https://github.com/asimsomo/road-monitor) node-fetch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildQuery(road) {
  const [s, w, n, e] = road.bbox;
  const selector = road.match.ref
    ? `["ref"="${road.match.ref}"]`
    : `["name"="${road.match.name}"]`;
  return `[out:json][timeout:90];
way${selector}["highway"](${s},${w},${n},${e});
out geom;`;
}

// Two attempts per mirror, not three. A mirror that has refused twice is
// rate-limiting us, and a third try mostly buys another long backoff — with 23
// roads that compounds into a run that takes half an hour and shows nothing.
async function overpass(query) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    const host = new URL(endpoint).host;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // Required. Node's fetch sends no User-Agent of its own, and
            // Overpass front-ends answer anonymous requests with a flat 406.
            'User-Agent': USER_AGENT,
          },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(90_000),
        });
        // Overpass answers 429/504 when it is busy; backing off usually works.
        if (res.status === 429 || res.status === 504) {
          lastErr = new Error(`${host} busy (${res.status})`);
          await sleep(attempt * 4000);
          continue;
        }
        if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = new Error(`${host}: ${err.message}`);
        await sleep(attempt * 1500);
      }
    }
  }
  throw lastErr ?? new Error('every Overpass mirror failed');
}

const round = (n) => Math.round(n * 1e5) / 1e5;
const key = ([lat, lon]) => `${round(lat)},${round(lon)}`;

// Overpass returns a bag of unordered way fragments. Stitch them back into
// as few continuous lines as possible by walking shared endpoints.
export function stitch(ways) {
  const pending = ways.map((w) => w.geometry.map((g) => [g.lat, g.lon]));
  const lines = [];

  while (pending.length) {
    let chain = pending.shift();
    let extended = true;

    while (extended) {
      extended = false;
      for (let i = 0; i < pending.length; i++) {
        const seg = pending[i];
        const head = key(chain[0]);
        const tail = key(chain[chain.length - 1]);
        const segHead = key(seg[0]);
        const segTail = key(seg[seg.length - 1]);

        if (tail === segHead) chain = chain.concat(seg.slice(1));
        else if (tail === segTail) chain = chain.concat(seg.slice(0, -1).reverse());
        else if (head === segTail) chain = seg.slice(0, -1).concat(chain);
        else if (head === segHead) chain = seg.slice(1).reverse().concat(chain);
        else continue;

        pending.splice(i, 1);
        extended = true;
        break;
      }
    }
    lines.push(chain);
  }

  // Longest first, so the primary run of the road leads.
  return lines.sort((a, b) => lengthMi(b) - lengthMi(a));
}

export function lengthMi(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineMi(line[i - 1], line[i]);
  return total;
}

function haversineMi([lat1, lon1], [lat2, lon2]) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// The point we ask Open-Meteo about: the midpoint by distance travelled along
// the longest line, not the average of the coordinates. For a road shaped like
// a horseshoe the average can land somewhere the road never goes.
export function midpointOf(line) {
  const half = lengthMi(line) / 2;
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const step = haversineMi(line[i - 1], line[i]);
    if (walked + step >= half) {
      const t = step === 0 ? 0 : (half - walked) / step;
      return [
        round(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t),
        round(line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t),
      ];
    }
    walked += step;
  }
  return [round(line[0][0]), round(line[0][1])];
}

export function boundsOf(lines) {
  const flat = lines.flat();
  const lats = flat.map((p) => p[0]);
  const lons = flat.map((p) => p[1]);
  return [
    [round(Math.min(...lats)), round(Math.min(...lons))],
    [round(Math.max(...lats)), round(Math.max(...lons))],
  ];
}

const DATA_URL = new URL('../data/roads.json', import.meta.url);

async function loadExisting() {
  try {
    const raw = await readFile(DATA_URL, 'utf8');
    const roads = JSON.parse(raw).roads ?? [];
    return new Map(roads.map((r) => [r.id, r]));
  } catch {
    return new Map(); // first run, or the file is missing/corrupt
  }
}

// Merge rather than replace. Overpass is flaky enough that converging on all 23
// roads takes several passes, and `fetch-roads.mjs page-mill` must not wipe out
// the twenty-two roads it was not asked to fetch.
async function save(collected) {
  const ordered = ROADS.map((r) => collected.get(r.id)).filter(Boolean);
  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(
    DATA_URL,
    JSON.stringify(
      {
        attribution: 'Road geometry © OpenStreetMap contributors (ODbL)',
        generated: new Date().toISOString().slice(0, 10),
        roads: ordered,
      },
      null,
      1
    )
  );
}

async function main() {
  const args = process.argv.slice(2);
  const missingOnly = args.includes('--missing');
  const only = args.filter((a) => !a.startsWith('--'));

  const collected = await loadExisting();

  let targets = only.length ? ROADS.filter((r) => only.includes(r.id)) : ROADS;
  if (missingOnly) targets = targets.filter((r) => !collected.has(r.id));

  if (!targets.length) {
    console.log(
      missingOnly
        ? `Nothing missing — all ${collected.size} roads already present.`
        : `No roads matched: ${only.join(', ')}`
    );
    return;
  }
  if (collected.size) console.log(`${collected.size} road(s) already on disk.\n`);

  const problems = [];

  for (const [i, road] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${road.name} … `);
    try {
      const json = await overpass(buildQuery(road));
      const ways = (json.elements ?? []).filter((el) => el.geometry?.length > 1);

      if (!ways.length) {
        console.log('NO MATCH');
        problems.push(`${road.id}: Overpass returned no ways`);
        continue;
      }

      // Drop stubs: driveways and slip roads that share the name add noise.
      const lines = stitch(ways)
        .map((l) => l.map(([lat, lon]) => [round(lat), round(lon)]))
        .filter((l) => lengthMi(l) > 0.15);

      if (!lines.length) {
        console.log('ALL FRAGMENTS TOO SHORT');
        problems.push(`${road.id}: nothing longer than 0.15 mi`);
        continue;
      }

      const miles = lines.reduce((sum, l) => sum + lengthMi(l), 0);
      collected.set(road.id, {
        id: road.id,
        name: road.name,
        region: road.region,
        blurb: road.blurb,
        miles: Math.round(miles * 10) / 10,
        center: midpointOf(lines[0]),
        bounds: boundsOf(lines),
        lines,
      });
      console.log(
        `${lines.length} line${lines.length > 1 ? 's' : ''}, ${miles.toFixed(1)} mi`
      );
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      problems.push(`${road.id}: ${err.message}`);
    }

    // Save after every road. Overpass can be slow enough that a whole-run write
    // at the end means a long wait with nothing to look at, and an interrupted
    // run losing everything.
    await save(collected);
    if (i < targets.length - 1) await sleep(PAUSE_MS);
  }

  console.log(`\ndata/roads.json now holds ${collected.size} of ${ROADS.length} roads`);
  if (problems.length) {
    console.log('\nNeeds attention:');
    for (const p of problems) console.log('  - ' + p);
    process.exitCode = 1;
  }
}

// Only run when executed directly; importing this module (for tests) must
// not kick off a fetch.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
