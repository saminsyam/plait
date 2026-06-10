/**
 * Restaurant menu lookup via Claude web search (no backend — runs client-side
 * like the rest of the app's Claude calls).
 *
 *   callLookup(restaurant, city)  → searches the web, returns a structured
 *                                   LookupResult (found / source / items / …).
 *   buildScanFromLookup(items)    → a text-only Haiku pass that enriches the
 *                                   looked-up items and writes the menu
 *                                   questions, producing the SAME
 *                                   { items: MenuItem[], menu_context } shape
 *                                   the photo flow produces — so the questions
 *                                   → ranking → results pipeline is reused
 *                                   unchanged.
 *
 * Uses the basic web_search tool (web_search_20250305) — no beta header, no
 * code-execution dependency. Web search must be enabled on the Anthropic org.
 */
import { ANTHROPIC_API_KEY, callMessagesStream, MissingKeyError, parseJson, VISION_MODEL } from './anthropic';
import type { OnProgress } from './progress';
import { recordUsage } from './usage';
import type { MenuItem, MenuOrientation, VisionMenuContext } from './types';

const EMPTY_ORIENTATION: MenuOrientation = {
  summary: '',
  known_for: [],
  signature_item_ids: [],
};

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LookupItem = {
  name: string;
  description: string;
  price: string | null; // e.g. "$25" or null
  category?: string;
  meal_period?: string;
  modifiers?: string[];
};

export type LookupResult = {
  found: boolean;
  source: 'restaurant_website' | 'aggregator' | 'pdf' | 'partial' | null;
  source_url: string | null;
  source_name: string | null;
  freshness_warning: boolean;
  freshness_warning_reason: string | null;
  needs_location_confirm: boolean;
  locations_found: string[];
  meal_periods_found: string[];
  items: LookupItem[];
};

const NOT_FOUND: LookupResult = {
  found: false,
  source: null,
  source_url: null,
  source_name: null,
  freshness_warning: false,
  freshness_warning_reason: null,
  needs_location_confirm: false,
  locations_found: [],
  meal_periods_found: [],
  items: [],
};

// ---------------------------------------------------------------------------
// Layer 1 — web search lookup
// ---------------------------------------------------------------------------

const LOOKUP_SYSTEM_PROMPT = `You are a menu extraction agent for plAIt, a dietary recommendation app.
Your job: find and extract the full menu for a restaurant, given its name and optionally a city, using the web_search tool.

STEP 1 — FIND THE MENU
Search with a query like "[restaurant] [city] menu". Prefer, in order:
1. The restaurant's own website (most current)
2. Aggregators (singleplatform.com, zmenu.com, menupix.com)
3. Yelp / TripAdvisor menu pages
Read the search results carefully and extract as many real dishes (with prices when shown) as you can. Search again with an aggregator-targeted query if the first results are thin.

STEP 2 — HANDLE EDGE CASES
- Multiple locations for the same name → set needs_location_confirm: true and list them in locations_found (as short "City, Address" strings). Do NOT guess.
- Multiple meal periods (breakfast/lunch/dinner) → note them in meal_periods_found and tag each item's meal_period.
- No menu after ~2 searches → set found: false with an empty items array.

STEP 3 — OUTPUT
For SPEED, extract ONLY the dish name, price, and meal_period per item — do NOT include descriptions, categories, ingredients, or modifiers.
Output RAW JSON ONLY — no markdown fences, no preamble, NO comments (never use // or /* */), no trailing commas.
Return ONLY a JSON object with EXACTLY this shape:
{
  "found": true,
  "source": "restaurant_website" | "aggregator" | "pdf" | "partial",
  "source_url": "https://...",
  "source_name": "e.g. Berkeley Social Club official site",
  "freshness_warning": false,
  "freshness_warning_reason": null,
  "needs_location_confirm": false,
  "locations_found": [],
  "meal_periods_found": ["breakfast","lunch","dinner"],
  "items": [
    { "name": "Salmon Benedict", "price": "$25", "meal_period": "breakfast" }
  ]
}

FRESHNESS WARNING RULES
Set freshness_warning: true (and explain in freshness_warning_reason) when the source is an aggregator, the page looks more than a year old, or prices conflict across sources. Set it false only for the restaurant's own live website.

FAILURE: if found is false, return the object with found:false and all other fields null/empty/false and items: [].`;

type ContentBlock = { type: string; text?: string };
type MessagesResponse = {
  content?: ContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
};

/** Search the web for a restaurant menu and return structured results. */
export async function callLookup(
  restaurant: string,
  city: string,
  onProgress?: OnProgress
): Promise<LookupResult> {
  if (!ANTHROPIC_API_KEY) throw new MissingKeyError();

  onProgress?.({
    id: 'search',
    icon: '🔎',
    label: 'Searching the web',
    detail: `“${restaurant}${city ? `, ${city}` : ''}”`,
    status: 'active',
  });
  const userText = `Find the menu for: ${restaurant}${city ? `, ${city}` : ''}`;
  // The server runs the search loop; it can return pause_turn if it needs more
  // iterations. Re-send the accumulated turn to resume, capped to avoid loops.
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: userText },
  ];

  const t0 = Date.now();
  let usageIn = 0;
  let usageOut = 0;
  let searches = 0;
  let final: MessagesResponse | null = null;

  for (let i = 0; i < 4; i++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        // Haiku does the web read + extraction accurately and ~2x faster /
        // cheaper than Sonnet here (verified on extraction + multi-location).
        model: VISION_MODEL,
        max_tokens: 8000,
        system: LOOKUP_SYSTEM_PROMPT,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Lookup failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as MessagesResponse;
    usageIn += json.usage?.input_tokens ?? 0;
    usageOut += json.usage?.output_tokens ?? 0;
    searches += json.usage?.server_tool_use?.web_search_requests ?? 0;

    if (json.stop_reason === 'pause_turn' && json.content) {
      messages.push({ role: 'assistant', content: json.content });
      onProgress?.({
        id: 'search',
        icon: '🔎',
        label: 'Searching the web',
        detail: `digging deeper · ${searches} ${searches === 1 ? 'search' : 'searches'} so far`,
        status: 'active',
      });
      continue; // resume the server-side search loop
    }
    final = json;
    break;
  }

  const result = final ? parseLookupJson(final) : NOT_FOUND;
  console.log(
    `[Lookup] ${Date.now() - t0}ms in=${usageIn} out=${usageOut} ` +
      `web_searches=${searches} found=${result.found} items=${result.items.length}`
  );
  recordUsage({
    label: 'lookup.search',
    model: VISION_MODEL,
    inputTokens: usageIn,
    outputTokens: usageOut,
    webSearches: searches,
  });
  onProgress?.({
    id: 'search',
    icon: '🔎',
    label: result.found ? 'Menu found' : 'Search finished',
    detail: result.found
      ? `${result.items.length} dishes · ${searches} web ${searches === 1 ? 'search' : 'searches'}`
      : 'no menu online',
    status: 'done',
  });
  return result;
}

/** Concatenate text blocks, isolate the JSON object, and normalize it. */
function parseLookupJson(resp: MessagesResponse): LookupResult {
  const text = (resp.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return NOT_FOUND;

  // Models sometimes sneak in JS-style line comments (e.g. "// ── BREAKFAST ──")
  // or trailing commas, which break JSON.parse. Strip them defensively. The
  // comment strip only matches lines that are whitespace-then-//, so it never
  // touches "https://…" inside a quoted string value.
  const cleaned = text
    .slice(start, end + 1)
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return NOT_FOUND;
  }

  const items: LookupItem[] = Array.isArray(raw.items)
    ? (raw.items as Record<string, unknown>[])
        .filter((it) => it && typeof it.name === 'string' && (it.name as string).trim() !== '')
        .map((it) => ({
          name: String(it.name),
          description: typeof it.description === 'string' ? it.description : '',
          price: typeof it.price === 'string' ? it.price : null,
          category: typeof it.category === 'string' ? it.category : undefined,
          meal_period: typeof it.meal_period === 'string' ? it.meal_period.toLowerCase() : undefined,
          modifiers: Array.isArray(it.modifiers)
            ? (it.modifiers as unknown[]).filter((m): m is string => typeof m === 'string')
            : undefined,
        }))
    : [];

  const found = raw.found === true && items.length > 0;

  return {
    found,
    source: (raw.source as LookupResult['source']) ?? null,
    source_url: typeof raw.source_url === 'string' ? raw.source_url : null,
    source_name: typeof raw.source_name === 'string' ? raw.source_name : null,
    freshness_warning: raw.freshness_warning === true,
    freshness_warning_reason:
      typeof raw.freshness_warning_reason === 'string' ? raw.freshness_warning_reason : null,
    needs_location_confirm: raw.needs_location_confirm === true,
    locations_found: normalizeLocations(raw.locations_found),
    meal_periods_found: Array.isArray(raw.meal_periods_found)
      ? (raw.meal_periods_found as unknown[])
          .filter((m): m is string => typeof m === 'string')
          .map((m) => m.toLowerCase())
      : [],
    items,
  };
}

function normalizeLocations(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((loc) => {
      if (typeof loc === 'string') return loc;
      if (loc && typeof loc === 'object') {
        const o = loc as Record<string, unknown>;
        return [o.name, o.address, o.city]
          .filter((x): x is string => typeof x === 'string')
          .join(' — ');
      }
      return '';
    })
    .filter((s) => s.trim() !== '');
}

// ---------------------------------------------------------------------------
// Layer 2 — enrich looked-up items into the photo-flow shape
// ---------------------------------------------------------------------------

const ENRICH_SYSTEM = `You are a food analyst for a dietary app. You are given a restaurant menu as a JSON
list of items (dish names). Infer properties from each name. Return ONLY a compact JSON object (no markdown, no preamble):
{
  "items": [ { "id": <same id>, "dietary_tags": ["halal"|"vegetarian"|"vegan"|"gluten-free"], "protein_type": "beef|chicken|fish|seafood|lamb|pork|vegetarian|vegan|mixed|unknown", "spice_level": 0-5, "category": "starter|main|side|dessert|drink", "flavor": ["rich"|"savory"|"smoky"|"fresh"|"tangy"|"sweet"|"spicy"] } ],
  "menu_context": { "cuisine_type": string, "restaurant_notes": string[] }
}
Only assert dietary_tags / flavor tags you are confident about. Keep it terse.`;

const parsePrice = (price: string | null): number => {
  if (!price) return 0;
  const n = parseFloat(price.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

type EnrichResult = { items: MenuItem[]; menu_context: VisionMenuContext };

/**
 * Turn looked-up items into the { items: MenuItem[], menu_context } shape the
 * rest of the app consumes. Enrichment failure falls back to untagged items
 * with no menu questions (the funnel still works).
 */
export async function buildScanFromLookup(
  lookupItems: LookupItem[],
  onProgress?: OnProgress
): Promise<EnrichResult> {
  const t0 = Date.now();
  const payload = lookupItems.map((it, i) => ({ id: String(i + 1), name: it.name }));

  let enrichment = new Map<string, Record<string, unknown>>();
  let menuContext: VisionMenuContext = {
    cuisine_type: 'unknown',
    orientation: EMPTY_ORIENTATION,
    restaurant_notes: [],
  };

  onProgress?.({ id: 'tag', icon: '🏷️', label: 'Tagging dietary info', status: 'active' });
  try {
    let lastCount = 0;
    const { text: raw, stopReason } = await callMessagesStream({
      system: ENRICH_SYSTEM,
      model: VISION_MODEL,
      label: 'lookup.tag',
      maxTokens: 4000,
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      onText: (text) => {
        const count = (text.match(/"id"/g) ?? []).length;
        if (count !== lastCount) {
          lastCount = count;
          onProgress?.({
            id: 'tag',
            icon: '🏷️',
            label: 'Tagging dietary info',
            detail: `${Math.min(count, lookupItems.length)} of ${lookupItems.length} dishes`,
            status: 'active',
          });
        }
      },
    });
    if (stopReason === 'max_tokens') throw new Error('TRUNCATED');
    const parsed = parseJson<{ items?: unknown; menu_context?: unknown }>(raw);

    if (Array.isArray(parsed.items)) {
      for (const e of parsed.items as Record<string, unknown>[]) {
        if (e && e.id != null) enrichment.set(String(e.id), e);
      }
    }
    const ctx = (parsed.menu_context ?? {}) as Partial<VisionMenuContext>;
    menuContext = {
      cuisine_type: typeof ctx.cuisine_type === 'string' ? ctx.cuisine_type : 'unknown',
      orientation: EMPTY_ORIENTATION,
      restaurant_notes: arr((ctx as { restaurant_notes?: unknown }).restaurant_notes),
    };
  } catch {
    // Fall back to untagged items + no questions.
  }

  const items: MenuItem[] = lookupItems.map((it, i) => {
    const e = enrichment.get(String(i + 1));
    const proteinRaw = e?.protein_type;
    const protein_type =
      typeof proteinRaw === 'string' && proteinRaw !== '' && proteinRaw !== 'unknown'
        ? [proteinRaw]
        : [];
    return {
      id: `item-${i}`,
      name: it.name,
      price: parsePrice(it.price),
      description: it.description,
      ingredients: [],
      flavor_profile: arr(e?.flavor),
      texture: [],
      spice_level: typeof e?.spice_level === 'number' ? (e.spice_level as number) : 0,
      dietary_tags: arr(e?.dietary_tags),
      protein_type,
      category: typeof e?.category === 'string' ? (e.category as string) : '',
      cuisine_type: menuContext.cuisine_type,
    };
  });

  console.log(`[LookupEnrich] ${Date.now() - t0}ms items=${items.length}`);
  onProgress?.({
    id: 'tag',
    icon: '🏷️',
    label: 'Dietary info tagged',
    detail:
      enrichment.size > 0
        ? `${enrichment.size} of ${lookupItems.length} dishes`
        : 'skipped — dishes stay untagged',
    status: 'done',
  });
  return { items, menu_context: menuContext };
}
