/**
 * Unit tests for the refine-nudge heuristic — deterministic, pure.
 *
 *   npx tsx --test src/lib/refineNudge.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { refineNudge } from './refineNudge';
import type { Pick } from './types';

const pick = (rank: 1 | 2 | 3, score: number): Pick => ({
  rank,
  item_id: `item-${rank}`,
  match_score: score,
  why: 'because',
  flag: null,
  protein_g: null,
  carbs_g: null,
  fat_g: null,
  confidence: null,
});

const THREE_GOOD = [pick(1, 90), pick(2, 82), pick(3, 75)];

test('no nudge when three confident picks came from a manageable pool', () => {
  assert.equal(
    refineNudge({ poolSize: 12, preferencesText: 'halal, high-protein', picks: THREE_GOOD }),
    null
  );
});

test('broad pool + empty preferences nudges', () => {
  assert.ok(refineNudge({ poolSize: 40, preferencesText: '  ', picks: THREE_GOOD }));
});

test('broad pool with stated preferences does NOT nudge', () => {
  assert.equal(
    refineNudge({ poolSize: 40, preferencesText: 'vegetarian, loves spicy', picks: THREE_GOOD }),
    null
  );
});

test('fewer than three picks nudges', () => {
  assert.ok(refineNudge({ poolSize: 10, preferencesText: 'halal', picks: [pick(1, 95)] }));
});

test('uniformly low scores nudge; one strong pick silences it', () => {
  const low = [pick(1, 55), pick(2, 48), pick(3, 41)];
  assert.ok(refineNudge({ poolSize: 10, preferencesText: 'halal', picks: low }));
  const mixed = [pick(1, 88), pick(2, 48), pick(3, 41)];
  assert.equal(refineNudge({ poolSize: 10, preferencesText: 'halal', picks: mixed }), null);
});

test('zero picks never nudges — there is nothing to sharpen', () => {
  assert.equal(refineNudge({ poolSize: 40, preferencesText: '', picks: [] }), null);
});
