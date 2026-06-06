/** Shared types for the plAIt pipeline. */

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description: string;
  ingredients: string[];
  flavor_profile: string[]; // umami, sweet, tangy, smoky, savory, rich
  texture: string[]; // crispy, soft, creamy, fresh, chewy
  spice_level: number; // 0–5
  dietary_tags: string[]; // halal, vegan, vegetarian, gluten-free
  protein_type: string[]; // beef, chicken, seafood, pork, lamb, vegetarian
  cuisine_type: string;
};

export type QuestionOption = {
  label: string;
  value: string;
  emoji: string | null;
};

/**
 * A question shown to the user. Questions are written by the Vision call
 * (menu_context.dimensions), with one fixed hunger question prepended.
 */
export type Question = {
  id: string;
  question_text: string;
  options: QuestionOption[];
};

/** Map of questionId -> chosen option value. */
export type Answers = Record<string, string>;

/** A model-written menu dimension is exactly a Question. */
export type VisionDimension = Question;

/** Menu context produced by the Vision call (Call 1). */
export type VisionMenuContext = {
  cuisine_type: string;
  dimensions: VisionDimension[];
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
