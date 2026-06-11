/** Shared types for the plAIt pipeline. */

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description: string;
  ingredients: string[];
  flavor_profile: string[]; // rich, fresh, savory, smoky, sweet, tangy, spicy
  texture: string[]; // crispy, soft, creamy, fresh, chewy
  spice_level: number; // 0–5
  dietary_tags: string[]; // halal, vegan, vegetarian, gluten-free
  protein_type: string[]; // beef, chicken, seafood, fish, pork, lamb, vegetarian
  /** Coarse menu section, used by the narrowing engine. */
  category: string; // starter, main, side, dessert, drink
  cuisine_type: string;
  /**
   * Rough protein estimate (grams/serving) from the enrichment pass — a
   * name-only guess, only good enough for the protein-per-dollar value sort
   * (lib/proteinValue). 0 or absent = unknown.
   */
  protein_g_est?: number;
};

export type QuestionOption = {
  label: string;
  value: string;
  emoji: string | null;
};

/**
 * A narrowing question + the user's answer, recorded by the question engine and
 * passed to the reasoning / dish-detail calls as context.
 */
export type Question = {
  id: string;
  question_text: string;
  options: QuestionOption[];
};

/** Map of questionId -> chosen option value. */
export type Answers = Record<string, string>;

/**
 * Stage 1 "orientation" — a concise read of the restaurant a great server would
 * give before you look at anything. Written by the Vision call so it costs no
 * extra round-trip.
 */
export type MenuOrientation = {
  /** 1–2 sentence plain summary of what this place is. */
  summary: string;
  /** What the restaurant is known for / its strengths. */
  known_for: string[];
  /** item ids of signature / can't-go-wrong dishes. */
  signature_item_ids: string[];
};

/** Menu context produced by the Vision call (Call 1). */
export type VisionMenuContext = {
  /** Restaurant name as printed on the menu ("" when not visible). Keys the
   *  review cache so the scan flow can surface crowd favorites for free. */
  restaurant_name: string;
  cuisine_type: string;
  /** Orientation summary for Stage 1 (the narrowing questions are engine-built). */
  orientation: MenuOrientation;
  /** Whole-menu footer/header notes: halal/kosher certs, allergen policies, etc. */
  restaurant_notes: string[];
};

/** What callVision returns: the parsed items plus the model's menu_context. */
export type VisionResult = {
  items: MenuItem[];
  menu_context: VisionMenuContext;
};

export type Pick = {
  rank: 1 | 2 | 3;
  item_id: string;
  match_score: number; // 0–100
  why: string;
  flag: null | 'verify_halal' | 'contains_allergen' | 'spicier_than_stated';
  // Estimated macros per serving (null if model couldn't estimate)
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  // Confidence in the macro estimates
  confidence: 'high' | 'medium' | 'low' | null;
};
