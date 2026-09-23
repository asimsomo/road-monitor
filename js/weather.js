// Talks to Open-Meteo, which is free, needs no API key and sends CORS headers —
// so the browser can call it directly and the site stays a pure static deploy.
//
// All 23 roads go out in one request: Open-Meteo accepts comma-separated
// coordinate lists and answers with one object per location, in order.

import { RULE, FORECAST_DAYS } from './config.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const CACHE_KEY = 'road-monitor:forecast:v1';
const CACHE_MS = 60 * 60 * 1000; // an hour; the forecast does not move faster

export function classify(day, rule = RULE) {
  if (day == null) return 'unknown';
  if (day.precip >= rule.rainMax) return 'wet';
  if (day.high < rule.tempMin) return 'cold';
  if (day.high > rule.tempMax) return 'hot';
  return 'good';
}

function buildUrl(roads) {
  const params = new URLSearchParams({
    latitude: roads.map((r) => r.center[0]).join(','),
    longitude: roads.map((r) => r.center[1]).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'America/Los_Angeles',
    forecast_days: String(FORECAST_DAYS),
  });
  return `${ENDPOINT}?${params}`;
}

// A single location comes back as an object, several as an array. Normalise.
const asList = (json) => (Array.isArray(json) ? json : [json]);

function readLocation(loc) {
  const d = loc?.daily;
  if (!d?.time?.length) return [];
  return d.time.map((date, i) => ({
    date,
    high: d.temperature_2m_max[i],
    low: d.temperature_2m_min[i],
    precip: d.precipitation_sum[i] ?? 0,
    precipProb: d.precipitation_probability_max[i] ?? null,
    code: d.weather_code[i],
  }));
}

function readCache(signature) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const hit = JSON.parse(raw);
    if (hit.signature !== signature) return null;
    if (Date.now() - hit.at > CACHE_MS) return null;
    return hit.payload;
  } catch {
    return null; // private browsing, quota, corrupted entry — just refetch
  }
}

function writeCache(signature, payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ signature, at: Date.now(), payload }));
  } catch {
    /* storage unavailable or full; caching is an optimisation, not a requirement */
  }
}

/**
 * @returns {Promise<{days: string[], byRoad: Record<string, object[]>, cached: boolean}>}
 */
export async function loadForecast(roads) {
  // Roads plus the local date: a cache entry must not survive into tomorrow.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const signature = `${today}|${roads.map((r) => r.id).join(',')}`;

  const cached = readCache(signature);
  if (cached) return { ...cached, cached: true };

  const res = await fetch(buildUrl(roads));
  if (!res.ok) throw new Error(`Open-Meteo responded ${res.status}`);

  const locations = asList(await res.json());
  if (locations.length !== roads.length) {
    throw new Error(`Expected ${roads.length} forecasts, got ${locations.length}`);
  }

  const byRoad = {};
  roads.forEach((road, i) => {
    byRoad[road.id] = readLocation(locations[i]);
  });

  // Every location shares the same calendar, so the first one defines the axis.
  const days = (byRoad[roads[0].id] ?? []).map((d) => d.date);
  if (!days.length) throw new Error('Open-Meteo returned no daily data');

  const payload = { days, byRoad };
  writeCache(signature, payload);
  return { ...payload, cached: false };
}

/** How many roads are drivable on each day, plus that day's temperature spread. */
export function summariseDays(roads, forecast) {
  return forecast.days.map((date, i) => {
    let good = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const road of roads) {
      const day = forecast.byRoad[road.id]?.[i];
      if (!day) continue;
      if (classify(day) === 'good') good++;
      if (day.high < min) min = day.high;
      if (day.high > max) max = day.high;
    }

    return {
      date,
      good,
      total: roads.length,
      lowHigh: Number.isFinite(min) ? Math.round(min) : null,
      highHigh: Number.isFinite(max) ? Math.round(max) : null,
    };
  });
}
