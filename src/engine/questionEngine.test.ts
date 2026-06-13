/**
 * Unit tests for the deterministic narrowing engine. Pure — no API, no network.
 *   npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MenuItem } from './types';
import {
  choicesToQA,
  DEFAULT_SPICE,
  facetChoice,
  filterByFacet,
  filterBySpice,
  MIN_RANK_POOL,
  nextQuestion,
  parseSpiceCeiling,
  shouldStopNarrowing,
  spiceChoice,
  TARGET_POOL,
  widenRankPool,
} from './questionEngine';

function dish(p: Partial<MenuItem> & { name: string }): MenuItem {
  return {
    id: p.id ?? p.name.toLowerCase().replace(/\s+/g, '-'),
    name: p.name,
    price: p.price ?? 0,
    description: p.description ?? '',
    ingredients: [],
    flavor_profile: p.flavor_profile ?? [],
    texture: [],
    spice_level: p.spice_level ?? 0,
    dietary_tags: p.dietary_tags ?? [],
    protein_type: p.protein_type ?? [],
    category: p.category ?? 'main',
    cuisine_type: p.cuisine_type ?? 'burmese',
  };
}

// A Burma-Light-shaped menu: proteins in dish names, varied flavors.
const menu: MenuItem[] = [
  dish({ name: 'Lemongrass Chicken', protein_type: ['chicken'] }), // fresh
  dish({ name: 'Black Pepper Chicken', protein_type: ['chicken'] }), // savory
  dish({ name: 'Chili Basil Chicken', protein_type: ['chicken'], spice_level: 4 }), // spicy
  dish({ name: 'Mango Chicken', protein_type: ['chicken'] }), // sweet
  dish({ name: 'Ribeye Steak', protein_type: ['beef'] }),
  dish({ name: 'Grilled Salmon', protein_type: ['fish'] }),
  dish({ name: 'Burmese Shrimp', protein_type: ['seafood'] }),
  dish({ name: 'Lamb Curry', protein_type: ['lamb'], spice_level: 2 }),
];

test('first question is sub-protein, built from actual menu proteins', () => {
  const q = nextQuestion(menu, new Set())!;
  assert.equal(q.facetId, 'protein');
  const values = q.options.map((o) => o.value);
  for (const p of ['chicken', 'beef', 'salmon', 'shrimp', 'lamb']) {
    assert.ok(values.includes(p), `protein options should include ${p}`);
  }
  // Most common protein leads (chicken ×4).
  assert.equal(q.options[0].value, 'chicken');
  assert.equal(q.options[0].count, 4);
});

test('picking a protein narrows the pool to that protein', () => {
  const shrimp = filterByFacet(menu, 'protein', 'shrimp');
  assert.deepEqual(shrimp.map((d) => d.name), ['Burmese Shrimp']);
  const chicken = filterByFacet(menu, 'protein', 'chicken');
  assert.equal(chicken.length, 4);
});

test('second question is flavor, built from the narrowed pool', () => {
  const chicken = filterByFacet(menu, 'protein', 'chicken');
  const q = nextQuestion(chicken, new Set(['protein']))!;
  assert.equal(q.facetId, 'flavor');
  const values = q.options.map((o) => o.value).sort();
  // chili→spicy, mango→sweet, lemongrass→fresh, black pepper→savory
  assert.deepEqual(values, ['fresh', 'savory', 'spicy', 'sweet']);
});

test('nextQuestion returns null when no facet can split the pool', () => {
  const one = [dish({ name: 'Burmese Shrimp', protein_type: ['seafood'] })];
  assert.equal(nextQuestion(one, new Set()), null);
});

test('filterBySpice maps tolerance to dish heat, falls back if all too hot', () => {
  // medium (2) admits dish heat ≤3, so the level-4 dish is cut…
  assert.ok(!filterBySpice(menu, 2).some((d) => d.name === 'Chili Basil Chicken'));
  // …while hot (3) admits everything.
  assert.ok(filterBySpice(menu, 3).some((d) => d.name === 'Chili Basil Chicken'));
  // mild (1) admits only dish heat ≤1 (the level-2 lamb curry is cut).
  assert.ok(!filterBySpice(menu, 1).some((d) => d.name === 'Lamb Curry'));
  const fiery = [dish({ name: 'Ghost Curry', spice_level: 5 })];
  assert.deepEqual(filterBySpice(fiery, 1), fiery); // nothing survives → keep pool
});

// A pool wider than TARGET_POOL, for tests that need narrowing to keep going.
const wideMenu: MenuItem[] = [
  ...menu,
  dish({ name: 'Tea Leaf Salad', dietary_tags: ['vegetarian'] }),
  dish({ name: 'Coconut Rice', dietary_tags: ['vegan'] }),
  dish({ name: 'Garlic Noodles', dietary_tags: ['vegetarian'] }),
];

test('shouldStopNarrowing stops on small pool or question cap', () => {
  assert.ok(wideMenu.length > TARGET_POOL); // fixture guard
  assert.equal(shouldStopNarrowing(wideMenu, 0), false);
  assert.equal(shouldStopNarrowing(menu, 0), true); // pool ≤ TARGET (slate-era 8)
  assert.equal(shouldStopNarrowing(menu.slice(0, 3), 0), true);
  assert.equal(shouldStopNarrowing(wideMenu, 3), true); // dynamic cap reached
});

test('widenRankPool leaves a rankable pool untouched', () => {
  const narrowed = menu.slice(0, MIN_RANK_POOL);
  assert.deepEqual(widenRankPool(narrowed, menu), narrowed);
});

test('widenRankPool backfills a crashed pool from the pre-answer pool', () => {
  // The corpus case: an answer narrowed the pool to a single dish.
  const narrowed = [menu[6]]; // Burmese Shrimp
  const widened = widenRankPool(narrowed, wideMenu);
  // The user's lane leads, backfill follows in pre-answer order, no dupes.
  assert.equal(widened[0].name, 'Burmese Shrimp');
  assert.equal(widened.length, TARGET_POOL);
  assert.equal(new Set(widened.map((d) => d.id)).size, widened.length);
  assert.equal(widened.filter((d) => d.name === 'Burmese Shrimp').length, 1);
  // Backfill preserves the previous pool's order.
  assert.equal(widened[1].name, wideMenu[0].name);
});

test('widenRankPool uses everything when the previous pool is small', () => {
  const previous = menu.slice(0, 4);
  const widened = widenRankPool([menu[0]], previous);
  assert.equal(widened.length, 4); // 1 + 3 backfill — all there is
  assert.deepEqual(new Set(widened.map((d) => d.id)), new Set(previous.map((d) => d.id)));
});

test('widenRankPool never mutates its inputs', () => {
  const narrowed = [menu[6]];
  const before = [...wideMenu];
  widenRankPool(narrowed, wideMenu);
  assert.deepEqual(narrowed, [menu[6]]);
  assert.deepEqual(wideMenu, before);
});

test('choicesToQA round-trips spice + facet choices into Question/Answers', () => {
  const q = nextQuestion(menu, new Set())!;
  const chickenOpt = q.options.find((o) => o.value === 'chicken')!;
  const { questions, answers } = choicesToQA([spiceChoice(3), facetChoice(q, chickenOpt)]);
  assert.equal(questions.length, 2);
  assert.equal(answers['spice'], '3');
  assert.equal(answers['protein'], 'chicken');
  assert.equal(questions[1].options[0].label, 'Chicken');
});

test('a full narrowing run converges to a small candidate set', () => {
  let pool = filterBySpice(wideMenu, 3);
  const asked = new Set<string>();
  let dynamic = 0;
  while (!shouldStopNarrowing(pool, dynamic)) {
    const q = nextQuestion(pool, asked);
    if (!q) break;
    pool = filterByFacet(pool, q.facetId, q.options[0].value); // always pick the top option
    asked.add(q.facetId);
    dynamic++;
  }
  assert.ok(pool.length >= 1 && pool.length <= menu.length);
});

test('parseSpiceCeiling accepts stored 1–3, falls back for everything else', () => {
  assert.equal(parseSpiceCeiling('1'), 1);
  assert.equal(parseSpiceCeiling('2'), 2);
  assert.equal(parseSpiceCeiling('3'), 3);
  // Absent, old 1–5-scale values, and garbage all fall back to the default.
  assert.equal(parseSpiceCeiling(null), DEFAULT_SPICE);
  assert.equal(parseSpiceCeiling(undefined), DEFAULT_SPICE);
  assert.equal(parseSpiceCeiling('5'), DEFAULT_SPICE);
  assert.equal(parseSpiceCeiling('0'), DEFAULT_SPICE);
  assert.equal(parseSpiceCeiling('mild'), DEFAULT_SPICE);
  assert.equal(parseSpiceCeiling('2.5'), DEFAULT_SPICE);
});
