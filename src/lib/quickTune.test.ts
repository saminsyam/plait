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

test('no_seafood cuts shrimp and salmon by keyword/protein, keeps chicken', () => {
  const pool = [
    item('Garlic Shrimp'),
    item('Grilled Plate', { protein_type: ['fish'] }),
    item('Chicken Karaage', { protein_type: ['chicken'] }),
  ];
  assert.deepEqual(names(applyQuickTunes(pool, ['no_seafood'])), ['Chicken Karaage']);
});

test('protein_value chip reorders by est. ratio but never drops a dish', () => {
  const pool = [
    item('Salad', { price: 12, protein_g_est: 8 }), // low protein → trailing
    item('Chicken Plate', { price: 14, protein_g_est: 42 }), // 3.0 g/$
    item('Steak', { price: 30, protein_g_est: 60 }), // 2.0 g/$
  ];
  assert.deepEqual(names(applyQuickTunes(pool, ['protein_value'])), [
    'Chicken Plate',
    'Steak',
    'Salad',
  ]);
  assert.equal(tuneRequests(['protein_value']).length, 1);
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
  ];
  // lighter cuts Rich Lobster; no_seafood cuts Shrimp Salad.
  assert.deepEqual(names(applyQuickTunes(pool, ['lighter', 'no_seafood'])), ['Veg Stir-fry']);
});

test('every chip has a request line', () => {
  assert.equal(tuneRequests(QUICK_TUNES.map((t) => t.id)).length, QUICK_TUNES.length);
});
