/**
 * Keto agent — an on-demand specialist rank, fired the first time the user
 * flips the "Keto?" toggle on a scan, then cached for the rest of the scan.
 * Unlike the tune chips (which select from the main slate on-device), keto
 * gets its own model call because its judgment is different in kind: net
 * carbs, and above all the SWAP — the one kitchen-realistic modification
 * ("bun → lettuce wrap") that makes a non-keto dish keto. Swaps exist ONLY
 * here; no other call emits them.
 */
import { callMessagesStream, parseJson } from './anthropic';
import { slimItem } from './callReason';
import type { OnProgress } from './progress';
import type { MenuItem, Pick } from './types';

const SYSTEM = `You are plAIt's keto specialist — a low-carb coach reading a restaurant menu.
Given menu items and the user's dietary preferences, return the best picks for
a ketogenic way of eating: minimal net carbs, solid protein and fat.

Your signature move is the SWAP: one practical, kitchen-realistic modification
that makes a dish keto (or more keto) — "swap the bun for a lettuce wrap",
"skip the rice, double the grilled vegetables", "no croutons, dressing on the
side". A dish that is NOT keto as printed can still rank well IF one simple
swap fixes it. Use null when the dish is keto-ready as ordered.

Return 3 to 5 picks as a JSON array, each matching this shape exactly:
{
  "rank": number,               // 1..5, best keto fit first
  "item_id": string,
  "match_score": number,        // 0–100 keto fit AFTER the swap
  "why": string,                // one or two tight sentences combining WHAT the dish is (key ingredients, preparation) with WHY it works for keto — name the carbs you kept off the plate
  "flag": null | "verify_halal" | "contains_allergen" | "spicier_than_stated",
  "swap": string | null,        // the one modification to order it keto, null if none needed
  "protein_g": number | null,   // estimated grams AS ORDERED WITH THE SWAP APPLIED
  "carbs_g": number | null,     //   "
  "fat_g": number | null,       //   "
  "confidence": "high" | "medium" | "low"  // confidence in the macro estimates
}

Rules:
- Macros describe the plate WITH the swap applied — that is what the user eats.
- The user's stated dietary preferences still apply — keto never overrides them.
- Items marked "needs_verification" passed a safety pre-filter only as
  UNCERTAIN: include one only if it is genuinely a strong keto fit, append
  "Verify with staff: <the specific reason>" to its "why", and set the
  matching flag (halal/kosher reasons → "verify_halal").
- Don't force picks: if a menu offers almost nothing keto-able even with
  swaps, return fewer — even 1 or 2 — rather than padding.

Output ONLY the JSON array. No preamble, no markdown fences.`;

type KetoInput = {
  /** The rankable pool — gate survivors, already spice-trimmed. */
  items: MenuItem[];
  userPreferences: string;
  /** item_id → reasons; flagged in the payload like the main rank call. */
  verifyById?: Record<string, string[]>;
  restaurantNotes?: string[];
  onProgress?: OnProgress;
};

/** Ranks the pool for keto fit. Every returned pick carries `swap` (or null). */
export async function callKeto({
  items,
  userPreferences,
  verifyById,
  restaurantNotes,
  onProgress,
}: KetoInput): Promise<Pick[]> {
  const menuItems = items.map((item) => {
    const slim = slimItem(item);
    const reasons = verifyById?.[item.id];
    return reasons && reasons.length > 0
      ? { ...slim, needs_verification: true, verify_reasons: reasons }
      : slim;
  });

  let contextBlock = `User dietary preferences: "${userPreferences}"\n`;
  if (restaurantNotes && restaurantNotes.length > 0) {
    contextBlock += `Restaurant notes (apply to whole menu): ${restaurantNotes
      .map((n) => `"${n}"`)
      .join('; ')}\n`;
  }

  onProgress?.({
    id: 'keto',
    icon: '🥑',
    label: 'Keto agent reading the menu',
    detail: `${items.length} ${items.length === 1 ? 'dish' : 'dishes'} to weigh`,
    status: 'active',
  });
  let lastPick = 0;
  const { text: raw, stopReason } = await callMessagesStream({
    system: SYSTEM,
    label: 'keto.rank',
    maxTokens: 2200,
    content: [
      {
        type: 'text',
        text:
          'Find my best keto orders on this menu — swaps welcome.\n\n' +
          contextBlock +
          '\n' +
          JSON.stringify({ menu_items: menuItems }),
      },
    ],
    onText: (text) => {
      const count = (text.match(/"item_id"/g) ?? []).length;
      if (count !== lastPick && count >= 1 && count <= 5) {
        lastPick = count;
        onProgress?.({
          id: 'keto',
          icon: '🥑',
          label: 'Keto agent reading the menu',
          detail: `writing keto pick #${count}…`,
          status: 'active',
        });
      }
    },
  });
  if (stopReason === 'max_tokens') throw new Error('TRUNCATED');

  const picks = parseJson<Pick[]>(raw);
  if (!Array.isArray(picks) || picks.length === 0) {
    throw new Error('No keto-able picks were returned for this menu.');
  }
  const validIds = new Set(items.map((i) => i.id));
  const slate = picks
    .filter((p) => validIds.has(p.item_id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((p) => ({
      ...p,
      suits: [], // tune chips never apply to the keto slate
      swap: typeof p.swap === 'string' && p.swap.trim() !== '' ? p.swap.trim() : null,
      protein_g: typeof p.protein_g === 'number' ? p.protein_g : null,
      carbs_g: typeof p.carbs_g === 'number' ? p.carbs_g : null,
      fat_g: typeof p.fat_g === 'number' ? p.fat_g : null,
      confidence: p.confidence ?? null,
    }));
  if (slate.length === 0) throw new Error('No keto-able picks were returned for this menu.');
  const swaps = slate.filter((p) => p.swap).length;
  onProgress?.({
    id: 'keto',
    icon: '🥑',
    label: 'Keto picks ready',
    detail: `${slate.length} picked${swaps > 0 ? `, ${swaps} with a swap` : ''}`,
    status: 'done',
  });
  return slate;
}
