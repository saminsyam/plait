/**
 * Two-layer menu pipeline (both on Haiku):
 *
 *   Layer 1 — Vision: read the photo into SLIM items (name / price / one-sentence
 *             description) plus menu_context (the menu-specific questions and any
 *             restaurant_notes). Reading is all this layer does — no tagging.
 *   Layer 2 — Normalize: a text-only call that infers dietary_tags / protein_type
 *             / cuisine_type / spice_level from the slim items. No image.
 *
 * Why split? The old single call asked for ~11 fields per dish, so a 60-item
 * menu emitted ~8k output tokens — and output generation is the latency
 * bottleneck. Slimming the read and moving enrichment to a separate terse call
 * roughly halves total tokens. Merging by id reproduces the existing MenuItem
 * shape, so nothing downstream changes.
 */
import { callMessages, VISION_MODEL } from './anthropic';
import type { MenuItem, VisionDimension, VisionMenuContext, VisionResult } from './types';

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

After the items, return a "menu_context" object.

In menu_context.dimensions, identify 2–4 dimensions that would meaningfully
split THIS menu when choosing a dish (e.g. fish type, cooking style, spice
level, protein, portion size). Only include a dimension if it applies to at
least 20% and at most 80% of items. Never include a dimension uniform across
the menu. For each, write a natural server-style question and list only the
options actually present on this menu, with an optional emoji per option.
Do NOT include hunger level — the app adds that as a fixed first question.

Also look for any footer or header text that applies to the entire menu —
halal/kosher certification statements, allergen notices, gluten-free policies,
gratuity notes — and extract them into "restaurant_notes" as short strings.
If none exist, return an empty array.

The menu_context shape is:
{
  "cuisine_type": string,
  "dimensions": [
    { "id": string, "question_text": string,
      "options": [{ "label": string, "value": string, "emoji": string | null }] }
  ],
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
 * model-written menu_context. Runs both pipeline layers.
 */
export async function callVision(
  imageBase64: string,
  mediaType: string = 'image/jpeg'
): Promise<VisionResult> {
  // ---- Layer 1: read the photo -------------------------------------------
  const t0 = Date.now();
  // Slim output (4 fields/item) keeps this well under the token ceiling even
  // for a 60-item menu, while leaving headroom against truncation.
  const raw = await callMessages({
    system: READ_SYSTEM,
    model: VISION_MODEL,
    // Generous ceiling so a very large menu never truncates. Output stays small
    // because items are slim with brief descriptions; the cap is just a guard.
    maxTokens: 8000,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: READ_USER },
    ],
  });

  const parsed = parseStrict(raw); // throws TRUNCATED / PARSE_FAILED
  const slim = Array.isArray(parsed.items) ? (parsed.items as SlimItem[]) : [];
  if (slim.length === 0) {
    throw new Error('Vision returned no menu items. Try a clearer, well-lit photo.');
  }
  const menu_context = normalizeMenuContext(parsed.menu_context);
  console.log(`[Vision] Layer 1 done in ${Date.now() - t0}ms (${slim.length} items)`);

  // ---- Layer 2: enrich from text (graceful fallback on failure) ----------
  const t1 = Date.now();
  const enrichment = await normalizeItems(slim);
  console.log(
    `[Normalize] Layer 2 done in ${Date.now() - t1}ms (${enrichment.size}/${slim.length} enriched)`
  );

  const items = slim.map((s, i) =>
    mergeItem(s, enrichment.get(String(s.id ?? i + 1)), menu_context.cuisine_type, i)
  );
  console.log(`[Total] Vision pipeline done in ${Date.now() - t0}ms`);

  return { items, menu_context };
}

// ---------------------------------------------------------------------------
// Layer 2 — enrich items (Normalize, text only)
// ---------------------------------------------------------------------------

const NORMALIZE_SYSTEM = `You are a food analyst. For each menu item, infer dietary
properties from its name. Be conservative.

Return ONLY a COMPACT JSON array (no markdown, no preamble, no extra whitespace),
one object per item, SAME order and SAME id as the input:
[{"id":<id>,"dietary_tags":["halal"|"vegetarian"|"vegan"|"gluten-free"],"protein_type":"beef|chicken|fish|seafood|lamb|pork|vegetarian|vegan|mixed|unknown","spice_level":0-5}]

Only include dietary_tags you are confident about; use [] otherwise. Keep it terse.`;

type Enrichment = {
  id?: unknown;
  dietary_tags?: unknown;
  protein_type?: unknown;
  cuisine_type?: unknown;
  spice_level?: unknown;
};

/** Returns an id→enrichment map. On ANY failure returns an empty map (untagged). */
async function normalizeItems(slim: SlimItem[]): Promise<Map<string, Enrichment>> {
  try {
    const payload = slim.map((s) => ({ id: s.id, name: s.name }));
    const raw = await callMessages({
      system: NORMALIZE_SYSTEM,
      model: VISION_MODEL,
      maxTokens: 3500,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    });

    let cleaned = raw.trim();
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const start = cleaned.search(/[[{]/);
    if (start > 0) cleaned = cleaned.slice(start).trim();
    // Truncated or non-terminated → fall back to untagged items, never crash.
    if (!cleaned.endsWith(']') && !cleaned.endsWith('}')) return new Map();

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
    flavor_profile: [],
    texture: [],
    spice_level: typeof enr?.spice_level === 'number' ? enr.spice_level : 0,
    dietary_tags: arr(enr?.dietary_tags),
    protein_type,
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
  const ctx = (raw ?? {}) as Partial<VisionMenuContext>;
  const dimensions: VisionDimension[] = Array.isArray(ctx.dimensions)
    ? ctx.dimensions
        .map((d, i) => normalizeDimension(d as Partial<VisionDimension>, i))
        .filter((d): d is VisionDimension => d !== null)
    : [];

  return {
    cuisine_type: ctx.cuisine_type ?? 'unknown',
    dimensions,
    restaurant_notes: arr((ctx as { restaurant_notes?: unknown }).restaurant_notes),
  };
}

function normalizeDimension(d: Partial<VisionDimension>, index: number): VisionDimension | null {
  const rawOptions: Array<{ label?: string; value?: string; emoji?: string | null }> =
    Array.isArray(d.options) ? d.options : [];
  const options = rawOptions
    .filter((o) => !!o)
    .map((o) => ({
      label: o.label ?? String(o.value ?? ''),
      value: o.value ?? o.label ?? '',
      emoji: o.emoji ?? null,
    }))
    .filter((o) => o.value !== '');

  if (options.length < 2) return null; // a dimension needs at least two choices

  return {
    id: d.id ?? `dim-${index}`,
    question_text: d.question_text ?? `Pick one`,
    options,
  };
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
