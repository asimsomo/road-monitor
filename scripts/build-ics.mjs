#!/usr/bin/env node
// Writes road-monitor.ics — a subscribable calendar of good driving days.
//
// An area earns an all-day event when at least 75% of its roads qualify that
// day (no rain, daytime high 65-80F). Areas rather than single roads, because
// you do not drive to a region for one road.
//
// The forecast moves, so this is regenerated daily by
// .github/workflows/update-forecast.yml and committed. No credentials are
// involved anywhere: subscribers just read a static file over HTTPS.
//
//   node scripts/build-ics.mjs
//   node scripts/build-ics.mjs --dry-run   # print a summary, write nothing

import { writeFile, readFile } from 'node:fs/promises';
import { classify } from '../js/weather.js';
import { RULE, FORECAST_DAYS } from '../js/config.js';
import { AREAS, UNSCORED, THRESHOLD, required, validateAreas } from './areas.config.mjs';

const OUT = new URL('../road-monitor.ics', import.meta.url);
const SITE = 'https://asimsomo.github.io/road-monitor/';
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

async function fetchForecast(roads) {
  const params = new URLSearchParams({
    latitude: roads.map((r) => r.center[0]).join(','),
    longitude: roads.map((r) => r.center[1]).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'America/Los_Angeles',
    forecast_days: String(FORECAST_DAYS),
  });

  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

  const locations = await res.json();
  const list = Array.isArray(locations) ? locations : [locations];
  if (list.length !== roads.length) {
    throw new Error(`Expected ${roads.length} forecasts, got ${list.length}`);
  }

  const byRoad = new Map();
  roads.forEach((road, i) => {
    const d = list[i].daily;
    byRoad.set(
      road.id,
      d.time.map((date, j) => ({
        date,
        high: d.temperature_2m_max[j],
        low: d.temperature_2m_min[j],
        precip: d.precipitation_sum[j] ?? 0,
        precipProb: d.precipitation_probability_max[j] ?? null,
      }))
    );
  });

  return { days: list[0].daily.time, byRoad };
}

// ── RFC 5545 plumbing ───────────────────────────────────────────────────────

// Backslash, semicolon and comma are delimiters in ICS text values, and a
// literal newline ends the property — all four must be escaped or the feed
// silently breaks in some clients and hard-fails in others.
const escapeText = (s) =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');

// Content lines are limited to 75 octets, continued with a leading space.
// Fold on bytes rather than characters so multi-byte text cannot be split
// mid-character.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const parts = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not cut a UTF-8 sequence in half: 0b10xxxxxx is a continuation byte.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }

  return parts.join('\r\n ');
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateValue = (iso) => iso.replace(/-/g, '');

function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

// ── Build ───────────────────────────────────────────────────────────────────

function scoreArea(area, roads, forecast, dayIndex) {
  const members = area.roads.map((id) => roads.find((r) => r.id === id)).filter(Boolean);

  const good = [];
  let min = Infinity;
  let max = -Infinity;

  for (const road of members) {
    const day = forecast.byRoad.get(road.id)?.[dayIndex];
    if (!day) continue;
    if (classify(day) === 'good') good.push({ road, day });
    min = Math.min(min, day.high);
    max = Math.max(max, day.high);
  }

  return {
    good,
    total: members.length,
    need: required(area),
    qualifies: good.length >= required(area),
    spread: Number.isFinite(min) ? [Math.round(min), Math.round(max)] : null,
  };
}

function buildEvent(area, score, date, now) {
  const roads = score.good
    .map(({ road, day }) => `${road.name} (${Math.round(day.high)}F)`)
    .sort()
    .join('\n');

  const description =
    `${score.good.length} of ${score.total} roads in ${area.name} are good drives.\n\n` +
    `${roads}\n\n` +
    `Rule: no rain, daytime high ${RULE.tempMin}-${RULE.tempMax}F.\n${SITE}`;

  return [
    'BEGIN:VEVENT',
    `UID:${area.id}-${dateValue(date)}@asimsomo.github.io`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART;VALUE=DATE:${dateValue(date)}`,
    `DTEND;VALUE=DATE:${dateValue(nextDay(date))}`,
    `SUMMARY:${escapeText(`Good drive: ${area.name} (${score.good.length}/${score.total})`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `URL:${SITE}`,
    'TRANSP:TRANSPARENT', // a good drive day should not mark you busy
    'END:VEVENT',
  ];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const roads = JSON.parse(
    await readFile(new URL('../data/roads.json', import.meta.url), 'utf8')
  ).roads;

  const problems = validateAreas(roads);
  if (problems.length) {
    console.error('Area configuration does not match data/roads.json:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }

  const forecast = await fetchForecast(roads);
  // Timestamp is fixed per run so a re-run with identical results produces an
  // identical file, and the daily commit is a genuine no-op when nothing moved.
  const now = new Date();

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Road Monitor//Bay Area driving weather//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Road Monitor — good drive days',
    'X-WR-CALDESC:Days when at least 75% of an area\'s roads are good drives',
    'X-WR-TIMEZONE:America/Los_Angeles',
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];

  let events = 0;
  const summary = [];

  for (const [i, date] of forecast.days.entries()) {
    const row = [date];
    for (const area of AREAS) {
      const score = scoreArea(area, roads, forecast, i);
      row.push(`${area.name} ${score.good.length}/${score.total}${score.qualifies ? ' *' : ''}`);
      if (score.qualifies) {
        lines.push(...buildEvent(area, score, date, now));
        events++;
      }
    }
    summary.push(row);
  }

  lines.push('END:VCALENDAR');
  const ics = lines.map(fold).join('\r\n') + '\r\n';

  console.log(`Areas (threshold ${Math.round(THRESHOLD * 100)}%, * = qualifies)`);
  for (const row of summary) console.log('  ' + row.join('   '));
  console.log(`\n${events} event(s) across ${forecast.days.length} days`);
  console.log(`${UNSCORED.length} road(s) excluded from scoring: ${UNSCORED.join(', ')}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing written');
    return;
  }

  await writeFile(OUT, ics);
  console.log(`\nWrote road-monitor.ics (${ics.length} bytes)`);
}

main();
