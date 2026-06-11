/**
 * "Would the questions actually help here?" — a deterministic heuristic, no
 * model judgment. The results screen shows a single dismissible nudge line
 * when instant picks are likely to be generic; everyone else never sees the
 * quiz mentioned. Pure function so the policy is unit-testable.
 */
import type { Pick } from './types';

/** Pool sizes above this are too broad to rank sharply without narrowing. */
const BROAD_POOL = 25;
/** Below this match score on every pick, the ranking itself looks unsure. */
const LOW_SCORE = 60;

export type NudgeInput = {
  /** Size of the (spice-trimmed) pool the instant rank ran over. */
  poolSize: number;
  /** The user's free-text dietary preferences ('' when unset). */
  preferencesText: string;
  picks: Pick[];
};

/**
 * Nudge copy when refinement would plausibly sharpen the picks, else null.
 * Triggers: a broad pool with no stated preferences to steer it, a rank that
 * returned fewer than 3 picks, or uniformly low match scores.
 */
export function refineNudge({ poolSize, preferencesText, picks }: NudgeInput): string | null {
  if (picks.length === 0) return null; // nothing ranked — nothing to sharpen

  if (poolSize > BROAD_POOL && preferencesText.trim() === '') {
    return 'This menu’s broad — a few quick questions will sharpen these.';
  }
  if (picks.length < 3) {
    return 'Slim pickings on the first pass — a few quick questions may surface more.';
  }
  if (picks.every((p) => p.match_score < LOW_SCORE)) {
    return 'None of these scream you yet — a few quick questions will help.';
  }
  return null;
}
