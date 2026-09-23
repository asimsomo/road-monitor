import { RULE, BASEMAPS, CATEGORY_COLORS, CATEGORY_LABELS } from './config.js';
import { loadForecast, summariseDays, classify } from './weather.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  roads: [],
  forecast: null,
  summary: [],
  selected: 0,
  layers: new Map(), // road id -> { casing: Polyline[], line: Polyline[] }
};

// ── Formatting ──────────────────────────────────────────────────────────────

// Dates arrive as plain YYYY-MM-DD. Parsing that with `new Date(str)` would read
// it as UTC and shift the weekday for anyone west of Greenwich, so split it.
function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const dow = (iso) => parseDay(iso).toLocaleDateString('en-US', { weekday: 'short' });
const monthDay = (iso) => parseDay(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const temp = (n) => (n == null ? '—' : `${Math.round(n)}°`);

function precipText(day) {
  if (day.precip >= RULE.rainMax) return `${day.precip.toFixed(2)}"`;
  if (day.precipProb != null && day.precipProb >= 40) return `${day.precipProb}%`;
  return '—';
}

// ── Map ─────────────────────────────────────────────────────────────────────

const map = L.map('map', { zoomControl: false, preferCanvas: true, attributionControl: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);

const casingPane = map.createPane('casings');
casingPane.style.zIndex = 399; // just under Leaflet's default overlay pane

let activeTiles = null;

function setBasemap(name) {
  const spec = BASEMAPS[name];
  if (!spec) return;
  if (activeTiles) map.removeLayer(activeTiles);
  activeTiles = L.tileLayer(spec.url, spec.options).addTo(map);

  for (const button of document.querySelectorAll('[data-basemap]')) {
    button.classList.toggle('is-active', button.dataset.basemap === name);
  }
}

function drawRoads() {
  for (const road of state.roads) {
    const casing = [];
    const line = [];

    for (const coords of road.lines) {
      // A dark casing underneath keeps the roads readable over satellite imagery.
      casing.push(
        L.polyline(coords, {
          pane: 'casings',
          color: '#05070a',
          weight: 7,
          opacity: 0.55,
          interactive: false,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map)
      );

      const poly = L.polyline(coords, {
        color: CATEGORY_COLORS.unknown,
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      poly.on('click', () => openRoad(road));
      poly.on('mouseover', () => highlight(road.id, true));
      poly.on('mouseout', () => highlight(road.id, false));
      line.push(poly);
    }

    state.layers.set(road.id, { casing, line });
  }

  const all = state.roads.flatMap((r) => r.lines.flat());
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [60, 60] });
}

function highlight(roadId, on) {
  const layers = state.layers.get(roadId);
  if (!layers) return;
  for (const poly of layers.line) poly.setStyle({ weight: on ? 7 : poly.options._baseWeight ?? 4 });
}

function paintRoads() {
  state.roads.forEach((road) => {
    const day = state.forecast?.byRoad[road.id]?.[state.selected];
    const category = classify(day);
    const weight = category === 'good' ? 5 : 3.5;

    for (const poly of state.layers.get(road.id)?.line ?? []) {
      poly.options._baseWeight = weight;
      poly.setStyle({
        color: CATEGORY_COLORS[category],
        weight,
        opacity: category === 'good' ? 1 : 0.72,
      });
    }
  });
}

function openRoad(road) {
  const week = state.forecast?.byRoad[road.id] ?? [];

  const rows = week
    .map((day, i) => {
      const cat = classify(day);
      const cls = [cat === 'good' ? 'is-good' : '', i === state.selected ? 'is-selected' : '']
        .filter(Boolean)
        .join(' ');
      return `<tr class="${cls}"><td>${dow(day.date)}</td><td>${temp(day.high)}</td><td>${temp(
        day.low
      )}</td><td>${precipText(day)}</td></tr>`;
    })
    .join('');

  const table = rows
    ? `<table><thead><tr><th>Day</th><th>High</th><th>Low</th><th>Rain</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="pop-blurb">No forecast available.</p>';

  const html = `<div class="pop">
    <h3>${road.name}</h3>
    <p class="pop-sub">${road.region} · ${road.miles} mi</p>
    ${road.blurb ? `<p class="pop-blurb">${road.blurb}</p>` : ''}
    ${table}
  </div>`;

  const bounds = L.latLngBounds(road.bounds);
  L.popup({ maxWidth: 300, autoPanPadding: [20, 150] })
    .setLatLng(bounds.getCenter())
    .setContent(html)
    .openOn(map);
}

// ── Day strip ───────────────────────────────────────────────────────────────

function rankOf(summary) {
  const share = summary.total ? summary.good / summary.total : 0;
  if (summary.good === 0) return 'none';
  return share >= 0.4 ? 'great' : 'some';
}

function renderDays() {
  const list = $('#daystrip-days');
  list.innerHTML = '';

  state.summary.forEach((summary, i) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day rank-${rankOf(summary)}${i === state.selected ? ' is-selected' : ''}`;
    button.setAttribute('aria-pressed', String(i === state.selected));

    const spread =
      summary.lowHigh != null && summary.highHigh != null
        ? `${summary.lowHigh}–${summary.highHigh}°F`
        : '—';

    button.innerHTML = `
      <div class="dow">${i === 0 ? 'Today' : dow(summary.date)}</div>
      <div class="date">${monthDay(summary.date)}</div>
      <div class="count">${summary.good} good</div>
      <div class="meta">${spread}</div>`;

    button.addEventListener('click', () => selectDay(i));
    li.append(button);
    list.append(li);
  });

  list.hidden = false;
  $('#daystrip-status').hidden = true;
  $('#legend').hidden = false;
}

function selectDay(index) {
  state.selected = index;
  for (const [i, button] of [...document.querySelectorAll('.day')].entries()) {
    button.classList.toggle('is-selected', i === index);
    button.setAttribute('aria-pressed', String(i === index));
  }
  paintRoads();
  renderRoadList();
  map.closePopup();
}

// ── Road list ───────────────────────────────────────────────────────────────

function renderRoadList() {
  const list = $('#roadlist-items');
  const date = state.summary[state.selected]?.date;
  $('#roadlist-day').textContent = date ? `· ${state.selected === 0 ? 'today' : dow(date)}` : '';

  const order = { good: 0, cold: 1, hot: 2, wet: 3, unknown: 4 };
  const rows = state.roads
    .map((road) => {
      const day = state.forecast?.byRoad[road.id]?.[state.selected];
      return { road, day, category: classify(day) };
    })
    .sort(
      (a, b) =>
        order[a.category] - order[b.category] || a.road.name.localeCompare(b.road.name)
    );

  list.innerHTML = '';
  for (const { road, day, category } of rows) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `road-row${category === 'good' ? ' is-good' : ''}`;
    button.innerHTML = `
      <span class="bar" style="background:${CATEGORY_COLORS[category]}"></span>
      <span>
        <span class="nm">${road.name}</span>
        <span class="sub">${road.region} · ${CATEGORY_LABELS[category]}</span>
      </span>
      <span class="tmp">${day ? `${temp(day.high)}/${temp(day.low)}` : '—'}</span>`;

    button.addEventListener('click', () => {
      map.fitBounds(L.latLngBounds(road.bounds), { padding: [70, 70] });
      openRoad(road);
    });
    button.addEventListener('mouseenter', () => highlight(road.id, true));
    button.addEventListener('mouseleave', () => highlight(road.id, false));

    li.append(button);
    list.append(li);
  }
}

function wireRoadListToggle() {
  const panel = $('#roadlist');
  const toggle = $('#roads-toggle');

  const show = (open) => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => show(true));
  $('#roads-close').addEventListener('click', () => show(false));

  // Room for it on a desktop; on a phone it would bury the map.
  show(window.innerWidth > 900);
}

// ── Boot ────────────────────────────────────────────────────────────────────

function fail(message) {
  const status = $('#daystrip-status');
  status.hidden = false;
  status.classList.add('is-error');
  status.textContent = message;
  $('#daystrip-days').hidden = true;
}

async function init() {
  for (const button of document.querySelectorAll('[data-basemap]')) {
    button.addEventListener('click', () => setBasemap(button.dataset.basemap));
  }
  setBasemap('touge');

  $('#rule-min').textContent = RULE.tempMin;
  $('#rule-max').textContent = RULE.tempMax;

  try {
    const res = await fetch('data/roads.json');
    if (!res.ok) throw new Error(`roads.json responded ${res.status}`);
    state.roads = (await res.json()).roads ?? [];
  } catch (err) {
    fail(`Could not load the roads — ${err.message}`);
    return;
  }

  if (!state.roads.length) {
    fail('No roads in data/roads.json. Run: node scripts/fetch-roads.mjs');
    return;
  }

  drawRoads();
  wireRoadListToggle();

  // The map is useful before the forecast lands, so this comes second and its
  // failure only costs the colouring.
  try {
    state.forecast = await loadForecast(state.roads);
    state.summary = summariseDays(state.roads, state.forecast);
    renderDays();
    paintRoads();
    renderRoadList();
  } catch (err) {
    fail(`Roads loaded, but the forecast failed — ${err.message}`);
    renderRoadList();
  }
}

init();
