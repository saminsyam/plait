/**
 * Lazy "tell me more" call for a single recommended dish. Fired the first time a
 * user expands a pick card, then cached in memory by the results screen so
 * re-opening is instant and free. Uses Haiku for speed/cost.
 */
import { callMessages, parseJson, VISION_MODEL } from './anthropic';
import type { Answers, MenuItem, Pick, Question } from './types';
import type { TdeeGoals } from '@/state/profile';

export type DishDetail = {
  why_this_pick: string;
  how_to_order: string[];
  safety_detail: string[];
  why_not_others: string;
};

const SYSTEM = `You are plAIt's dish detail explainer. Given a recommended dish, the user's
dietary profile, their answers, and the other ranked picks, return ONLY a JSON
object (no markdown, no preamble) with this exact shape:

{
  "why_this_pick": "2-3 sentences on why this dish fits THIS user's profile and answers. Specific, not generic.",
  "how_to_order": ["1-2 concrete modifications to optimize for their goal"],
  "safety_detail": ["expand each safety flag into one clear sentence, or empty array if none"],
  "why_not_others": "one sentence on what this beats — ONLY for the #1 pick, else empty string"
}

Keep it concise and concrete. Reference their actual numbers and constraints.`;

type DishDetailInput = {
  pick: Pick;
  item: MenuItem;
  preferences: string;
  tdee: TdeeGoals | null;
  questions: Question[];
  answers: Answers;
  otherPicks: { name: string; why: string }[];
  isTopPick: boolean;
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

/** Returns structured detail for one dish. Throws if the model output is unusable. */
export async function callDishDetail({
  pick,
  item,
  preferences,
  tdee,
  questions,
  answers,
  otherPicks,
  isTopPick,
}: DishDetailInput): Promise<DishDetail> {
  const payload = {
    dish: {
      name: item.name,
      price: item.price,
      protein_g: pick.protein_g,
      carbs_g: pick.carbs_g,
      fat_g: pick.fat_g,
      flag: pick.flag,
      rank: pick.rank,
    },
    user_profile: preferences || '(none given)',
    user_targets: tdee
      ? `${tdee.calories} kcal, Protein ${tdee.protein_g}g, Carbs ${tdee.carbs_g}g, Fat ${tdee.fat_g}g`
      : '(no targets set)',
    user_answers: describeAnswers(questions, answers),
    other_picks: otherPicks,
    is_top_pick: isTopPick,
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
    how_to_order: asStringArray(parsed.how_to_order),
    safety_detail: asStringArray(parsed.safety_detail),
    why_not_others:
      isTopPick && typeof parsed.why_not_others === 'string' ? parsed.why_not_others.trim() : '',
  };

  // If the model gave us nothing usable, treat it as a failure so the UI can
  // fall back to the existing one-sentence reasoning.
  if (!detail.why_this_pick && detail.how_to_order.length === 0 && detail.safety_detail.length === 0) {
    throw new Error('Empty dish detail');
  }

  return detail;
}
