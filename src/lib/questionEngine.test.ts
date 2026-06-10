/**
 * Unit tests for the deterministic narrowing engine. Pure — no API, no network.
 *   npm test
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { MenuItem } from './types';
import {
  choicesToQA,
  facetChoice,
  filterByFacet,
  filterBySpice,
  nextQuestion,
  shouldStopNarrowing,
  spiceChoice,
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

test('filterBySpice keeps dishes at/below tolerance, falls back if all too hot', () => {
  assert.ok(!filterBySpice(menu, 3).some((d) => d.name === 'Chili Basil Chicken')); // 4 > 3
  const fiery = [dish({ name: 'Ghost Curry', spice_level: 5 })];
  assert.deepEqual(filterBySpice(fiery, 1), fiery); // nothing ≤1 → keep pool
});

test('shouldStopNarrowing stops on small pool or question cap', () => {
  assert.equal(shouldStopNarrowing(menu, 0), false);
  assert.equal(shouldStopNarrowing(menu.slice(0, 3), 0), true); // pool ≤ TARGET
  assert.equal(shouldStopNarrowing(menu, 3), true); // dynamic cap reached
});

test('choicesToQA round-trips spice + facet choices into Question/Answers', () => {
  const q = nextQuestion(menu, new Set())!;
  const chickenOpt = q.options.find((o) => o.value === 'chicken')!;
  const { questions, answers } = choicesToQA([spiceChoice(4), facetChoice(q, chickenOpt)]);
  assert.equal(questions.length, 2);
  assert.equal(answers['spice'], '4');
  assert.equal(answers['protein'], 'chicken');
  assert.equal(questions[1].options[0].label, 'Chicken');
});

test('a full narrowing run converges to a small candidate set', () => {
  let pool = filterBySpice(menu, 5);
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
