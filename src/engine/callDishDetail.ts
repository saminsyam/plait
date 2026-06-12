/**
 * Lazy "tell me more" call for a single recommended dish. Fired the first time
 * a user opens a pick's detail sheet, then cached in memory by the picks screen
 * so re-opening is instant and free. Uses Haiku for speed/cost.
 *
 * Besides the fuller "why", it returns `explain_terms` — the tap-to-explain
 * dictionary for the sheet: unfamiliar words from the why text mapped to
 * plain-language explanations (spec §2.4: the explanation is the product).
 */
import { callMessages, parseJson, VISION_MODEL } from './anthropic';
import type { Answers, MenuItem, Pick, Question } from './types';

export type DishDetail = {
  why_this_pick: string;
  safety_detail: string[];
  /** term (verbatim from the why text) → one-sentence plain explanation. */
  explain_terms: Record<string, string>;
};

const SYSTEM = `You are plAIt's dish detail explainer. Given a recommended dish, the user's
dietary profile, and their answers, return ONLY a JSON object (no markdown, no
preamble) with this exact shape:

{
  "why_this_pick": "2-3 sentences on why this dish fits THIS user's profile and answers. Specific, not generic.",
  "safety_detail": ["expand each safety flag into one clear sentence, or empty array if none"],
  "explain_terms": { "term": "one friendly sentence explaining it in plain language" }
}

explain_terms rules:
- Choose 1-3 words or short phrases a first-time diner may not know (dish
  names, ingredients, techniques) that appear VERBATIM, exact casing, inside
  your "why_this_pick" text — they become tap-to-explain links in the app.
- Each explanation is one plain-language sentence. Empty object if nothing
  needs explaining.

Keep it concise and concrete. Reference their actual constraints.`;

type DishDetailInput = {
  pick: Pick;
  item: MenuItem;
  preferences: string;
  questions: Question[];
  answers: Answers;
};

function describeAnswers(questions: Question[], answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const value = answers[q.id];
    if (!value) continue;
    out[q.question_text] = q.options.find((o) => o.value === value)?.label ?? value;
  }
  return out;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

/** Keep only well-formed term → explanation pairs (cap 4 — it's a garnish). */
function asExplainTerms(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [term, expl] of Object.entries(v)) {
    if (typeof expl !== 'string' || term.trim() === '' || expl.trim() === '') continue;
    out[term] = expl.trim();
    if (Object.keys(out).length >= 4) break;
  }
  return out;
}

/** Returns structured detail for one dish. Throws if the model output is unusable. */
export async function callDishDetail({
  pick,
  item,
  preferences,
  questions,
  answers,
}: DishDetailInput): Promise<DishDetail> {
  const payload = {
    dish: {
      name: item.name,
      description: item.description || undefined,
      ingredients: item.ingredients.length > 0 ? item.ingredients : undefined,
      price: item.price,
      protein_g: pick.protein_g,
      carbs_g: pick.carbs_g,
      fat_g: pick.fat_g,
      flag: pick.flag,
      rank: pick.rank,
    },
    user_profile: preferences || '(none given)',
    user_answers: describeAnswers(questions, answers),
  };

  const raw = await callMessages({
    system: SYSTEM,
    model: VISION_MODEL,
    label: 'dish.detail',
    maxTokens: 700,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  });

  const parsed = parseJson<Partial<DishDetail>>(raw);

  const detail: DishDetail = {
    why_this_pick: typeof parsed.why_this_pick === 'string' ? parsed.why_this_pick.trim() : '',
    safety_detail: asStringArray(parsed.safety_detail),
    explain_terms: asExplainTerms(parsed.explain_terms),
  };

  // If the model gave us nothing usable, treat it as a failure so the UI can
  // fall back to the existing one-sentence reasoning.
  if (detail.why_this_pick === '' && detail.safety_detail.length === 0) {
    throw new Error('Empty dish detail');
  }

  return detail;
}
