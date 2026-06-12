/**
 * Unit tests for the deterministic explore-mode bridge pick.
 *
 *   npx tsx --test src/engine/bridgePick.test.ts
 *   (or: npm test)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bridgePick } from './bridgePick';
import type { MenuItem, Pick } from './types';

function item(id: string, flavors: string[] = []): MenuItem {
  return {
    id,
    name: id,
    price: 12,
    description: '',
    ingredients: [],
    flavor_profile: flavors,
    texture: [],
    spice_level: 0,
    dietary_tags: [],
    protein_type: [],
    category: 'main',
    cuisine_type: 'test',
  };
}

function pick(rank: 1 | 2 | 3, itemId: string): Pick {
  return {
    rank,
    item_id: itemId,
    match_score: 90 - rank,
    why: 'because',
    flag: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    confidence: null,
  };
}

const HERO = item('hero', ['rich', 'savory']);

function setup(extra: MenuItem[], verifyById: Record<string, string[]> = {}, sigs: string[] = []) {
  const candidates = [HERO, ...extra];
  return bridgePick({
    picks: [pick(1, 'hero')],
    candidates,
    verifyById,
    signatureIds: sigs,
    byId: new Map(candidates.map((i) => [i.id, i])),
  });
}

test('never stretches into a verify item — stretch needs higher confidence', () => {
  const result = setup([item('uncertain'), item('clean')], { uncertain: ['halal unverified'] });
  assert.equal(result?.item.id, 'clean');
});

test('never re-picks something already in the deal', () => {
  const result = setup([item('other')]);
  assert.equal(result?.item.id, 'other');
});

test('returns null when no allowed candidate is left to stretch into', () => {
  assert.equal(setup([item('flagged')], { flagged: ['contains fish sauce?'] }), null);
});

test('prefers a house signature and says so', () => {
  const result = setup([item('plain'), item('signature')], {}, ['signature']);
  assert.equal(result?.item.id, 'signature');
  assert.match(result?.why ?? '', /house signature/);
});

test('bridges through a shared flavor lane with the hero when one exists', () => {
  const result = setup([item('stranger', ['fresh']), item('cousin', ['rich'])]);
  assert.equal(result?.item.id, 'cousin');
  assert.match(result?.why ?? '', /rich lane of the hero/);
});

test('signature + shared lane outranks shared lane alone', () => {
  const result = setup([item('cousin', ['rich'])], {}, []);
  const sigResult = setup([item('cousin', ['rich']), item('sig', ['rich'])], {}, ['sig']);
  assert.equal(result?.item.id, 'cousin');
  assert.equal(sigResult?.item.id, 'sig');
});
