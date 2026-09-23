#!/usr/bin/env node
// Builds data/roads.json from the Alpine Speed Stars Google My Maps layer,
// used with the owner's permission.
//
// This is the primary source. The Overpass path (fetch-roads.mjs) selects ways
// by name inside a bounding box, which cannot tell two different roads that
// share a name apart — it welded a suburban arterial onto Alpine Road and
// dragged in driveway stubs. This layer is curated: one line per driving run,
// with routes already split the way people actually drive them (Highway 84 as
// two runs, Highway 9 as four).
//
// Geometry is dense, averaging ~54 points/mile.
//
//   node scripts/fetch-roads-kml.mjs           # refetch source, rebuild
//   node scripts/fetch-roads-kml.mjs --cached  # rebuild from the cached copy

import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lengthMi, midpointOf, boundsOf } from './fetch-roads.mjs';
import { ROADS } from './roads.config.mjs';

const run = promisify(execFile);

const SOURCE =
  'https://www.google.com/maps/d/kml?mid=1cVLs1-58vr7UuRTxNw6scjuUZUw&vps=2&ie=UTF8&msa=0&output=kml';
const CACHE = new URL('../data/source.kmz', import.meta.url);
const OUT = new URL('../data/roads.json', import.meta.url);

// Rough geographic buckets, used only for the region label in the UI.
const REGIONS = [
  { name: 'Coast', test: (lat, lon) => lon < -122.33 },
  { name: 'East Bay', test: (lat) => lat > 37.55 },
  { name: 'Diablo Range', test: (lat, lon) => lon > -121.95 },
  { name: 'Santa Cruz Mtns', test: (lat) => lat < 37.25 },
  { name: 'Peninsula', test: () => true },
];

const regionFor = ([lat, lon]) => REGIONS.find((r) => r.test(lat, lon)).name;

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');


// Carry over the hand-written blurbs from roads.config.mjs where a road matches.
// Their layer names roads in shorthand ("Mt. Hamilton Rd.", "Caleveras Rd"), so
// compare on a normalised form rather than exactly.
const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\brd\b/g, 'road')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\bmt\b/g, 'mount')
    .replace(/\bhwy\b/g, 'highway')
    .replace(/\s+/g, ' ')
    .trim();

const BLURBS = new Map(
  ROADS.filter((r) => r.blurb).map((r) => [normalise(r.name), r.blurb])
);

function blurbFor(name) {
  const key = normalise(name);
  if (BLURBS.has(key)) return BLURBS.get(key);
  // Their names often carry a section suffix ("Highway 9 Saratoga"); fall back
  // to the longest configured name that is a prefix of this one.
  let best = null;
  for (const [k, v] of BLURBS) {
    if ((key.startsWith(k) || k.startsWith(key)) && (!best || k.length > best[0].length)) {
      best = [k, v];
    }
  }
  return best?.[1];
}


// Their layer stores each road twice: once as the top-level line, and again
// inside a per-road folder next to its A/B endpoint markers. Grouping by name
// therefore doubles the geometry (Alpine Rd came out at 14.9 mi against a true
// 7.5) and would draw every road twice. Identify duplicates by their endpoints,
// in either direction, since a repeat may be stored reversed.
function dedupe(lines) {
  const seen = new Set();
  const keep = [];
  const at = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

  for (const line of lines) {
    const ends = [at(line[0]), at(line.at(-1))];
    const key = ends.slice().sort().join('|') + `|${Math.round(lengthMi(line) * 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(line);
  }
  return keep;
}

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}

async function loadKml(useCached) {
  if (!useCached || !(await exists(CACHE))) {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`source responded ${res.status}`);
    await mkdir(new URL('../data/', import.meta.url), { recursive: true });
    await writeFile(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  // A KMZ is a zip holding doc.kml. Shelling out to unzip avoids pulling in a
  // dependency just to inflate one entry.
  const { stdout } = await run('unzip', ['-p', CACHE.pathname, 'doc.kml'], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

const stripCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();

function parsePlacemarks(kml) {
  const out = [];
  for (const [, block] of kml.matchAll(/<Placemark[\s\S]*?<\/Placemark>/g).map((m) => [0, m[0]])) {
    if (!block.includes('<LineString')) continue;

    const name = stripCdata(/<name>([\s\S]*?)<\/name>/.exec(block)?.[1] ?? '');
    const coords = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(block)?.[1];
    if (!name || !coords) continue;

    // KML is lon,lat[,alt]; everything else here is [lat, lon].
    const line = coords
      .trim()
      .split(/\s+/)
      .map((tok) => tok.split(','))
      .filter((p) => p.length >= 2)
      .map(([lon, lat]) => [Math.round(+lat * 1e5) / 1e5, Math.round(+lon * 1e5) / 1e5])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    if (line.length >= 2) out.push({ name, line });
  }
  return out;
}

async function main() {
  const useCached = process.argv.includes('--cached');
  const kml = await loadKml(useCached);
  const placemarks = parsePlacemarks(kml);

  // A few runs share a name (different sections of the same route); keep them
  // as separate lines under one road rather than pretending they connect.
  const byName = new Map();
  for (const { name, line } of placemarks) {
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(line);
  }

  const roads = [];
  for (const [name, lines] of byName) {
    const usable = dedupe(lines.filter((l) => lengthMi(l) > 0.1));
    if (!usable.length) continue;

    usable.sort((a, b) => lengthMi(b) - lengthMi(a));
    const miles = usable.reduce((sum, l) => sum + lengthMi(l), 0);
    const center = midpointOf(usable[0]);

    const blurb = blurbFor(name);
    roads.push({
      id: slug(name),
      name,
      region: regionFor(center),
      ...(blurb ? { blurb } : {}),
      miles: Math.round(miles * 10) / 10,
      center,
      bounds: boundsOf(usable),
      lines: usable,
    });
  }

  roads.sort((a, b) => a.name.localeCompare(b.name));

  await writeFile(
    OUT,
    JSON.stringify(
      {
        attribution:
          'Road selection and traced geometry courtesy of Alpine Speed Stars, used with permission.',
        generated: new Date().toISOString().slice(0, 10),
        roads,
      },
      null,
      1
    )
  );

  const pts = roads.reduce((n, r) => n + r.lines.reduce((m, l) => m + l.length, 0), 0);
  const total = roads.reduce((n, r) => n + r.miles, 0);
  console.log(
    `Wrote ${roads.length} roads to data/roads.json — ` +
      `${total.toFixed(0)} mi, ${pts} points (${(pts / total).toFixed(0)}/mi)`
  );
}

main();
