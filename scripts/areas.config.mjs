// Which roads make up each driving area, and how much of an area has to be
// good before it is worth putting on the calendar.
//
// You do not drive to a region for one road, so the calendar scores areas
// rather than individual roads: an area earns an all-day event when at least
// THRESHOLD of its roads qualify that day.
//
// Membership is listed explicitly rather than derived from coordinates. A
// lat/lon rule would look tidier but quietly misfile the awkward cases — Mines
// Rd straddles the Palomares boundary, Del Puerto runs east into the Central
// Valley — and a new road would be silently absorbed instead of prompting a
// decision. validateAreas() below fails loudly if roads.json and this file
// drift apart.

export const THRESHOLD = 0.75;

export const AREAS = [
  {
    id: 'north-bay',
    name: 'North Bay',
    // Marin and Sonoma: north of downtown SF and west of the bay.
    roads: [
      'skaggs-springs-raceway',
      'n-san-pedro-rd',
      'paradise-dr',
      'highway-1-muir-woods',
      'bunker-loop-line',
    ],
  },
  {
    id: 'northeast-bay',
    name: 'Northeast Bay',
    // East Bay hills from Palomares northwards, Palomares included.
    roads: [
      'wildcat-canyon-rd',
      'grizzly-peak-blvd',
      'pinehurst-rd',
      'redwood-rd',
      'palomeras-rd',
    ],
  },
  {
    id: 'southeast-bay',
    name: 'Southeast Bay',
    // The rest of the East Bay: the Diablo range and the San Jose foothills.
    // Mines Rd sits here because the bulk of it lies south of Palomares, even
    // though its northern tip reaches into the same latitude band.
    roads: [
      'mines-rd',
      'caleveras-rd',
      'del-puerto-canyon-rd',
      'felter-rd',
      'sierra-rd',
      'san-antonio-valley-rd',
      'mt-hamilton-rd',
    ],
  },
  {
    id: 'peninsula',
    name: 'Peninsula',
    // The peninsula and the Santa Cruz mountains, down to Santa Cruz itself.
    // Alma Bridge and Soda Springs are here: they sit on the east flank of the
    // range by Lexington Reservoir, but they belong to the same chain.
    roads: [
      'alma-bridge-rd',
      'alpine-rd',
      'bear-creek-rd-17',
      'bear-creek-rd-9',
      'black-rd',
      'bonny-doon-rd',
      'devils-slide',
      'empire-grade',
      'felton-empire-rd',
      'highway-84-la-honda',
      'highway-84-ws',
      'highway-9-236',
      'highway-9-gunsai',
      'highway-9-rw',
      'highway-9-saratoga',
      'jamison-creek-rd',
      'kings-mountain-rd',
      'lobitos-creek-rd',
      'mt-eden-rd',
      'old-la-honda-rd',
      'page-mill-rd',
      'pescadero-road',
      'pierce-rd',
      'route-236',
      'san-gregorio-rd',
      'skyline-35',
      'skyline-black',
      'skyline-north',
      'skyline-south',
      'soda-springs-rd',
      'stage-rd',
      'stevens-canyon-rd',
      'stevens-canyon-rd-rw',
      'tunitas-creek-rd',
    ],
  },
];

// On the map but deliberately outside area scoring. Hecker Pass runs Gilroy to
// Watsonville at the southern tip of the range — south of Santa Cruz and well
// inland — so it sits in none of the four areas cleanly.
export const UNSCORED = ['hecker-pass-rd'];

/** How many roads an area needs before it earns a calendar event. */
export const required = (area) => Math.ceil(area.roads.length * THRESHOLD);

/**
 * Fail loudly when roads.json and this file disagree, rather than quietly
 * scoring an area that is missing a road or counting one twice.
 */
export function validateAreas(roads) {
  const known = new Set(roads.map((r) => r.id));
  const assigned = new Map();
  const problems = [];

  for (const area of AREAS) {
    for (const id of area.roads) {
      if (assigned.has(id)) {
        problems.push(`${id} is in both ${assigned.get(id)} and ${area.id}`);
      }
      assigned.set(id, area.id);
      if (!known.has(id)) problems.push(`${area.id} lists ${id}, which is not in roads.json`);
    }
  }

  for (const id of UNSCORED) {
    if (assigned.has(id)) problems.push(`${id} is both unscored and in ${assigned.get(id)}`);
    if (!known.has(id)) problems.push(`unscored list has ${id}, which is not in roads.json`);
    assigned.set(id, 'unscored');
  }

  for (const id of known) {
    if (!assigned.has(id)) problems.push(`${id} is in roads.json but belongs to no area`);
  }

  return problems;
}
