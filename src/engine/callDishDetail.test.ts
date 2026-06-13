/**
 * Unit tests for the persistent dish-detail cache key (callDishDetail).
 * Pure — no API, no network.
 *   npx tsx --test src/engine/callDishDetail.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dishDetailKey } from './callDishDetail';
import type { Answers } from './types';

const base = {
  restaurant: 'Burma Light',
  itemId: 'tea-leaf-salad',
  preferences: 'halal, no peanuts',
  answers: {} as Answers,
};

test('same diner + dish + profile + answers → identical key', () => {
  assert.equal(dishDetailKey(base), dishDetailKey({ ...base }));
});

test('restaurant name is normalized (case / spacing) into the key', () => {
  assert.equal(
    dishDetailKey(base),
    dishDetailKey({ ...base, restaurant: '  BURMA   light ' })
  );
});

test('answer order does not change the key', () => {
  const a = dishDetailKey({ ...base, answers: { protein: 'chicken', spice: '2' } });
  const b = dishDetailKey({ ...base, answers: { spice: '2', protein: 'chicken' } });
  assert.equal(a, b);
});

test('different profile, dish, or answers → different key', () => {
  const k = dishDetailKey(base);
  assert.notEqual(k, dishDetailKey({ ...base, preferences: 'vegan' }));
  assert.notEqual(k, dishDetailKey({ ...base, itemId: 'mohinga' }));
  assert.notEqual(k, dishDetailKey({ ...base, answers: { spice: '3' } }));
});

test('the dish id and restaurant are legible in the key (the hash is only the profile part)', () => {
  const k = dishDetailKey(base);
  assert.ok(k.startsWith('burma light|tea-leaf-salad|'));
});
