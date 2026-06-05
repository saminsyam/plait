/**
 * Call 1 — Vision. Read a menu photo and extract structured menu items.
 */
import { callMessages, parseJson } from './anthropic';
import type { MenuItem } from './types';

const SYSTEM = `You are a menu parser. Extract every menu item into structured JSON.
Output ONLY valid JSON. No preamble, no markdown fences.

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

Return an array of items. Validate it's parseable JSON before responding.`;

const USER_TEXT =
  'Here is a photo of a restaurant menu. Extract every menu item as described. ' +
  'Infer flavor_profile, texture, spice_level, dietary_tags and protein_type from the ' +
  'item name and description when not explicitly stated. Use a short unique id per item. ' +
  'Return only the JSON array.';

/** Send a base64 JPEG of the menu and return parsed, normalized menu items. */
export async function callVision(
  imageBase64: string,
  mediaType: string = 'image/jpeg'
): Promise<MenuItem[]> {
  const raw = await callMessages({
    system: SYSTEM,
    maxTokens: 8000,
    content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
      { type: 'text', text: USER_TEXT },
    ],
  });

  const items = parseJson<MenuItem[]>(raw);
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Vision returned no menu items. Try a clearer, well-lit photo.');
  }

  return items.map(normalizeItem);
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

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
