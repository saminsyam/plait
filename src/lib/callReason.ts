/**
 * Call 2 — Reasoning. Given the menu, the user's answers and their dietary
 * profile, return exactly 3 ranked picks (or fewer if nothing else fits).
 */
import { MY_PROFILE } from '../config/profile';
import { callMessages, parseJson } from './anthropic';
import type { Answers, MenuItem, Pick, Question } from './types';

const SYSTEM = `You are a friendly menu recommendation engine, like a great waiter.
Given menu items, the user's question answers, and their dietary profile,
return exactly 3 ranked picks.

For each pick return:
{
  "rank": 1|2|3,
  "item_id": string,
  "match_score": number,        // 0–100
  "why": string,                // one sentence, conversational, specific
  "flag": null | "verify_halal" | "contains_allergen" | "spicier_than_stated"
}

Rules:
- NEVER recommend anything violating dietary_restrictions or allergens
- Halal confidence below 4/5 → set flag = "verify_halal"
- Allergen present → set flag = "contains_allergen", never silently filter
- "why" must be specific ("baked salmon, mild eel sauce") not generic
  ("matches your preferences")
- If fewer than 3 items match cleanly, return 1 or 2 — don't force bad picks

Output ONLY a JSON array of picks. No preamble, no markdown fences.`;

type ReasonInput = {
  items: MenuItem[];
  questions: Question[];
  answers: Answers;
};

/** Turn raw answer values into "Question -> chosen label" for the prompt. */
function describeAnswers(questions: Question[], answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const value = answers[q.id];
    if (!value) continue;
    const label = q.options.find((o) => o.value === value)?.label ?? value;
    out[q.text] = label;
  }
  return out;
}

export async function callReason({ items, questions, answers }: ReasonInput): Promise<Pick[]> {
  const userPayload = {
    profile: MY_PROFILE,
    answers: describeAnswers(questions, answers),
    menu_items: items,
  };

  const raw = await callMessages({
    system: SYSTEM,
    maxTokens: 1500,
    content: [
      {
        type: 'text',
        text:
          'Pick the best dishes for me from this menu.\n\n' +
          JSON.stringify(userPayload, null, 2),
      },
    ],
  });

  const picks = parseJson<Pick[]>(raw);
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error('No suitable picks were returned for this menu.');
  }

  // Keep only picks that point at a real menu item, then sort by rank and cap at 3.
  const validIds = new Set(items.map((i) => i.id));
  return picks
    .filter((p) => validIds.has(p.item_id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 3);
}
