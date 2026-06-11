/**
 * Unit tests for the protein-per-dollar value sort.
 *
 *   npx tsx --test src/lib/proteinValue.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isValueCandidate,
  PROTEIN_VALUE_REQUEST,
  proteinPerDollar,
  proteinValueLabel,
  sortByProteinValue,
} from './proteinValue';
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

// --- ratio ---------------------------------------------------------------------

test('proteinPerDollar needs both a price and an estimate', () => {
  assert.equal(proteinPerDollar(item('Steak', { price: 20, protein_g_est: 50 })), 2.5);
  assert.equal(proteinPerDollar(item('Market Fish', { price: 0, protein_g_est: 40 })), null);
  assert.equal(proteinPerDollar(item('Mystery', { price: 15 })), null);
  assert.equal(proteinPerDollar(item('Zeroed', { price: 15, protein_g_est: 0 })), null);
});

// --- eligibility (the cheap-sides guard) ------------------------------------------

test('a cheap low-protein side is not a value candidate; a main or hearty dish is', () => {
  assert.equal(isValueCandidate(item('Side Eggs', { price: 4, protein_g_est: 12, category: 'side' })), false);
  assert.equal(isValueCandidate(item('Chicken Plate', { price: 14, protein_g_est: 38 })), true);
  // Non-main but meal-sized protein still counts.
  assert.equal(isValueCandidate(item('Protein Bowl', { price: 11, protein_g_est: 28, category: 'starter' })), true);
});

// --- sort ----------------------------------------------------------------------

test('sortByProteinValue puts best ratio first and never drops anything', () => {
  const pool = [
    item('Pasta', { price: 18, protein_g_est: 18 }), // 1.0
    item('Chicken Plate', { price: 14, protein_g_est: 42 }), // 3.0
    item('Market Fish', { price: 0, protein_g_est: 40 }), // no price → trailing
    item('Steak', { price: 30, protein_g_est: 60 }), // 2.0
    item('Side Eggs', { price: 4, protein_g_est: 12, category: 'side' }), // side → trailing
  ];
  const sorted = sortByProteinValue(pool);
  assert.deepEqual(names(sorted), ['Chicken Plate', 'Steak', 'Pasta', 'Market Fish', 'Side Eggs']);
  assert.equal(sorted.length, pool.length);
});

test('a pool with no estimates comes back unchanged', () => {
  const pool = [item('A', { price: 10 }), item('B', { price: 12 })];
  assert.deepEqual(names(sortByProteinValue(pool)), ['A', 'B']);
});

// --- presentation ---------------------------------------------------------------

test('proteinValueLabel renders one decimal, or null when unknowable', () => {
  assert.equal(proteinValueLabel(42, 14), '~3.0g protein/$');
  assert.equal(proteinValueLabel(null, 14), null);
  assert.equal(proteinValueLabel(42, 0), null);
});

test('the ranking context line mentions the payload field it relies on', () => {
  assert.match(PROTEIN_VALUE_REQUEST, /protein_g_est/);
});
