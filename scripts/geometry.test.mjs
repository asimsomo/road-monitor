// node --test scripts/geometry.test.mjs
//
// Overpass hands back way fragments in arbitrary order and arbitrary direction.
// Stitching them is the step most likely to quietly produce a mangled road, and
// it is a pain to spot by eye on a map, so it gets tested directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { stitch, lengthMi, midpointOf, boundsOf } from './fetch-roads.mjs';

const asWay = (points) => ({ geometry: points.map(([lat, lon]) => ({ lat, lon })) });

// Ten points marching north-east, which we then chop up and shuffle.
const track = Array.from({ length: 10 }, (_, i) => [37.3 + i * 0.01, -122.2 + i * 0.01]);

test('stitches shuffled, reversed fragments into one continuous line', () => {
  const a = track.slice(0, 4); // p0..p3
  const b = track.slice(3, 7); // p3..p6
  const c = track.slice(6); //    p6..p9

  // Out of order, and the first one runs backwards.
  const lines = stitch([asWay([...c].reverse()), asWay(a), asWay(b)]);

  assert.equal(lines.length, 1, 'fragments that share endpoints must form one line');
  assert.equal(lines[0].length, track.length, 'no points duplicated or dropped at the seams');

  // Direction is not meaningful for a road, so either orientation is correct.
  const ends = [lines[0][0], lines[0].at(-1)];
  assert.deepEqual(
    ends.map((p) => p.join(',')).sort(),
    [track[0], track.at(-1)].map((p) => p.join(',')).sort()
  );
});

test('keeps genuinely disconnected fragments apart, longest first', () => {
  const near = track.slice(0, 3);
  const far = [
    [38.0, -121.0],
    [38.2, -121.0],
    [38.4, -121.0],
  ];

  const lines = stitch([asWay(near), asWay(far)]);

  assert.equal(lines.length, 2, 'fragments with no shared endpoint must stay separate');
  assert.ok(
    lengthMi(lines[0]) >= lengthMi(lines[1]),
    'the primary run of the road should lead'
  );
});

test('midpoint is measured along the road, not averaged across it', () => {
  // An L: two miles north, then two miles east. Averaging the coordinates would
  // land off the road entirely; walking it must land at the corner.
  const corner = [37.32888, -122.2]; // ~2 miles north of the start
  const line = [[37.3, -122.2], corner, [37.32888, -122.16358]];

  const [lat, lon] = midpointOf(line);
  assert.ok(Math.abs(lat - corner[0]) < 0.002, `midpoint latitude ${lat} should sit at the corner`);
  assert.ok(Math.abs(lon - corner[1]) < 0.002, `midpoint longitude ${lon} should sit at the corner`);
});

test('length is plausible for a known distance', () => {
  // One degree of latitude is ~69 miles.
  const miles = lengthMi([
    [37.0, -122.0],
    [38.0, -122.0],
  ]);
  assert.ok(miles > 68 && miles < 70, `expected ~69 miles, got ${miles}`);
});

test('bounds cover every line', () => {
  const bounds = boundsOf([track, [[36.9, -122.9]]]);
  assert.deepEqual(bounds[0], [36.9, -122.9], 'south-west corner');
  assert.deepEqual(bounds[1], [37.39, -122.11], 'north-east corner');
});
