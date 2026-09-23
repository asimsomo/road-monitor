// node --test js/classify.test.mjs
//
// The rule is the whole point of the site, so it gets tested directly rather
// than trusted to a screenshot. The rain branch especially: Bay Area forecasts
// are bone dry from roughly May to October, so in practice `wet` can go months
// without ever executing against live data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './weather.js';
import { RULE } from './config.js';

const day = (high, low = 50, precip = 0, precipProb = 0) => ({
  date: '2026-09-23',
  high,
  low,
  precip,
  precipProb,
});

test('a dry day inside the temperature band is a good drive', () => {
  assert.equal(classify(day(72)), 'good');
});

test('the band is inclusive at both ends', () => {
  assert.equal(classify(day(RULE.tempMin)), 'good', '65F should qualify');
  assert.equal(classify(day(RULE.tempMax)), 'good', '80F should qualify');
});

test('temperatures outside the band are rejected in the right direction', () => {
  assert.equal(classify(day(64)), 'cold');
  assert.equal(classify(day(81)), 'hot');
});

test('what is displayed is what is classified', () => {
  // The UI rounds for display. Classifying the raw value instead would show a
  // road as "65°" and colour it blue, which reads as a bug to anyone looking.
  assert.equal(classify(day(64.6)), 'good', '64.6 displays as 65, so it must qualify');
  assert.equal(classify(day(80.4)), 'good', '80.4 displays as 80, so it must qualify');
  assert.equal(classify(day(64.4)), 'cold', '64.4 displays as 64');
  assert.equal(classify(day(80.6)), 'hot', '80.6 displays as 81');
});

test('rain disqualifies a day whatever the temperature', () => {
  assert.equal(classify(day(72, 50, 0.25)), 'wet', 'a perfect 72F is still no good in rain');
  assert.equal(classify(day(50, 40, 0.25)), 'wet');
  assert.equal(classify(day(95, 70, 0.25)), 'wet');
});

test('rain takes precedence over temperature', () => {
  // Ordering matters: a cold wet day must read as wet, not cold, or the map
  // would tell you the problem is the temperature when it is the rain.
  assert.equal(classify(day(40, 30, 1.5)), 'wet');
});

test('a trace below the threshold is not rain', () => {
  assert.equal(classify(day(72, 50, 0)), 'good');
  assert.equal(classify(day(72, 50, 0.009)), 'good', 'below rainMax');
  assert.equal(classify(day(72, 50, RULE.rainMax)), 'wet', 'at rainMax it counts');
});

test('a high chance of rain that never falls is still a good drive', () => {
  // We score what is forecast to fall, not the probability. An 80% chance of
  // nothing is a dry day.
  assert.equal(classify(day(72, 50, 0, 80)), 'good');
});

test('a missing forecast is unknown, not good', () => {
  assert.equal(classify(null), 'unknown');
  assert.equal(classify(undefined), 'unknown');
});
