/**
 * Unit tests for the tune-chip slate selection — pure, zero tokens.
 *
 *   npx tsx --test src/engine/tunes.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyTune, type DealEntry } from './tunes';
import type { MenuItem, Pick, TuneSuit } from './types';

function entry({
  id,
  rank,
  price,
  score,
  carbs = null,
  fat = null,
  needsVerify = false,
  suits = [],
}: {
  id: string;
  rank: number;
  price: number;
  score: number;
  carbs?: number | null;
  fat?: number | null;
  needsVerify?: boolean;
  suits?: TuneSuit[];
}): DealEntry {
  const item: MenuItem = {
    id,
    name: id,
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
  };
  const pick: Pick = {
    rank,
    item_id: id,
    match_score: score,
    why: 'because',
    flag: null,
    suits,
    protein_g: null,
    carbs_g: carbs,
    fat_g: fat,
    confidence: null,
  };
  return { pick, item, needsVerify };
}

const ids = (deal: DealEntry[]) => deal.map((e) => e.item.id);

/** Untagged 3-pick deal — the degraded path (model returned no suits). */
const BASE = [
  entry({ id: 'soup', rank: 1, price: 16.5, score: 94, carbs: 52, fat: 21 }),
  entry({ id: 'noodles', rank: 2, price: 14.0, score: 88, carbs: 64, fat: 18 }),
  entry({ id: 'salad', rank: 3, price: 13.5, score: 82, carbs: 28, fat: 19, needsVerify: true }),
];

test('null tune keeps the ranker’s order and never mutates the input', () => {
  const before = ids(BASE);
  assert.deepEqual(ids(applyTune(null, BASE)), before);
  assert.deepEqual(ids(BASE), before);
});

// ── Degraded path: no suits anywhere → pure deterministic sort (old behavior).

test('$ lower without suits sorts by price ascending', () => {
  assert.deepEqual(ids(applyTune('price', BASE)), ['salad', 'noodles', 'soup']);
});

test('$ lower sorts unpriced dishes last, not first', () => {
  const deal = [entry({ id: 'mystery', rank: 4, price: 0, score: 90 }), ...BASE];
  assert.equal(ids(applyTune('price', deal)).at(-1), 'mystery');
});

test('light meal without suits sorts by carbs+fat ascending', () => {
  assert.deepEqual(ids(applyTune('light', BASE)), ['salad', 'soup', 'noodles']);
});

test('light meal sorts unweighable dishes (null macros) last', () => {
  const deal = [entry({ id: 'unknown', rank: 4, price: 12, score: 91 }), ...BASE];
  assert.equal(ids(applyTune('light', deal)).at(-1), 'unknown');
});

test('safe bet without suits puts verify-free dishes first, then by match score', () => {
  assert.deepEqual(ids(applyTune('safe', BASE)), ['soup', 'noodles', 'salad']);
});

test('safe bet demotes a high-scoring dish that needs verification', () => {
  const deal = [
    entry({ id: 'flagged', rank: 1, price: 10, score: 99, needsVerify: true }),
    entry({ id: 'clean', rank: 2, price: 18, score: 70 }),
  ];
  assert.deepEqual(ids(applyTune('safe', deal)), ['clean', 'flagged']);
});

test('surprise without suits deals deepest ranks first (the old reverse)', () => {
  assert.deepEqual(ids(applyTune('surprise', BASE)), ['salad', 'noodles', 'soup']);
});

// ── Slate path: the model's suits tags lead, deterministic keys order/backfill.

/** A 6-pick slate with suit tags — chips should CHANGE dishes, not reorder 3. */
const SLATE = [
  entry({ id: 'ribeye', rank: 1, price: 28, score: 95, carbs: 5, fat: 40, suits: ['safe'] }),
  entry({ id: 'pasta', rank: 2, price: 17, score: 90, carbs: 80, fat: 25, suits: ['safe'] }),
  entry({ id: 'burger', rank: 3, price: 15, score: 86, carbs: 50, fat: 35, suits: [] }),
  entry({ id: 'tacos', rank: 4, price: 9, score: 80, carbs: 40, fat: 18, suits: ['price'] }),
  entry({ id: 'ceviche', rank: 5, price: 19, score: 76, carbs: 12, fat: 6, suits: ['light', 'surprise'] }),
  entry({ id: 'wrap', rank: 6, price: 8, score: 72, carbs: 35, fat: 12, suits: ['price', 'light'] }),
];

test('a chip pulls suited dishes from beyond the top 3 into the deal', () => {
  // $ lower: suited tacos (rank 4) + wrap (rank 6) jump the unsuited top-3.
  assert.deepEqual(ids(applyTune('price', SLATE)).slice(0, 3), ['wrap', 'tacos', 'burger']);
  // Light: suited ceviche (rank 5) + wrap lead; backfill = lightest of the rest.
  assert.deepEqual(ids(applyTune('light', SLATE)).slice(0, 3), ['ceviche', 'wrap', 'ribeye']);
});

test('fewer than 3 suited entries backfill from the rest by the tune key', () => {
  const dealt = ids(applyTune('price', SLATE)).slice(0, 3);
  // Only two price-suited picks exist; slot 3 is the cheapest unsuited dish.
  assert.deepEqual(dealt, ['wrap', 'tacos', 'burger']);
});

test('surprise with suits deals the tagged deep cut first', () => {
  assert.equal(ids(applyTune('surprise', SLATE))[0], 'ceviche');
});

test('suited selection never mutates the input slate', () => {
  const before = ids(SLATE);
  applyTune('light', SLATE);
  assert.deepEqual(ids(SLATE), before);
});
