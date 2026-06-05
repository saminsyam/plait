/**
 * Pure TypeScript question builder. Turns the MenuContext into a short,
 * menu-aware question funnel that sounds like a good server, not a form.
 * Same menu always produces the same questions — no history, no skip logic.
 */
import { analyzeMenu } from './analyzeMenu';
import type { MenuContext, MenuItem, Question, QuestionOption } from './types';

const MAX_QUESTIONS = 5;

// Server-style prompt text per dimension.
const DIMENSION_TEXT: Record<string, string> = {
  spice: 'How spicy are we going tonight?',
  sub_protein: 'Any fish preference tonight?',
  cooking_style: "What kind of vibe are you after?",
  protein: "What are you in the mood for?",
  texture: 'What texture are you craving?',
};

// Pretty labels + emoji for known option values. Falls back to title-case.
const OPTION_META: Record<string, { label?: string; emoji?: string }> = {
  // spice
  none: { label: 'Keep it mild', emoji: '🧊' },
  mild: { label: 'A little kick', emoji: '🌶️' },
  medium: { label: 'Medium heat', emoji: '🔥' },
  hot: { label: 'Bring the heat', emoji: '🥵' },
  // protein
  beef: { emoji: '🥩' },
  chicken: { emoji: '🍗' },
  lamb: { emoji: '🐑' },
  seafood: { emoji: '🐟' },
  fish: { emoji: '🐟' },
  pork: { emoji: '🐖' },
  vegetarian: { label: 'Veggie', emoji: '🥗' },
  // sub-protein
  salmon: { emoji: '🍣' },
  tuna: { emoji: '🍣' },
  albacore: { label: 'Albacore', emoji: '🐟' },
  shrimp: { emoji: '🍤' },
  crab: { emoji: '🦀' },
  scallop: { emoji: '🐚' },
  eel: { label: 'Eel', emoji: '🍣' },
  yellowtail: { emoji: '🐠' },
  // cooking style
  baked: { emoji: '🔥' },
  fried: { emoji: '🍤' },
  raw: { label: 'Fresh & raw', emoji: '🍣' },
  karahi: { emoji: '🍲' },
  tandoor: { label: 'Tandoor', emoji: '🔥' },
  nihari: { emoji: '🍛' },
  korma: { label: 'Creamy korma', emoji: '🍛' },
  biryani: { emoji: '🍚' },
  taco: { emoji: '🌮' },
  burrito: { emoji: '🌯' },
  bowl: { emoji: '🥣' },
  grilled: { emoji: '🔥' },
  // texture
  crispy: { emoji: '✨' },
  soft: { emoji: '☁️' },
  creamy: { emoji: '🥛' },
  fresh: { emoji: '🥬' },
  chewy: { emoji: '🍥' },
};

function titleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function toOption(value: string): QuestionOption {
  const meta = OPTION_META[value] ?? {};
  return { value, label: meta.label ?? titleCase(value), emoji: meta.emoji };
}

const HUNGER_QUESTION: Question = {
  id: 'hunger',
  text: 'How hungry are you feeling right now?',
  options: [
    { value: 'light', label: 'Light bite', emoji: '🍃' },
    { value: 'medium', label: 'Medium', emoji: '🍽️' },
    { value: 'starving', label: 'Starving', emoji: '🤤' },
  ],
};

/**
 * Build the question set from already-parsed menu items.
 * Accepts either raw items (runs analyzeMenu internally) or a MenuContext.
 */
export function buildQuestionSet(input: MenuItem[] | MenuContext): Question[] {
  const context: MenuContext = Array.isArray(input) ? analyzeMenu(input) : input;

  const questions: Question[] = [HUNGER_QUESTION];

  for (const dim of context.high_signal_dimensions) {
    if (questions.length >= MAX_QUESTIONS) break;

    const options = dim.options_present.map(toOption);
    if (options.length < 2) continue; // nothing to choose between

    options.push({ value: 'any', label: 'No preference', emoji: '🤷' });

    questions.push({
      id: dim.dimension,
      text: DIMENSION_TEXT[dim.dimension] ?? `Pick your ${dim.dimension}`,
      options,
    });
  }

  return questions;
}
