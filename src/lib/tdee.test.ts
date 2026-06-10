/**
 * Unit tests for the on-device TDEE + macro math.
 *
 *   npx tsx --test src/lib/tdee.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeTdee, ftInToCm, lbsToKg, type TdeeInput } from './tdee';

const BASE: TdeeInput = {
  age: 28,
  weightKg: 75,
  heightCm: 178,
  sex: 'male',
  activity: 'moderate',
  goal: 'maintain',
};

test('maintain matches Mifflin-St Jeor × activity', () => {
  // BMR = 10*75 + 6.25*178 - 5*28 + 5 = 1727.5; × 1.55 = 2677.625
  const r = computeTdee(BASE);
  assert.equal(r.calories, Math.round(1727.5 * 1.55));
});

test('female BMR is 166 kcal below male at equal stats', () => {
  const male = computeTdee(BASE);
  const female = computeTdee({ ...BASE, sex: 'female' });
  // (base+5) - (base-161) = 166, scaled by the activity multiplier. Each side
  // rounds independently, so allow ±1.
  assert.ok(Math.abs(male.calories - female.calories - 166 * 1.55) <= 1);
});

test('goal ordering: cut < maintain < bulk calories', () => {
  const cut = computeTdee({ ...BASE, goal: 'cut' });
  const maintain = computeTdee(BASE);
  const bulk = computeTdee({ ...BASE, goal: 'bulk' });
  assert.ok(cut.calories < maintain.calories);
  assert.ok(maintain.calories < bulk.calories);
});

test('protein scales with body weight, not calories', () => {
  const light = computeTdee({ ...BASE, weightKg: 55 });
  const heavy = computeTdee({ ...BASE, weightKg: 100 });
  assert.equal(light.protein_g, Math.round(1.6 * 55));
  assert.equal(heavy.protein_g, Math.round(1.6 * 100));
});

test('cut feeds MORE protein per kg than maintain (muscle-sparing)', () => {
  const cut = computeTdee({ ...BASE, goal: 'cut' });
  const maintain = computeTdee(BASE);
  assert.ok(cut.protein_g > maintain.protein_g);
});

test('macros approximately add back up to calories', () => {
  const r = computeTdee(BASE);
  const fromMacros = r.protein_g * 4 + r.carbs_g * 4 + r.fat_g * 9;
  assert.ok(Math.abs(fromMacros - r.calories) <= 10, `${fromMacros} vs ${r.calories}`);
});

test('carbs clamp to zero on extreme inputs instead of going negative', () => {
  const r = computeTdee({
    age: 60,
    weightKg: 150,
    heightCm: 150,
    sex: 'female',
    activity: 'sedentary',
    goal: 'cut',
  });
  assert.ok(r.carbs_g >= 0);
});

test('unit conversions', () => {
  assert.ok(Math.abs(lbsToKg(165) - 74.84) < 0.01);
  assert.ok(Math.abs(ftInToCm(5, 10) - 177.8) < 0.01);
});
