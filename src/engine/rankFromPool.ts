/**
 * Shared prep + ranking for a candidate pool. Both the camera pipeline (the
 * instant Popular rank, run inline so the picks screen lands fully formed) and
 * the picks screen's `runRank` (Popular fallback + Custom) build the same
 * `callReason` inputs: the crowd-favorite NAMES for dishes still in the pool,
 * and the verify map narrowed to the pool. This keeps that prep in one place.
 */
import { callReason } from './callReason';
import type { OnProgress } from './progress';
import type { Answers, MenuItem, Pick, Question } from './types';

export async function rankFromPool(input: {
  pool: MenuItem[];
  questions: Question[];
  answers: Answers;
  preferences: string;
  verifyById: Record<string, string[]>;
  restaurantNotes: string[];
  /** itemId → crowd-favorite name; pool dishes present here get cited. */
  crowdMap: Record<string, string>;
  onProgress?: OnProgress;
}): Promise<Pick[]> {
  const { pool, questions, answers, preferences, verifyById, restaurantNotes, crowdMap, onProgress } =
    input;
  const crowdNames = pool.filter((i) => crowdMap[i.id]).map((i) => i.name);
  const verifyForPool = Object.fromEntries(
    Object.entries(verifyById).filter(([id]) => pool.some((i) => i.id === id))
  );
  return callReason({
    items: pool,
    questions,
    answers,
    userPreferences: preferences,
    verifyById: verifyForPool,
    restaurantNotes,
    crowdFavorites: crowdNames,
    onProgress,
  });
}
