/**
 * Unit tests for the on-device crowd-favorite ↔ menu-item matcher and the
 * lookup page's name-only hard-constraint warning.
 *
 *   npx tsx --test src/lib/matchReviews.test.ts
 *   (or: npm test)
 *
 * Pure functions only — no API key, no network. Zero tokens by design.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CrowdFavorite } from './callReviews';
import type { HardConstraints } from './dietaryFilter';
import { crowdFavoriteWarning, gateCrowdFavorites, matchCrowdFavorites } from './matchReviews';
import type { MenuItem } from './types';

const item = (id: string, name: string): MenuItem => ({
  id,
  name,
  price: 12,
  description: '',
  ingredients: [],
  flavor_profile: [],
  texture: [],
  spice_level: 0,
  dietary_tags: [],
  protein_type: [],
  category: 'main',
  cuisine_type: 'test',
});

const fav = (name: string): CrowdFavorite => ({ name, blurb: '' });

const MENU = [
  item('1', 'Burmese Tea-Leaf Salad (Laphet Thoke)'),
  item('2', 'Coconut Chicken Noodle Soup'),
  item('3', 'Mohinga'),
  item('4', 'Garlic Noodles'),
  item('5', 'Fried Chicken Wings'),
];

test('exact and punctuation/case-insensitive names match', () => {
  const [m] = matchCrowdFavorites([fav('garlic NOODLES!')], MENU);
  assert.equal(m.itemId, '4');
});

test('a short review name matches a longer menu name containing it', () => {
  const [salad, mohinga] = matchCrowdFavorites(
    [fav('Tea Leaf Salad'), fav('Mohinga Fish Soup')],
    MENU
  );
  assert.equal(salad.itemId, '1'); // subset of "Burmese Tea-Leaf Salad (Laphet Thoke)"
  assert.equal(mohinga.itemId, '3'); // superset of "Mohinga"
});

test('partial token overlap is NOT a match', () => {
  // Shares "coconut" with the soup, but is not the same dish.
  const [m] = matchCrowdFavorites([fav('Coconut Rice')], MENU);
  assert.equal(m.itemId, null);
});

test('an off-menu review dish stays unmatched', () => {
  const [m] = matchCrowdFavorites([fav('Pork Belly Bao')], MENU);
  assert.equal(m.itemId, null);
});

test('each menu item is claimed at most once', () => {
  const [a, b] = matchCrowdFavorites([fav('Fried Chicken'), fav('Chicken Wings')], MENU);
  assert.equal(a.itemId, '5');
  assert.equal(b.itemId, null); // '5' already taken
});

test('an exact match beats a looser containment match', () => {
  const menu = [item('long', 'Spicy Garlic Noodles Deluxe'), item('exact', 'Garlic Noodles')];
  const [m] = matchCrowdFavorites([fav('Garlic Noodles')], menu);
  assert.equal(m.itemId, 'exact');
});

test('stopwords and accents do not block a match', () => {
  const menu = [item('1', 'Crêpes with Nutella')];
  const [m] = matchCrowdFavorites([fav('The Nutella Crepes')], menu);
  assert.equal(m.itemId, '1');
});

// --- crowdFavoriteWarning ----------------------------------------------------

const SHELLFISH: HardConstraints = [{ kind: 'allergen', allergen: 'shellfish', severity: 'severe' }];

test('shellfish allergy warns on Garlic Shrimp by name alone', () => {
  const w = crowdFavoriteWarning('Garlic Shrimp', SHELLFISH);
  assert.ok(w && /shellfish/.test(w));
});

test('only affirmative conflicts warn — unknowns stay quiet on a no-menu page', () => {
  assert.equal(crowdFavoriteWarning('Tea Leaf Salad', SHELLFISH), null);
  assert.equal(crowdFavoriteWarning('Garlic Shrimp', []), null);
});

test('halal rule warns on pork and alcohol keywords', () => {
  const halal: HardConstraints = [{ kind: 'religious', rule: 'halal' }];
  assert.ok(crowdFavoriteWarning('Bacon Cheeseburger', halal));
  assert.ok(crowdFavoriteWarning('Beer-Battered Cod', halal));
  assert.equal(crowdFavoriteWarning('Grilled Chicken', halal), null); // unknown ≠ conflict
});

// --- gateCrowdFavorites --------------------------------------------------------

test('a favorite matching a gate-blocked dish keeps its badge but warns and never ranks', () => {
  const shrimp = item('9', 'Garlic Shrimp');
  const blocked = [{ item: shrimp, outcome: 'blocked' as const, reasons: ['contains shellfish'] }];
  const matches = matchCrowdFavorites([fav('Garlic Shrimp'), fav('Mohinga')], [...MENU, shrimp]);
  const { entries, rankable } = gateCrowdFavorites(matches, blocked);

  const shrimpEntry = entries.find((e) => e.name === 'Garlic Shrimp')!;
  assert.equal(shrimpEntry.onMenu, true); // honest — it IS on the menu
  assert.equal(shrimpEntry.warning, 'contains shellfish');
  assert.ok(!('9' in rankable)); // blocked dishes are never cited to the ranker

  const mohinga = entries.find((e) => e.name === 'Mohinga')!;
  assert.equal(mohinga.onMenu, true);
  assert.equal(mohinga.warning, null);
  assert.equal(rankable['3'], 'Mohinga');
});

test('unmatched favorites carry no badge, no warning, and never rank', () => {
  const { entries, rankable } = gateCrowdFavorites(
    matchCrowdFavorites([fav('Pork Belly Bao')], MENU),
    []
  );
  assert.deepEqual(entries, [
    { name: 'Pork Belly Bao', blurb: '', onMenu: false, warning: null },
  ]);
  assert.deepEqual(rankable, {});
});
