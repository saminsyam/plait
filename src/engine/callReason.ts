/**
 * Call 2 — Reasoning. Given the menu, the user's answers, and dietary
 * preferences, return exactly 3 ranked picks with macro estimates.
 */
import { callMessagesStream, parseJson } from './anthropic';
import type { OnProgress } from './progress';
import type { Answers, MenuItem, Pick, Question } from './types';

const SYSTEM = `You are a friendly menu recommendation engine, like a great waiter.
Given menu items, the user's question answers, and free-text dietary
preferences, return exactly 3 ranked picks.

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

Items may carry "protein_g_est" — a rough name-only protein guess from an
earlier pass. Use it as a starting point for "protein_g", refining with any
ingredient/portion signal you have; never treat it as authoritative.

Some items may be marked "needs_verification": true with a "verify_reasons" list.
These passed an on-device safety pre-filter only as UNCERTAIN (not confirmed safe) —
e.g. a meat dish whose halal slaughter could not be verified, or a dish whose
allergen status is unclear. Items that definitively violate a hard restriction
were already removed before you saw them, so you never need to filter for safety
yourself — but treat needs_verification items with appropriate caution.

Rules:
- A "needs_verification" item may appear in the top 3 ONLY if it is genuinely a
  strong fit. When you include one, you MUST append an explicit
  "Verify with staff: <the specific reason>" clause to its "why".
- Prefer a confidently-safe (not needs_verification) item over a needs_verification
  one when their quality is otherwise comparable.
- For a needs_verification item whose reason concerns halal/kosher, set
  flag = "verify_halal".
- "why" must name specific ingredients, not generic phrases
- If fewer than 3 items match cleanly, return 1 or 2 — don't force bad picks
- If a restaurant note states the kitchen is halal- or kosher-certified, you do NOT
  need to set flag = "verify_halal" for its dishes — the certification covers it

Output ONLY a JSON array of picks. No preamble, no markdown fences.`;

type ReasonInput = {
  /**
   * The rankable items — the survivors of the deterministic hard-gate
   * (`allowed` + `verify`). `blocked` items are NEVER passed here.
   */
  items: MenuItem[];
  questions: Question[];
  answers: Answers;
  /** The user's free-text dietary preferences (smart-parsed tags feed the gate). */
  userPreferences: string;
  /**
   * item_id → reasons for the `verify` items. Items present here are marked
   * `needs_verification` in the payload so the model can attach a verify note.
   */
  verifyById?: Record<string, string[]>;
  /** Whole-menu footer/header notes (halal certs, allergen policies, etc.). */
  restaurantNotes?: string[];
  /**
   * Names of candidate dishes that web reviews repeatedly praise (matched
   * on-device). One short context line — lets picks cite real crowd opinion.
   */
  crowdFavorites?: string[];
  /** Live status reporting for the loading screen. */
  onProgress?: OnProgress;
};

/**
 * Slim a gate survivor down to the fields the ranking prompt actually uses.
 * `category` and `cuisine_type` only serve the on-device narrowing engine,
 * which has already run; empty/zero fields carry no signal worth the tokens.
 */
function slimItem(item: MenuItem): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id, name: item.name };
  if (item.price > 0) out.price = item.price;
  if (item.description) out.description = item.description;
  if (item.ingredients.length > 0) out.ingredients = item.ingredients;
  if (item.flavor_profile.length > 0) out.flavor_profile = item.flavor_profile;
  if (item.texture.length > 0) out.texture = item.texture;
  if (item.spice_level > 0) out.spice_level = item.spice_level;
  if (item.dietary_tags.length > 0) out.dietary_tags = item.dietary_tags;
  if (item.protein_type.length > 0) out.protein_type = item.protein_type;
  // Name-only protein guess from enrichment — grounds the macro estimates.
  // ~4 tokens/item, worth the signal.
  if ((item.protein_g_est ?? 0) > 0) out.protein_g_est = item.protein_g_est;
  return out;
}

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
  verifyById,
  restaurantNotes,
  crowdFavorites,
  onProgress,
}: ReasonInput): Promise<Pick[]> {
  // Annotate the verify survivors so the model knows which picks require a
  // "verify with staff" note. Allowed items are passed through untouched.
  const menuItems = items.map((item) => {
    const slim = slimItem(item);
    const reasons = verifyById?.[item.id];
    return reasons && reasons.length > 0
      ? { ...slim, needs_verification: true, verify_reasons: reasons }
      : slim;
  });

  const userPayload = {
    answers: describeAnswers(questions, answers),
    menu_items: menuItems,
  };

  let contextBlock = `User dietary preferences: "${userPreferences}"\n`;
  if (restaurantNotes && restaurantNotes.length > 0) {
    contextBlock += `Restaurant notes (apply to whole menu): ${restaurantNotes
      .map((n) => `"${n}"`)
      .join('; ')}\n`;
  }
  if (crowdFavorites && crowdFavorites.length > 0) {
    contextBlock += `Web reviews repeatedly praise: ${crowdFavorites
      .map((n) => `"${n}"`)
      .join(', ')} — worth citing if one becomes a pick.\n`;
  }
  onProgress?.({
    id: 'rank',
    icon: '👨‍🍳',
    label: 'Weighing your matches',
    detail: `${items.length} ${items.length === 1 ? 'dish' : 'dishes'} in the running`,
    status: 'active',
  });
  let lastPick = 0;
  const { text: raw, stopReason } = await callMessagesStream({
    system: SYSTEM,
    label: 'reason.rank',
    maxTokens: 2000,
    content: [
      {
        type: 'text',
        text:
          'Pick the best dishes for me from this menu.\n\n' +
          contextBlock +
          '\n' +
          JSON.stringify(userPayload),
      },
    ],
    // Each pick carries one "item_id" key — counting them as they stream in
    // tells the user which pick is being written right now.
    onText: (text) => {
      const count = (text.match(/"item_id"/g) ?? []).length;
      if (count !== lastPick && count >= 1 && count <= 3) {
        lastPick = count;
        onProgress?.({
          id: 'rank',
          icon: '👨‍🍳',
          label: 'Weighing your matches',
          detail: `writing pick #${count}…`,
          status: 'active',
        });
      }
    },
  });
  if (stopReason === 'max_tokens') throw new Error('TRUNCATED');

  const picks = parseJson<Pick[]>(raw);
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error('No suitable picks were returned for this menu.');
  }
  onProgress?.({
    id: 'rank',
    icon: '👨‍🍳',
    label: 'Picks ranked',
    detail: `top ${Math.min(picks.length, 3)} ready`,
    status: 'done',
  });

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
