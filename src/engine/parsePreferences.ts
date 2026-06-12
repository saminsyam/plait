/**
 * Smart tag extraction — a single Haiku call that reads the user's free-text
 * dietary description and pulls out the structured HARD constraints (allergens
 * with severity, religious rules) that feed the deterministic dietary gate.
 *
 *   "halal, allergic to shellfish, trying to avoid gluten, love spicy food"
 *     → [ { kind: "religious", rule: "halal" },
 *         { kind: "allergen", allergen: "shellfish", severity: "severe" },
 *         { kind: "allergen", allergen: "gluten",    severity: "mild" } ]
 *
 * Soft preferences (spicy, high-protein, …) are intentionally NOT returned —
 * they stay in the free text and flow to the model as ranking context. Only
 * safety-critical facts become hard constraints. Never throws: any failure
 * yields [] so the flow degrades to "no hard gate" rather than crashing.
 */
import { callMessages, parseJson, VISION_MODEL } from './anthropic';
import type { HardConstraints } from './dietaryFilter';

const SYSTEM = `You extract HARD dietary constraints from a user's free-text description.
A hard constraint is a safety/observance rule that must NEVER be violated: food
allergies/intolerances, and religious diets (halal, kosher).

Return ONLY valid JSON — no preamble, no markdown. An array of:
  { "kind": "allergen", "allergen": <lowercase common name>, "severity": "severe" | "mild" }
  { "kind": "religious", "rule": "halal" | "kosher" }

Rules:
- "allergy", "allergic", "anaphylactic", "severe" → severity "severe"
- "intolerant", "intolerance", "avoid", "sensitive to", "can't handle", "no ___" → severity "mild"
- Normalize allergen names to lowercase common form ("tree nuts" not "Tree Nuts", "shellfish", "gluten", "dairy", "peanuts", "soy", "eggs", "sesame", "fish").
- Only emit religious rules that are explicitly stated (halal or kosher).
- Do NOT emit soft preferences (spicy, high-protein, low-carb, vegetarian taste prefs, cuisines). Those are not hard constraints.
- If there are no hard constraints, return [].`;

const isHardConstraint = (c: unknown): c is HardConstraints[number] => {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (o.kind === 'allergen') {
    return typeof o.allergen === 'string' && (o.severity === 'severe' || o.severity === 'mild');
  }
  if (o.kind === 'religious') return o.rule === 'halal' || o.rule === 'kosher';
  return false;
};

/**
 * Smart-parse free text into hard constraints. Never throws — returns [] on
 * empty input, network error, or unparseable output.
 */
export async function parsePreferences(text: string): Promise<HardConstraints> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const raw = await callMessages({
      system: SYSTEM,
      model: VISION_MODEL, // Haiku — fast + cheap, ample for extraction
      label: 'prefs.parse',
      maxTokens: 500,
      content: [{ type: 'text', text: trimmed }],
    });

    const parsed = parseJson<unknown>(raw);
    if (!Array.isArray(parsed)) return [];

    const out: HardConstraints = [];
    const seen = new Set<string>();
    for (const c of parsed) {
      if (!isHardConstraint(c)) continue;
      const key =
        c.kind === 'allergen' ? `a:${c.allergen.toLowerCase()}` : `r:${c.rule}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        c.kind === 'allergen'
          ? { kind: 'allergen', allergen: c.allergen.toLowerCase(), severity: c.severity }
          : { kind: 'religious', rule: c.rule }
      );
    }
    return out;
  } catch {
    return [];
  }
}
