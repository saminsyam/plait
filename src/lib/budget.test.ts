/**
 * Unit tests for the budget-ceiling helpers behind the results slider.
 *
 *   npx tsx --test src/lib/budget.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { budgetBounds, budgetRequest, filterByBudget } from './budget';
import type { MenuItem } from './types';

const item = (name: string, price: number): MenuItem => ({
  id: name,
  name,
  price,
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

const names = (xs: MenuItem[]) => xs.map((x) => x.name);

// --- bounds ------------------------------------------------------------------

test('budgetBounds spans the priced dishes with a $1 step on tight menus', () => {
  const b = budgetBounds([item('A', 9), item('B', 14), item('C', 22), item('NP', 0)]);
  assert.deepEqual(b, { min: 9, max: 22, step: 1 });
});

test('budgetBounds widens to $5 steps and rounds outward on wide menus', () => {
  const b = budgetBounds([item('A', 11), item('B', 58)]);
  assert.deepEqual(b, { min: 10, max: 60, step: 5 });
});

test('budgetBounds is null with <2 priced dishes or a flat price list', () => {
  assert.equal(budgetBounds([item('Only', 12), item('NP', 0)]), null);
  assert.equal(budgetBounds([item('A', 15), item('B', 15)]), null);
  assert.equal(budgetBounds([]), null);
});

// --- filter ------------------------------------------------------------------

test('filterByBudget keeps dishes at/under the ceiling plus unpriced ones', () => {
  const pool = [item('Cheap', 8), item('Mid', 15), item('Pricey', 30), item('Market', 0)];
  assert.deepEqual(names(filterByBudget(pool, 15)), ['Cheap', 'Mid', 'Market']);
});

test('filterByBudget with a null ceiling (no limit) is the identity', () => {
  const pool = [item('A', 8), item('B', 30)];
  assert.equal(filterByBudget(pool, null), pool);
});

test('a ceiling that would empty the pool is ignored, not obeyed', () => {
  const pool = [item('A', 20), item('B', 30)];
  assert.equal(filterByBudget(pool, 5).length, 2);
});

// --- request line --------------------------------------------------------------

test('budgetRequest renders a dollar line, or null at no-limit', () => {
  assert.equal(budgetRequest(24), 'keep each dish under $24');
  assert.equal(budgetRequest(null), null);
});
