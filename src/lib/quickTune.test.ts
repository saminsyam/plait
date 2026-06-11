/**
 * Unit tests for the quick-tune chip filters — deterministic, on-device,
 * zero tokens.
 *
 *   npx tsx --test src/lib/quickTune.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyQuickTunes, QUICK_TUNES, tuneRequests } from './quickTune';
import type { MenuItem } from './types';

const item = (name: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id: name,
  name,
  price: 0,
  description: '',
  ingredients: [],
  flavor_profile: [],
  texture: [],
  spice_level: 0,
  dietary_tags: [],
  protein_type: [],
  category: 'main',
  cuisine_type: 'test',
  ...extra,
});

const names = (xs: MenuItem[]) => xs.map((x) => x.name);

test('lighter drops rich-tagged dishes and desserts', () => {
  const pool = [
    item('Butter Chicken', { flavor_profile: ['rich'] }),
    item('Garden Salad', { flavor_profile: ['fresh'] }),
    item('Lava Cake', { category: 'dessert' }),
  ];
  assert.deepEqual(names(applyQuickTunes(pool, ['lighter'])), ['Garden Salad']);
});

test('cheaper keeps the at-or-below-median half and unpriced items', () => {
  const pool = [
    item('Cheap', { price: 8 }),
    item('Mid', { price: 12 }),
    item('Pricey', { price: 30 }),
    item('Market Price', { price: 0 }),
  ];
  // Median of [8, 12, 30] is 12 → 30 is cut, unpriced stays.
  assert.deepEqual(names(applyQuickTunes(pool, ['cheaper'])), ['Cheap', 'Mid', 'Market Price']);
});

test('cheaper is a no-op with fewer than 2 priced items', () => {
  const pool = [item('Only Priced', { price: 9 }), item('Unpriced', { price: 0 })];
  assert.equal(applyQuickTunes(pool, ['cheaper']).length, 2);
});

test('no_seafood cuts shrimp and salmon by keyword/protein, keeps chicken', () => {
  const pool = [
    item('Garlic Shrimp'),
    item('Grilled Plate', { protein_type: ['fish'] }),
    item('Chicken Karaage', { protein_type: ['chicken'] }),
  ];
  assert.deepEqual(names(applyQuickTunes(pool, ['no_seafood'])), ['Chicken Karaage']);
});

test('protein chip never filters — it is context-only', () => {
  const pool = [item('Tofu Bowl', { protein_type: ['vegan'] }), item('Salad')];
  assert.equal(applyQuickTunes(pool, ['protein']).length, 2);
  assert.deepEqual(tuneRequests(['protein']), ['maximize protein']);
});

test('a chip that would empty the pool is skipped, not obeyed', () => {
  const allSeafood = [item('Garlic Shrimp'), item('Salmon Teriyaki')];
  assert.equal(applyQuickTunes(allSeafood, ['no_seafood']).length, 2);
});

test('chips compose in order', () => {
  const pool = [
    item('Rich Lobster', { flavor_profile: ['rich'], price: 40 }),
    item('Shrimp Salad', { price: 10 }),
    item('Veg Stir-fry', { price: 11 }),
    item('Steak Frites', { price: 35 }),
  ];
  // lighter cuts Rich Lobster; no_seafood cuts Shrimp Salad;
  // cheaper over the rest (11, 35 → median 11) cuts Steak Frites.
  assert.deepEqual(names(applyQuickTunes(pool, ['lighter', 'no_seafood', 'cheaper'])), [
    'Veg Stir-fry',
  ]);
});

test('every chip has a request line', () => {
  assert.equal(tuneRequests(QUICK_TUNES.map((t) => t.id)).length, QUICK_TUNES.length);
});
