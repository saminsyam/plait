/**
 * Call 1 — Vision. Read a menu photo and extract structured menu items plus a
 * model-written menu_context (the dimensions that meaningfully split THIS menu).
 */
import { callMessages, parseJson, VISION_MODEL } from './anthropic';
import type { MenuItem, VisionDimension, VisionMenuContext, VisionResult } from './types';

const SYSTEM = `You are a menu parser. Extract every menu item into structured JSON.

Schema per item:
{
  "id": string,
  "name": string,
  "price": number,
  "description": string,
  "ingredients": string[],
  "flavor_profile": string[],   // umami, sweet, tangy, smoky, savory, rich
  "texture": string[],          // crispy, soft, creamy, fresh, chewy
  "spice_level": number,        // 0–5
  "dietary_tags": string[],     // halal, vegan, vegetarian, gluten-free
  "protein_type": string[],     // beef, chicken, seafood, pork, lamb, vegetarian
  "cuisine_type": string
}

After extracting items, also return a "menu_context" object.

In menu_context.dimensions, identify 2–4 dimensions that would
meaningfully split THIS menu when choosing a dish (e.g. fish type,
cooking style, spice level, protein, portion size). Only include a
dimension if it applies to at least 20% and at most 80% of items.
Never include a dimension that's uniform across the menu.

For each dimension, write a natural server-style question and list
only the options actually present on this menu, with an optional
emoji per option.

Do NOT include hunger level — the app adds that as a fixed first question.

The menu_context shape is:
{
  "cuisine_type": string,
  "dimensions": [
    { "id": string, "question_text": string,
      "options": [{ "label": string, "value": string, "emoji": string | null }] }
  ]
}

Output ONLY valid JSON: { "items": [...], "menu_context": {...} }.
No markdown fences. No preamble. Validate it's parseable JSON before responding.`;

const USER_TEXT =
  'Here is a photo of a restaurant menu. Extract every menu item as described. ' +
  'Infer flavor_profile, texture, spice_level, dietary_tags and protein_type from the ' +
  'item name and description when not explicitly stated. Use a short unique id per item. ' +
  'Return only the JSON object { "items": [...], "menu_context": {...} }.';

/**
 * Send a base64 JPEG of the menu and return the normalized items plus the
 * model-written menu_context.
 */
export async function callVision(
  imageBase64: string,
  mediaType: string = 'image/jpeg'
): Promise<VisionResult> {
  const raw = await callMessages({
    system: SYSTEM,
    model: VISION_MODEL,
    maxTokens: 8000,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: USER_TEXT },
    ],
  });

  const parsed = parseJson<{ items?: unknown; menu_context?: unknown }>(raw);

  const rawItems = Array.isArray(parsed.items) ? (parsed.items as Partial<MenuItem>[]) : [];
  if (rawItems.length === 0) {
    throw new Error('Vision returned no menu items. Try a clearer, well-lit photo.');
  }

  const items = rawItems.map(normalizeItem);
  const menu_context = normalizeMenuContext(parsed.menu_context, items);

  return { items, menu_context };
}

/** Defensively fill in any missing fields so the funnel never crashes. */
function normalizeItem(item: Partial<MenuItem>, index: number): MenuItem {
  return {
    id: item.id ?? `item-${index}`,
    name: item.name ?? 'Unnamed dish',
    price: typeof item.price === 'number' ? item.price : 0,
    description: item.description ?? '',
    ingredients: arr(item.ingredients),
    flavor_profile: arr(item.flavor_profile),
    texture: arr(item.texture),
    spice_level: typeof item.spice_level === 'number' ? item.spice_level : 0,
    dietary_tags: arr(item.dietary_tags),
    protein_type: arr(item.protein_type),
    cuisine_type: item.cuisine_type ?? 'unknown',
  };
}

/** Coerce the model's menu_context into a safe, well-typed shape. */
function normalizeMenuContext(raw: unknown, items: MenuItem[]): VisionMenuContext {
  const ctx = (raw ?? {}) as Partial<VisionMenuContext>;
  const dimensions: VisionDimension[] = Array.isArray(ctx.dimensions)
    ? ctx.dimensions
        .map((d, i) => normalizeDimension(d as Partial<VisionDimension>, i))
        .filter((d): d is VisionDimension => d !== null)
    : [];

  return {
    cuisine_type: ctx.cuisine_type ?? items[0]?.cuisine_type ?? 'unknown',
    dimensions,
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
