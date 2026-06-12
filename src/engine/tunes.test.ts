/**
 * Unit tests for the deterministic tune-chip re-deals — pure, zero tokens.
 *
 *   npx tsx --test src/engine/tunes.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyTune, type DealEntry } from './tunes';
import type { MenuItem, Pick } from './types';

function entry({
  id,
  price,
  score,
  carbs = null,
  fat = null,
  needsVerify = false,
}: {
  id: string;
  price: number;
  score: number;
  carbs?: number | null;
  fat?: number | null;
  needsVerify?: boolean;
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
    rank: 1,
    item_id: id,
    match_score: score,
    why: 'because',
    flag: null,
    protein_g: null,
    carbs_g: carbs,
    fat_g: fat,
    confidence: null,
  };
  return { pick, item, needsVerify };
}

const ids = (deal: DealEntry[]) => deal.map((e) => e.item.id);

const BASE = [
  entry({ id: 'soup', price: 16.5, score: 94, carbs: 52, fat: 21 }),
  entry({ id: 'noodles', price: 14.0, score: 88, carbs: 64, fat: 18 }),
  entry({ id: 'salad', price: 13.5, score: 82, carbs: 28, fat: 19, needsVerify: true }),
];

test('null tune keeps the ranker’s order and never mutates the input', () => {
  const before = ids(BASE);
  assert.deepEqual(ids(applyTune(null, BASE)), before);
  assert.deepEqual(ids(BASE), before);
});

test('$ lower sorts by price ascending', () => {
  assert.deepEqual(ids(applyTune('price', BASE)), ['salad', 'noodles', 'soup']);
});

test('$ lower sorts unpriced dishes last, not first', () => {
  const deal = [entry({ id: 'mystery', price: 0, score: 90 }), ...BASE];
  assert.equal(ids(applyTune('price', deal)).at(-1), 'mystery');
});

test('light meal sorts by carbs+fat ascending', () => {
  assert.deepEqual(ids(applyTune('light', BASE)), ['salad', 'soup', 'noodles']);
});

test('light meal sorts unweighable dishes (null macros) last', () => {
  const deal = [entry({ id: 'unknown', price: 12, score: 91 }), ...BASE];
  assert.equal(ids(applyTune('light', deal)).at(-1), 'unknown');
});

test('safe bet puts verify-free dishes first, then by match score', () => {
  assert.deepEqual(ids(applyTune('safe', BASE)), ['soup', 'noodles', 'salad']);
});

test('safe bet demotes a high-scoring dish that needs verification', () => {
  const deal = [
    entry({ id: 'flagged', price: 10, score: 99, needsVerify: true }),
    entry({ id: 'clean', price: 18, score: 70 }),
  ];
  assert.deepEqual(ids(applyTune('safe', deal)), ['clean', 'flagged']);
});

test('surprise me reverses the deal', () => {
  assert.deepEqual(ids(applyTune('surprise', BASE)), ['salad', 'noodles', 'soup']);
});
