/**
 * Unit tests for the deterministic dietary hard-gate.
 *
 *   npx tsx --test src/lib/dietaryFilter.test.ts
 *   (or: npm test)
 *
 * Pure functions only — no API key, no network. These are the Phase-1 gate.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyHardGate,
  classifyAgainstConstraint,
  type EnrichedItem,
  type HardConstraint,
} from './dietaryFilter';

// --- helpers ---------------------------------------------------------------

function item(partial: Partial<EnrichedItem> & { name: string }): EnrichedItem {
  return {
    id: partial.id ?? partial.name.toLowerCase().replace(/\s+/g, '-'),
    name: partial.name,
    price: partial.price ?? 0,
    description: partial.description ?? '',
    ingredients: partial.ingredients ?? [],
    flavor_profile: partial.flavor_profile ?? [],
    texture: partial.texture ?? [],
    spice_level: partial.spice_level ?? 0,
    dietary_tags: partial.dietary_tags ?? [],
    protein_type: partial.protein_type ?? [],
    category: partial.category ?? 'main',
    cuisine_type: partial.cuisine_type ?? 'unknown',
  };
}

const SHELLFISH_SEVERE: HardConstraint = { kind: 'allergen', allergen: 'shellfish', severity: 'severe' };
const SHELLFISH_MILD: HardConstraint = { kind: 'allergen', allergen: 'shellfish', severity: 'mild' };
const PEANUT_SEVERE: HardConstraint = { kind: 'allergen', allergen: 'peanut', severity: 'severe' };
const PEANUT_MILD: HardConstraint = { kind: 'allergen', allergen: 'peanut', severity: 'mild' };
const HALAL: HardConstraint = { kind: 'religious', rule: 'halal' };

// Outcome of a single item run through a single constraint.
function outcomeOf(it: EnrichedItem, constraint: HardConstraint) {
  const r = applyHardGate([it], [constraint]);
  if (r.blocked.length) return { outcome: 'blocked' as const, reasons: r.blocked[0].reasons };
  if (r.verify.length) return { outcome: 'verify' as const, reasons: r.verify[0].reasons };
  return { outcome: 'allowed' as const, reasons: [] as string[] };
}

// --- severe allergen -------------------------------------------------------

test('severe allergen present (protein) → blocked', () => {
  const it = item({ name: 'Shrimp Scampi', protein_type: ['seafood'] });
  assert.equal(outcomeOf(it, SHELLFISH_SEVERE).outcome, 'blocked');
});

test('severe allergen present (name keyword) → blocked even without protein tag', () => {
  const it = item({ name: 'Lobster Roll' }); // no protein_type at all
  assert.equal(outcomeOf(it, SHELLFISH_SEVERE).outcome, 'blocked');
});

test('severe allergen absent-confidently (specific non-conflicting protein) → allowed', () => {
  const it = item({ name: 'Grilled Chicken', protein_type: ['chicken'] });
  assert.equal(outcomeOf(it, SHELLFISH_SEVERE).outcome, 'allowed');
});

test('severe allergen tag-missing → verify with a mandatory staff-check (never silently dropped)', () => {
  const it = item({ name: 'House Special', protein_type: [] }); // untagged
  const res = outcomeOf(it, SHELLFISH_SEVERE);
  assert.equal(res.outcome, 'verify'); // recommend-with-warning, not blocked
  assert.match(res.reasons.join(' '), /confirm this is free of shellfish/);
});

test('severe allergen with ambiguous protein (mixed) → verify, never inferred safe', () => {
  const it = item({ name: 'Surf & Turf Plate', protein_type: ['mixed'] });
  assert.equal(outcomeOf(it, SHELLFISH_SEVERE).outcome, 'verify');
});

// --- mild allergen ---------------------------------------------------------

test('mild allergen tag-missing → verify (not blocked)', () => {
  const it = item({ name: 'Chefs Plate', protein_type: [] });
  const res = outcomeOf(it, PEANUT_MILD);
  assert.equal(res.outcome, 'verify');
  assert.match(res.reasons.join(' '), /could not verify absence of peanuts/);
});

test('mild allergen present → blocked', () => {
  const it = item({ name: 'Pad Thai with peanuts' });
  assert.equal(outcomeOf(it, PEANUT_MILD).outcome, 'blocked');
});

test('mild shellfish, confident clear protein → allowed', () => {
  const it = item({ name: 'Beef Burger', protein_type: ['beef'] });
  assert.equal(outcomeOf(it, SHELLFISH_MILD).outcome, 'allowed');
});

// --- religious -------------------------------------------------------------

test('halal conflict (pork protein) → blocked', () => {
  const it = item({ name: 'Pork Belly Bowl', protein_type: ['pork'] });
  assert.equal(outcomeOf(it, HALAL).outcome, 'blocked');
});

test('halal conflict (bacon keyword) → blocked', () => {
  const it = item({ name: 'Bacon Benedict', protein_type: [] });
  assert.equal(outcomeOf(it, HALAL).outcome, 'blocked');
});

test('halal conflict (alcohol keyword) → blocked', () => {
  const it = item({ name: 'Beer-Battered Cod', protein_type: ['fish'] });
  assert.equal(outcomeOf(it, HALAL).outcome, 'blocked');
});

test('halal uncertain (land meat, no halal tag) → verify', () => {
  const it = item({ name: 'Bulgogi Benedict', protein_type: ['beef'] });
  const res = outcomeOf(it, HALAL);
  assert.equal(res.outcome, 'verify');
  assert.match(res.reasons.join(' '), /could not verify halal/);
});

test('halal clear (explicit halal tag) → allowed', () => {
  const it = item({ name: 'Halal Chicken Over Rice', protein_type: ['chicken'], dietary_tags: ['halal'] });
  assert.equal(outcomeOf(it, HALAL).outcome, 'allowed');
});

test('halal clear (fish needs no slaughter) → allowed', () => {
  const it = item({ name: 'Salmon Benedict', protein_type: ['fish'] });
  assert.equal(outcomeOf(it, HALAL).outcome, 'allowed');
});

// --- empty constraints -----------------------------------------------------

test('empty constraints → everything allowed, nothing blocked', () => {
  const items = [
    item({ name: 'Pork Belly Bowl', protein_type: ['pork'] }),
    item({ name: 'Lobster Roll' }),
    item({ name: 'Mystery Plate' }),
  ];
  const r = applyHardGate(items, []);
  assert.equal(r.allowed.length, 3);
  assert.equal(r.verify.length, 0);
  assert.equal(r.blocked.length, 0);
});

// --- multi-hit: most restrictive + merged reasons --------------------------

test('multi-hit item takes most-restrictive outcome and merges reasons', () => {
  // Seafood dish: shellfish (severe) → conflict → blocked. Halal: seafood is a
  // "clear" protein, so only the shellfish reason applies. Conflict wins.
  const it = item({ name: 'Seafood Medley', protein_type: ['seafood'] });
  const r = applyHardGate([it], [SHELLFISH_SEVERE, HALAL]);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reasons.join(' '), /shellfish/);

  // Untagged dish: shellfish-severe → verify, halal → verify. Both unknown, so
  // the worst is verify (not blocked) and both reasons accumulate.
  const untagged = item({ name: 'Daily Special', protein_type: [] });
  const r2 = applyHardGate([untagged], [SHELLFISH_SEVERE, HALAL]);
  assert.equal(r2.blocked.length, 0);
  assert.equal(r2.verify.length, 1);
  const reasons = r2.verify[0].reasons.join(' | ');
  assert.match(reasons, /shellfish/);
  assert.match(reasons, /halal/);
});

test('classifyAgainstConstraint returns conflict/clear/unknown directly', () => {
  assert.equal(
    classifyAgainstConstraint(item({ name: 'Pork Chop', protein_type: ['pork'] }), HALAL),
    'conflict'
  );
  assert.equal(
    classifyAgainstConstraint(item({ name: 'Salmon', protein_type: ['fish'] }), HALAL),
    'clear'
  );
  assert.equal(
    classifyAgainstConstraint(item({ name: 'Steak', protein_type: ['beef'] }), HALAL),
    'unknown'
  );
});

// --- canonical benchmark scenario (deterministic, offline) -----------------
// Berkeley Social Club brunch, profile = halal + (high-protein is a SOFT goal,
// not a hard gate). The gate must: keep Salmon Benedict rankable (allowed),
// block any pork/bacon item, and route the marinade-uncertain Bulgogi to verify.

test('Berkeley Social Club brunch under halal: gate routes items correctly', () => {
  const menu: EnrichedItem[] = [
    item({ name: 'Salmon Benedict', protein_type: ['fish'], price: 25 }),
    item({ name: 'Bulgogi Benedict', protein_type: ['beef'], price: 22 }),
    item({ name: 'Classic Bacon Benedict', protein_type: ['pork'], price: 18 }),
    item({ name: 'Avocado Toast', protein_type: ['vegetarian'], dietary_tags: ['vegetarian'], price: 16 }),
  ];
  const r = applyHardGate(menu, [HALAL]);

  const names = (xs: { item: EnrichedItem }[]) => xs.map((x) => x.item.name);
  const allowedNames = r.allowed.map((i) => i.name);

  assert.ok(allowedNames.includes('Salmon Benedict'), 'Salmon Benedict must be allowed/rankable');
  assert.ok(allowedNames.includes('Avocado Toast'), 'Vegetarian dish must be allowed');
  assert.ok(names(r.verify).includes('Bulgogi Benedict'), 'Bulgogi must be verify, not dropped/allowed');
  assert.ok(names(r.blocked).includes('Classic Bacon Benedict'), 'Bacon must be blocked');
  // Bacon must never be rankable.
  assert.ok(!allowedNames.includes('Classic Bacon Benedict'));
});

test('severe keyword-only allergen on a name-only menu → all verify (NOT a wiped-out menu)', () => {
  // Regression: a severe peanut allergy on a menu whose dish names don't mention
  // peanuts must NOT block everything — it should recommend-with-warning so the
  // user still gets picks. (Burma Light bug.)
  const menu = [
    item({ name: 'Garden Salad' }),
    item({ name: 'Mystery Stir Fry' }),
    item({ name: 'Black Pepper Chicken', protein_type: ['chicken'] }),
  ];
  const r = applyHardGate(menu, [PEANUT_SEVERE]);
  assert.equal(r.blocked.length, 0, 'nothing affirmatively contains peanut → nothing blocked');
  assert.equal(r.verify.length, 3, 'all surface as verify-with-staff');
  assert.equal(r.allowed.length, 0);
  for (const v of r.verify) assert.match(v.reasons.join(' '), /confirm this is free of peanuts/);
});

test('severe allergen still HARD-blocks a dish that names the allergen', () => {
  const r = applyHardGate([item({ name: 'Peanut Noodles' })], [PEANUT_SEVERE]);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].reasons.join(' '), /contains peanuts/);
});
