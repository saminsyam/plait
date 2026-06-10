/**
 * Two-layer menu pipeline (both on Haiku):
 *
 *   Layer 1 — Vision: read the photo into SLIM items (id / name / price only)
 *             plus menu_context (orientation + any restaurant_notes).
 *             Reading is all this layer does — no tagging.
 *   Layer 2 — Normalize: a text-only call that infers dietary_tags / protein_type
 *             / cuisine_type / spice_level from the slim items. No image.
 *
 * Why split? The old single call asked for ~11 fields per dish, so a 60-item
 * menu emitted ~8k output tokens — and output generation is the latency
 * bottleneck. Slimming the read and moving enrichment to a separate terse call
 * roughly halves total tokens. Merging by id reproduces the existing MenuItem
 * shape, so nothing downstream changes.
 *
 * Both layers stream (SSE), reporting real progress through `onProgress`:
 * a live dish count while Layer 1 reads, a live tag count during Layer 2.
 */
import { callMessagesStream, VISION_MODEL } from './anthropic';
import type { OnProgress } from './progress';
import type { MenuItem, MenuOrientation, VisionMenuContext, VisionResult } from './types';

// ---------------------------------------------------------------------------
// Layer 1 — read the menu (Vision)
// ---------------------------------------------------------------------------

const READ_SYSTEM = `You are a menu reader. Extract every dish from this menu photo.
Read only — do not infer, classify, or tag.

Per item return ONLY:
{
  "id": string,   // short unique id
  "name": string, // exactly as written
  "price": number // 0 if no price is listed
}
Name and price ONLY — do NOT add descriptions, ingredients, or any other field.
This keeps the read fast.

After the items, return a "menu_context" object. Set "restaurant_name" to the
restaurant's name exactly as printed on the menu ("" if it isn't shown).

In menu_context.orientation, act like a great server giving a 10-second intro
BEFORE the guest reads anything. Be concise and confident:
- "summary": 1–2 sentences on what kind of restaurant this is.
- "known_for": a few of its strengths / standout categories.
- "signature_dish_ids": ids of 1–3 can't-go-wrong dishes (use the ids above).

Also look for any footer or header text that applies to the entire menu —
halal/kosher certification statements, allergen notices, gluten-free policies,
gratuity notes — and extract them into "restaurant_notes" as short strings.
If none exist, return an empty array.

The menu_context shape is:
{
  "restaurant_name": string,  // exactly as printed on the menu; "" if not shown
  "cuisine_type": string,
  "orientation": {
    "summary": string,
    "known_for": string[],
    "signature_dish_ids": string[]
  },
  "restaurant_notes": string[]
}

Output ONLY valid JSON: { "items": [...], "menu_context": {...} }.
No markdown fences. No preamble.`;

const READ_USER =
  'Here is a photo of a restaurant menu. Read every item — just its name and price, ' +
  'no descriptions. Use a short unique id per item. ' +
  'Return only the JSON object { "items": [...], "menu_context": {...} }.';

type SlimItem = { id?: unknown; name?: unknown; price?: unknown };

/**
 * Send a base64 JPEG of the menu and return the normalized items plus the
 * model-written menu_context. Runs both pipeline layers, reporting real
 * progress (live dish/tag counts) through `onProgress`.
 */
export async function callVision(
  imageBase64: string,
  mediaType: string = 'image/jpeg',
  onProgress?: OnProgress
): Promise<VisionResult> {
  // ---- Layer 1: read the photo -------------------------------------------
  const t0 = Date.now();
  onProgress?.({ id: 'read', icon: '📖', label: 'Reading the menu', status: 'active' });
  let lastCount = 0;
  // Slim output (3 fields/item, no descriptions) keeps this well under the
  // token ceiling even for a 60-item menu; the cap is just a guard.
  const { text: raw, stopReason } = await callMessagesStream({
    system: READ_SYSTEM,
    model: VISION_MODEL,
    label: 'vision.read',
    maxTokens: 8000,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: READ_USER },
    ],
    // Each item carries exactly one "name" key, so counting them in the
    // streamed text gives an honest live dish count.
    onText: (text) => {
      const count = (text.match(/"name"/g) ?? []).length;
      if (count !== lastCount) {
        lastCount = count;
        onProgress?.({
          id: 'read',
          icon: '📖',
          label: 'Reading the menu',
          detail: `${count} ${count === 1 ? 'dish' : 'dishes'} spotted`,
          status: 'active',
        });
      }
    },
  });
  if (stopReason === 'max_tokens') throw new Error('TRUNCATED');

  const parsed = parseStrict(raw); // throws PARSE_FAILED
  const slim = Array.isArray(parsed.items) ? (parsed.items as SlimItem[]) : [];
  if (slim.length === 0) {
    throw new Error('Vision returned no menu items. Try a clearer, well-lit photo.');
  }
  const menu_context = normalizeMenuContext(parsed.menu_context);
  console.log(`[Vision] Layer 1 done in ${Date.now() - t0}ms (${slim.length} items)`);
  onProgress?.({
    id: 'read',
    icon: '📖',
    label: 'Menu read',
    detail: `${slim.length} dishes`,
    status: 'done',
  });

  // ---- Layer 2: enrich from text (graceful fallback on failure) ----------
  const t1 = Date.now();
  const enrichment = await normalizeItems(slim, onProgress);
  console.log(
    `[Normalize] Layer 2 done in ${Date.now() - t1}ms (${enrichment.size}/${slim.length} enriched)`
  );
  onProgress?.({
    id: 'tag',
    icon: '🏷️',
    label: 'Dietary info tagged',
    detail:
      enrichment.size > 0 ? `${enrichment.size} of ${slim.length} dishes` : 'skipped — dishes stay untagged',
    status: 'done',
  });

  const items = slim.map((s, i) =>
    mergeItem(s, enrichment.get(String(s.id ?? i + 1)), menu_context.cuisine_type, i)
  );
  console.log(`[Total] Vision pipeline done in ${Date.now() - t0}ms`);

  return { items, menu_context };
}

// ---------------------------------------------------------------------------
// Layer 2 — enrich items (Normalize, text only)
// ---------------------------------------------------------------------------

const NORMALIZE_SYSTEM = `You are a food analyst. For each menu item, infer structured
properties from its name. Be conservative.

Return ONLY a COMPACT JSON array (no markdown, no preamble, no extra whitespace),
one object per item, SAME order and SAME id as the input:
[{"id":<id>,"dietary_tags":["halal"|"vegetarian"|"vegan"|"gluten-free"],"protein_type":"beef|chicken|fish|seafood|lamb|pork|vegetarian|vegan|mixed|unknown","spice_level":0-5,"category":"starter|main|side|dessert|drink","flavor":["rich"|"savory"|"smoky"|"fresh"|"tangy"|"sweet"|"spicy"]}]

Rules:
- Only include dietary_tags / flavor tags you are confident about; use [] otherwise.
- "category": best guess at the menu section.
- "flavor": 1–2 dominant tags from the allowed set. Keep it terse.`;

type Enrichment = {
  id?: unknown;
  dietary_tags?: unknown;
  protein_type?: unknown;
  cuisine_type?: unknown;
  spice_level?: unknown;
  category?: unknown;
  flavor?: unknown;
};

/** Returns an id→enrichment map. On ANY failure returns an empty map (untagged). */
async function normalizeItems(
  slim: SlimItem[],
  onProgress?: OnProgress
): Promise<Map<string, Enrichment>> {
  try {
    onProgress?.({ id: 'tag', icon: '🏷️', label: 'Tagging dietary info', status: 'active' });
    const payload = slim.map((s) => ({ id: s.id, name: s.name }));
    let lastCount = 0;
    const { text: raw, stopReason } = await callMessagesStream({
      system: NORMALIZE_SYSTEM,
      model: VISION_MODEL,
      label: 'vision.tag',
      // ~70 output tokens per compact item: 6000 covers an 80-item menu. (The
      // old 3500 cap silently truncated ~50+ item menus, dropping ALL tags.)
      maxTokens: 6000,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      onText: (text) => {
        const count = (text.match(/"id"/g) ?? []).length;
        if (count !== lastCount) {
          lastCount = count;
          onProgress?.({
            id: 'tag',
            icon: '🏷️',
            label: 'Tagging dietary info',
            detail: `${Math.min(count, slim.length)} of ${slim.length} dishes`,
            status: 'active',
          });
        }
      },
    });

    let cleaned = raw.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const start = cleaned.search(/[[{]/);
    if (start > 0) cleaned = cleaned.slice(start).trim();
    // Truncated or non-terminated → salvage the complete items instead of
    // throwing away the whole enrichment pass.
    if (stopReason === 'max_tokens' || (!cleaned.endsWith(']') && !cleaned.endsWith('}'))) {
      const salvaged = salvageArray(cleaned);
      if (!salvaged) return new Map();
      cleaned = salvaged;
    }

    const arrParsed = JSON.parse(cleaned);
    if (!Array.isArray(arrParsed)) return new Map();

    const map = new Map<string, Enrichment>();
    for (const e of arrParsed as Enrichment[]) {
      if (e && e.id != null) map.set(String(e.id), e);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Trim a truncated JSON array of flat objects back to its last complete
 * object and close it, e.g. `[{...},{...},{"id":"x","na` → `[{...},{...}]`.
 * Enrichment objects contain no nested objects, so the last `}` is always an
 * item boundary. Returns null if nothing complete survived.
 */
function salvageArray(text: string): string | null {
  const start = text.indexOf('[');
  const lastClose = text.lastIndexOf('}');
  if (start === -1 || lastClose <= start) return null;
  return text.slice(start, lastClose + 1) + ']';
}

// ---------------------------------------------------------------------------
// Merge + parsing helpers
// ---------------------------------------------------------------------------

/** Combine a slim Layer-1 item with its Layer-2 enrichment into a MenuItem. */
function mergeItem(
  slim: SlimItem,
  enr: Enrichment | undefined,
  fallbackCuisine: string,
  index: number
): MenuItem {
  const proteinRaw = enr?.protein_type;
  const protein_type = Array.isArray(proteinRaw)
    ? arr(proteinRaw)
    : typeof proteinRaw === 'string' && proteinRaw !== '' && proteinRaw !== 'unknown'
      ? [proteinRaw]
      : [];

  return {
    id: slim.id != null ? String(slim.id) : `item-${index}`,
    name: typeof slim.name === 'string' ? slim.name : 'Unnamed dish',
    price: typeof slim.price === 'number' ? slim.price : 0,
    description: '',
    ingredients: [],
    flavor_profile: arr(enr?.flavor),
    texture: [],
    spice_level: typeof enr?.spice_level === 'number' ? enr.spice_level : 0,
    dietary_tags: arr(enr?.dietary_tags),
    protein_type,
    category: typeof enr?.category === 'string' ? enr.category : '',
    cuisine_type: typeof enr?.cuisine_type === 'string' ? enr.cuisine_type : fallbackCuisine,
  };
}

/**
 * Parse the Layer-1 response. Truncation is already caught upstream via the
 * API's stop_reason, so here we only need to recover the JSON — strip fences,
 * then fall back to the outermost {...} span — and throw PARSE_FAILED if the
 * text is genuinely unparseable.
 */
function parseStrict(raw: string): { items?: unknown; menu_context?: unknown } {
  let cleaned = raw.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();

  try {
    return JSON.parse(cleaned) as { items?: unknown; menu_context?: unknown };
  } catch {
    // Lenient recovery: grab the outermost balanced object/array.
    const start = cleaned.search(/[{[]/);
    const open = cleaned[start];
    const close = open === '[' ? ']' : '}';
    const end = cleaned.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as { items?: unknown; menu_context?: unknown };
      } catch {
        /* fall through */
      }
    }
    throw new Error('PARSE_FAILED');
  }
}

/** Coerce the model's menu_context into a safe, well-typed shape. */
function normalizeMenuContext(raw: unknown): VisionMenuContext {
  const ctx = (raw ?? {}) as Partial<VisionMenuContext> & { orientation?: unknown };
  return {
    restaurant_name: typeof ctx.restaurant_name === 'string' ? ctx.restaurant_name.trim() : '',
    cuisine_type: ctx.cuisine_type ?? 'unknown',
    orientation: normalizeOrientation(ctx.orientation),
    restaurant_notes: arr((ctx as { restaurant_notes?: unknown }).restaurant_notes),
  };
}

/** Coerce the model's orientation into a safe MenuOrientation (all fields default empty). */
function normalizeOrientation(raw: unknown): MenuOrientation {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    summary: typeof o.summary === 'string' ? o.summary : '',
    known_for: arr(o.known_for),
    signature_item_ids: arr(o.signature_dish_ids ?? o.signature_item_ids),
  };
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
