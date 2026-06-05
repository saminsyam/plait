/**
 * My hardcoded demo profile.
 *
 * This is a single-user demo — edit this file directly to demo different
 * scenarios (different goals, restrictions, allergens). No accounts, no DB.
 */

export const MY_PROFILE = {
  dietary_restrictions: ['halal'], // hard block — never recommend violations
  allergens: ['shellfish'], // always flag these
  food_goal: 'build_muscle', // shapes recommendation language
  protein_target_g: 180, // used to rank picks
  notes: 'high-protein, halal, avoids shellfish',
} as const;

export type Profile = typeof MY_PROFILE;
