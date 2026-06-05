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

export type MenuContext = {
  totalItems: number;
  cuisine_type: string;
  spice_distribution: { none: number; mild: number; medium: number; hot: number };
  protein_split: Record<string, number>;
  texture_split: Record<string, number>;
  sub_protein_split: Record<string, number> | null; // salmon vs tuna on sushi
  cooking_style_split: Record<string, number> | null; // karahi vs tandoor, baked vs fried
  uniform_traits: string[]; // traits shared by >90% of items — never ask about these
  high_signal_dimensions: HighSignalDimension[];
};

export type HighSignalDimension = {
  dimension: string;
  elimination_power: number; // 0–1, higher = splits menu more evenly
  options_present: string[];
};

export type QuestionOption = {
  label: string;
  value: string;
  emoji?: string;
};

export type Question = {
  id: string;
  text: string;
  options: QuestionOption[];
};

/** Map of questionId -> chosen option value. */
export type Answers = Record<string, string>;

/**
 * Menu context produced by the Vision call (Call 1). Distinct from the
 * pure-TS MenuContext above: these dimensions and questions are written by
 * the model directly from the menu, ready to render as questions.
 */
export type VisionDimension = {
  id: string;
  question_text: string;
  options: { label: string; value: string; emoji: string | null }[];
};

export type VisionMenuContext = {
  cuisine_type: string;
  dimensions: VisionDimension[];
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
};
