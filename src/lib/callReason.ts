/**
 * Call 2 — Reasoning. Given the menu, the user's answers, dietary preferences,
 * and optional TDEE targets, return exactly 3 ranked picks with macro estimates.
 */
import { callMessages, parseJson } from './anthropic';
import type { Answers, MenuItem, Pick, Question } from './types';

const SYSTEM = `You are a friendly menu recommendation engine, like a great waiter.
Given menu items, the user's question answers, free-text dietary preferences,
and optional daily macro targets, return exactly 3 ranked picks.

For each pick return JSON matching this shape exactly:
{
  "rank": 1|2|3,
  "item_id": string,
  "match_score": number,        // 0–100
  "why": string,                // one sentence, conversational, specific to THIS dish
  "flag": null | "verify_halal" | "contains_allergen" | "spicier_than_stated",
  "protein_g": number | null,   // estimated grams per serving, null if unknown
  "carbs_g": number | null,
  "fat_g": number | null,
  "confidence": "high" | "medium" | "low"  // confidence in the macro estimates
}

Confidence guide: high = nutrition info stated on menu, medium = can infer from
ingredients, low = rough estimate from dish type only.

Rules:
- NEVER recommend anything that violates a hard restriction (halal, no shellfish, etc.)
- Halal confidence below 4/5 → flag = "verify_halal"
- Allergen present → flag = "contains_allergen", never silently filter
- "why" must name specific ingredients, not generic phrases
- If fewer than 3 items match cleanly, return 1 or 2 — don't force bad picks
- If TDEE/macro targets are provided, prioritise dishes that fit the targets best
- If a per-person budget is provided, prefer dishes at or under it. You may include
  ONE slightly-over pick if it's clearly the best fit, but say so in "why"
- If a restaurant note states the kitchen is halal- or kosher-certified, you do NOT
  need to set flag = "verify_halal" for its dishes — the certification covers it

Output ONLY a JSON array of picks. No preamble, no markdown fences.`;

type ReasonInput = {
  items: MenuItem[];
  questions: Question[];
  answers: Answers;
  userPreferences: string;
  tdeeContext?: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  } | null;
  /** Per-person budget the user set (null/undefined = no budget). */
  budget?: number | null;
  /** Whole-menu footer/header notes (halal certs, allergen policies, etc.). */
  restaurantNotes?: string[];
};

function describeAnswers(questions: Question[], answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const value = answers[q.id];
    if (!value) continue;
    const label = q.options.find((o) => o.value === value)?.label ?? value;
    out[q.question_text] = label;
  }
  return out;
}

export async function callReason({
  items,
  questions,
  answers,
  userPreferences,
  tdeeContext,
  budget,
  restaurantNotes,
}: ReasonInput): Promise<Pick[]> {
  const userPayload = {
    answers: describeAnswers(questions, answers),
    menu_items: items,
  };

  let contextBlock = `User dietary preferences: "${userPreferences}"\n`;
  if (tdeeContext) {
    contextBlock +=
      `User daily targets: ${tdeeContext.calories} kcal, ` +
      `Protein ${tdeeContext.protein_g}g, Carbs ${tdeeContext.carbs_g}g, Fat ${tdeeContext.fat_g}g\n`;
  }
  if (budget && budget > 0) {
    contextBlock += `User budget: $${budget} per person — prefer dishes at or under this.\n`;
  }
  if (restaurantNotes && restaurantNotes.length > 0) {
    contextBlock += `Restaurant notes (apply to whole menu): ${restaurantNotes
      .map((n) => `"${n}"`)
      .join('; ')}\n`;
  }

  const raw = await callMessages({
    system: SYSTEM,
    maxTokens: 2000,
    content: [
      {
        type: 'text',
        text:
          'Pick the best dishes for me from this menu.\n\n' +
          contextBlock +
          '\n' +
          JSON.stringify(userPayload, null, 2),
      },
    ],
  });

  const picks = parseJson<Pick[]>(raw);
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error('No suitable picks were returned for this menu.');
  }

  const validIds = new Set(items.map((i) => i.id));
  return picks
    .filter((p) => validIds.has(p.item_id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3)
    .map((p) => ({
      ...p,
      // Coerce nulls in case model omits fields
      protein_g: typeof p.protein_g === 'number' ? p.protein_g : null,
      carbs_g: typeof p.carbs_g === 'number' ? p.carbs_g : null,
      fat_g: typeof p.fat_g === 'number' ? p.fat_g : null,
      confidence: p.confidence ?? null,
    }));
}
