/**
 * Deterministic narrowing engine — the "smart questions" brain.
 *
 * Philosophy (AI-waiter spec): questions are assets that should slice the
 * REMAINING candidates hard, and they should feel like a real server: "chicken,
 * beef, lamb, or shrimp?" not "meat or seafood?" → "red or white?". So instead
 * of cascading binary splits, each question is built dynamically from the actual
 * facet values present on THIS menu (sub-proteins, flavors, cooking styles).
 *
 * It is PURE and runs entirely on-device against the structured menu model — it
 * sends NOTHING to a language model. Zero tokens per question. The LLM is
 * reserved for orientation (Stage 1) and reasoning over the small final
 * candidate set (Stage 3). The one fixed question is spice (a 3-way selector).
 */
import type { Answers, MenuItem, Question } from './types';

// ---------------------------------------------------------------------------
// Spice — the one constant question (3-way selector)
// ---------------------------------------------------------------------------

export type SpiceLevel = 1 | 2 | 3;

export const SPICE_LEVELS: { level: SpiceLevel; label: string; emoji: string; hint: string }[] = [
  { level: 1, label: 'Mild', emoji: '🧊', hint: 'Keep it gentle — no surprises' },
  { level: 2, label: 'Medium', emoji: '🌶️', hint: 'Some kick is welcome' },
  { level: 3, label: 'Hot', emoji: '🔥', hint: 'Bring the fire' },
];

export const DEFAULT_SPICE: SpiceLevel = 2;

/**
 * Parse a persisted spice ceiling (AsyncStorage string). Absent values, old
 * 1–5-scale levels out of range, and garbage all fall back to DEFAULT_SPICE —
 * never trust storage shapes from older installs.
 */
export function parseSpiceCeiling(raw: string | null | undefined): SpiceLevel {
  const n = Number(raw);
  return n === 1 || n === 2 || n === 3 ? (n as SpiceLevel) : DEFAULT_SPICE;
}

/**
 * Dishes carry a 0–5 spice_level from the enrichment model; the user picks one
 * of three tolerances. Map tolerance → the hottest dish heat we'll keep:
 * mild admits only barely-spiced food, medium cuts the genuinely fiery end,
 * hot admits everything.
 */
const MAX_DISH_HEAT: Record<SpiceLevel, number> = { 1: 1, 2: 3, 3: 5 };

/**
 * Keep dishes at or below the chosen tolerance. Unknown spice (0) always
 * stays. If nothing survives, return the pool unchanged rather than stranding
 * the user.
 */
export function filterBySpice(pool: MenuItem[], tolerance: SpiceLevel): MenuItem[] {
  const max = MAX_DISH_HEAT[tolerance] ?? 5;
  const kept = pool.filter((i) => (i.spice_level ?? 0) <= max);
  return kept.length > 0 ? kept : pool;
}

// ---------------------------------------------------------------------------
// Facets — each turns into a dynamic, multi-option question built from the pool
// ---------------------------------------------------------------------------

type FacetMeta = { label: string; emoji: string };

type Facet = {
  id: string;
  question: string;
  /** Classify an item into a value key, or null if the facet doesn't apply. */
  classify: (item: MenuItem) => string | null;
  /** Human label + emoji for a value key. */
  meta: (key: string) => FacetMeta;
  /** Cap on options shown (proteins get more room than flavors). */
  maxOptions: number;
};

const text = (i: MenuItem) => `${i.name} ${i.description}`.toLowerCase();
const lower = (xs: string[] | undefined) => (xs ?? []).map((s) => s.toLowerCase());
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Protein (sub-protein) — the headline question ──────────────────────────
// Order matters: specific seafood before generic "fish", proteins before
// fallbacks. Name keywords first (most specific), then the coarse protein_type.
const PROTEIN_RULES: { key: string; kw: string[] }[] = [
  { key: 'shrimp', kw: ['shrimp', 'prawn'] },
  { key: 'lobster', kw: ['lobster'] },
  { key: 'crab', kw: ['crab'] },
  { key: 'salmon', kw: ['salmon'] },
  { key: 'tuna', kw: ['tuna', 'ahi'] },
  { key: 'seabass', kw: ['sea bass', 'seabass', 'branzino'] },
  { key: 'whitefish', kw: ['swai', 'catfish', 'basa', 'cod', 'halibut', 'tilapia', 'snapper', 'trout'] },
  { key: 'fish', kw: ['fish'] },
  { key: 'duck', kw: ['duck'] },
  { key: 'chicken', kw: ['chicken'] },
  { key: 'beef', kw: ['beef', 'steak', 'ribeye', 'tri tip', 'tri-tip', 'bulgogi', 'brisket'] },
  { key: 'lamb', kw: ['lamb', 'goat'] },
  { key: 'pork', kw: ['pork', 'bacon'] },
  { key: 'tofu', kw: ['tofu'] },
  { key: 'veggie', kw: ['eggplant', 'mushroom', 'paneer', 'vegetable'] },
];

const PROTEIN_META: Record<string, FacetMeta> = {
  shrimp: { label: 'Shrimp', emoji: '🦐' },
  lobster: { label: 'Lobster', emoji: '🦞' },
  crab: { label: 'Crab', emoji: '🦀' },
  salmon: { label: 'Salmon', emoji: '🐟' },
  tuna: { label: 'Tuna', emoji: '🐟' },
  seabass: { label: 'Sea bass', emoji: '🐟' },
  whitefish: { label: 'White fish', emoji: '🐠' },
  fish: { label: 'Fish', emoji: '🐟' },
  seafood: { label: 'Seafood', emoji: '🦐' },
  duck: { label: 'Duck', emoji: '🦆' },
  chicken: { label: 'Chicken', emoji: '🍗' },
  beef: { label: 'Beef', emoji: '🥩' },
  lamb: { label: 'Lamb', emoji: '🐑' },
  pork: { label: 'Pork', emoji: '🐖' },
  tofu: { label: 'Tofu', emoji: '🧊' },
  veggie: { label: 'Vegetarian', emoji: '🥗' },
};

function classifyProtein(item: MenuItem): string | null {
  const t = text(item);
  for (const rule of PROTEIN_RULES) if (rule.kw.some((k) => t.includes(k))) return rule.key;
  // Fall back to the coarse enriched protein_type.
  const p = lower(item.protein_type)[0];
  if (!p || p === 'unknown' || p === 'mixed') return null;
  if (p === 'vegetarian' || p === 'vegan') return 'veggie';
  return p; // beef | chicken | fish | seafood | lamb | pork
}

// ── Flavor — the second consistent question ────────────────────────────────
const FLAVOR_RULES: { key: string; tags: string[]; kw: string[] }[] = [
  { key: 'spicy', tags: ['spicy'], kw: ['chili', 'sambal', 'jalapeno', 'jalapeño', 'curry paste', 'hot'] },
  { key: 'sweet', tags: ['sweet'], kw: ['honey', 'mango', 'pumpkin', 'coconut', 'lychee', 'sweet'] },
  { key: 'fresh', tags: ['fresh', 'tangy', 'citrus', 'sour', 'herbaceous'], kw: ['lemongrass', 'basil', 'mint', 'lime', 'tamarind', 'ginger', 'cilantro'] },
  { key: 'savory', tags: ['rich', 'savory', 'smoky', 'umami', 'hearty'], kw: ['black pepper', 'garlic', 'hoisin', 'oyster', 'sesame', 'soy', 'masala', 'curry'] },
];

const FLAVOR_META: Record<string, FacetMeta> = {
  spicy: { label: 'Spicy & bold', emoji: '🌶️' },
  sweet: { label: 'Sweet & mellow', emoji: '🍯' },
  fresh: { label: 'Fresh & herby', emoji: '🌿' },
  savory: { label: 'Rich & savory', emoji: '🧈' },
};

function classifyFlavor(item: MenuItem): string | null {
  const tags = lower(item.flavor_profile);
  for (const rule of FLAVOR_RULES) if (rule.tags.some((tg) => tags.includes(tg))) return rule.key;
  const t = text(item);
  for (const rule of FLAVOR_RULES) if (rule.kw.some((k) => t.includes(k))) return rule.key;
  return null;
}

// ── Cooking style — a tertiary slice when protein/flavor aren't enough ─────
const STYLE_RULES: { key: string; kw: string[] }[] = [
  { key: 'curry', kw: ['curry'] },
  { key: 'stirfry', kw: ['kebat', 'wok', 'stir', 'black pepper', 'basil', 'tofu'] },
  { key: 'grilled', kw: ['grill', 'steamed', 'roast', 'bbq'] },
  { key: 'fried', kw: ['fried', 'crispy', 'tempura', 'honey'] },
  { key: 'rice', kw: ['biryani', 'rice', 'noodle'] },
];

const STYLE_META: Record<string, FacetMeta> = {
  curry: { label: 'Curry', emoji: '🍛' },
  stirfry: { label: 'Stir-fried', emoji: '🥘' },
  grilled: { label: 'Grilled', emoji: '🔥' },
  fried: { label: 'Crispy fried', emoji: '🍤' },
  rice: { label: 'Rice / noodle', emoji: '🍚' },
};

function classifyStyle(item: MenuItem): string | null {
  const t = text(item);
  for (const rule of STYLE_RULES) if (rule.kw.some((k) => t.includes(k))) return rule.key;
  return null;
}

/** Fixed priority — the waiter always works protein → flavor → style. */
const FACETS: Facet[] = [
  {
    id: 'protein',
    question: 'What are you in the mood for?',
    classify: classifyProtein,
    meta: (k) => PROTEIN_META[k] ?? { label: titleCase(k), emoji: '🍽️' },
    maxOptions: 7,
  },
  {
    id: 'flavor',
    question: 'What flavor are you feeling?',
    classify: classifyFlavor,
    meta: (k) => FLAVOR_META[k] ?? { label: titleCase(k), emoji: '🍽️' },
    maxOptions: 4,
  },
  {
    id: 'style',
    question: 'How should it be cooked?',
    classify: classifyStyle,
    meta: (k) => STYLE_META[k] ?? { label: titleCase(k), emoji: '🍽️' },
    maxOptions: 5,
  },
];

// ---------------------------------------------------------------------------
// Building + selecting questions
// ---------------------------------------------------------------------------

export const TARGET_POOL = 4; // stop narrowing once the pool is this small
export const MAX_DYNAMIC_QUESTIONS = 3; // besides the constant spice question

export type EngineOption = { value: string; label: string; emoji: string; count: number };
export type EngineQuestion = { facetId: string; question: string; options: EngineOption[] };

/** Build a facet's question for a pool, or null if it can't split it (<2 values). */
function buildQuestion(facet: Facet, pool: MenuItem[]): EngineQuestion | null {
  const dist = new Map<string, number>();
  for (const item of pool) {
    const k = facet.classify(item);
    if (k) dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  if (dist.size < 2) return null; // needs ≥2 distinct values to be worth asking
  const options = [...dist.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, facet.maxOptions)
    .map(([value, count]) => ({ value, count, ...facet.meta(value) }));
  return { facetId: facet.id, question: facet.question, options };
}

/** The next question for a pool, in fixed priority order, skipping asked facets. */
export function nextQuestion(pool: MenuItem[], askedFacetIds: Set<string>): EngineQuestion | null {
  for (const facet of FACETS) {
    if (askedFacetIds.has(facet.id)) continue;
    const q = buildQuestion(facet, pool);
    if (q) return q;
  }
  return null;
}

/** Narrow the pool to dishes matching the chosen value of a facet. */
export function filterByFacet(pool: MenuItem[], facetId: string, value: string): MenuItem[] {
  const facet = FACETS.find((f) => f.id === facetId);
  if (!facet) return pool;
  const kept = pool.filter((i) => facet.classify(i) === value);
  return kept.length > 0 ? kept : pool; // never strand the user
}

/** True once we should stop asking and move to recommendations. */
export function shouldStopNarrowing(pool: MenuItem[], dynamicAsked: number): boolean {
  return pool.length <= TARGET_POOL || dynamicAsked >= MAX_DYNAMIC_QUESTIONS;
}

// ---------------------------------------------------------------------------
// Bridge to the reasoning/detail calls (Question + Answers shape)
// ---------------------------------------------------------------------------

export type EngineChoice = { questionId: string; questionText: string; answerLabel: string; answerValue: string };

export function spiceChoice(level: SpiceLevel): EngineChoice {
  const meta = SPICE_LEVELS.find((s) => s.level === level);
  return {
    questionId: 'spice',
    questionText: 'How much heat do you want?',
    answerLabel: meta?.label ?? `Level ${level}`,
    answerValue: String(level),
  };
}

export function facetChoice(question: EngineQuestion, option: EngineOption): EngineChoice {
  return {
    questionId: question.facetId,
    questionText: question.question,
    answerLabel: option.label,
    answerValue: option.value,
  };
}

/** Convert recorded choices into the Question[]/Answers pair callReason expects. */
export function choicesToQA(choices: EngineChoice[]): { questions: Question[]; answers: Answers } {
  const questions: Question[] = choices.map((c) => ({
    id: c.questionId,
    question_text: c.questionText,
    options: [{ label: c.answerLabel, value: c.answerValue, emoji: null }],
  }));
  const answers: Answers = Object.fromEntries(choices.map((c) => [c.questionId, c.answerValue]));
  return { questions, answers };
}
