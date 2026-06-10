/**
 * Unit tests for the review-cache policy in callReviews — key normalization,
 * the 14-day TTL, and model-output coercion.
 *
 *   npx tsx --test src/lib/callReviews.test.ts
 *   (or: npm test)
 *
 * Pure functions only — no API key, no network, no AsyncStorage.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cacheKeyFor,
  normalizeRestaurantName,
  normalizeReviews,
  parseCachedReviews,
  REVIEWS_TTL_MS,
  type ReviewsResult,
} from './callReviews';

const FOUND: ReviewsResult = {
  found: true,
  restaurant_blurb: 'Casual Burmese spot in Berkeley.',
  crowd_favorites: [
    { name: 'Tea Leaf Salad', blurb: 'Reviewers call it a must-order.' },
    { name: 'Coconut Chicken Noodle Soup', blurb: 'Praised for the rich broth.' },
  ],
};

const record = (at: number, result: ReviewsResult = FOUND) => JSON.stringify({ at, result });

// --- name normalization / cache keys ----------------------------------------

test('normalizeRestaurantName collapses case, punctuation, and whitespace', () => {
  assert.equal(normalizeRestaurantName('  Burma  Light! '), 'burma light');
  assert.equal(normalizeRestaurantName('BURMA-LIGHT'), 'burma light');
  assert.equal(normalizeRestaurantName("Bùi's Café"), 'bui s cafe'); // accents stripped
});

test('equivalent spellings hit the same cache key', () => {
  assert.equal(cacheKeyFor('Burma Light'), cacheKeyFor(' burma   light!! '));
  assert.notEqual(cacheKeyFor('Burma Light'), cacheKeyFor('Burma Bites'));
});

// --- TTL policy --------------------------------------------------------------

test('a record fetched within 14 days parses back', () => {
  const now = Date.now();
  const fresh = parseCachedReviews(record(now - REVIEWS_TTL_MS + 60_000), now);
  assert.ok(fresh);
  assert.equal(fresh.crowd_favorites.length, 2);
});

test('a record older than 14 days is expired', () => {
  const now = Date.now();
  assert.equal(parseCachedReviews(record(now - REVIEWS_TTL_MS - 1), now), null);
});

test('a future-dated record (clock skew) is treated as expired, not pinned', () => {
  const now = Date.now();
  assert.equal(parseCachedReviews(record(now + 60_000), now), null);
});

test('absent / malformed / wrong-shape cache values parse to null', () => {
  assert.equal(parseCachedReviews(null), null);
  assert.equal(parseCachedReviews(undefined), null);
  assert.equal(parseCachedReviews(''), null);
  assert.equal(parseCachedReviews('not json {'), null);
  assert.equal(parseCachedReviews(JSON.stringify({ result: FOUND })), null); // no `at`
  assert.equal(parseCachedReviews(record(Date.now(), { ...FOUND, found: false })), null);
});

// --- model-output coercion ----------------------------------------------------

test('normalizeReviews keeps only well-formed favorites, capped at 5', () => {
  const r = normalizeReviews({
    found: true,
    restaurant_blurb: '  A blurb.  ',
    crowd_favorites: [
      { name: ' Mohinga ', blurb: ' Great broth. ' },
      { name: '', blurb: 'nameless — dropped' },
      { notName: 'x' },
      ...[1, 2, 3, 4, 5].map((i) => ({ name: `Dish ${i}`, blurb: '' })),
    ],
  });
  assert.equal(r.found, true);
  assert.equal(r.restaurant_blurb, 'A blurb.');
  assert.equal(r.crowd_favorites.length, 5); // 6 valid in, capped to 5
  assert.deepEqual(r.crowd_favorites[0], { name: 'Mohinga', blurb: 'Great broth.' });
});

test('normalizeReviews returns a dry result for found:false or no favorites', () => {
  assert.equal(normalizeReviews({ found: false }).found, false);
  assert.equal(normalizeReviews({ found: true, crowd_favorites: [] }).found, false);
  assert.equal(normalizeReviews(undefined).found, false);
  assert.equal(normalizeReviews('garbage').found, false);
});
