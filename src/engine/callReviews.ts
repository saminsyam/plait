/**
 * "Before you go" review fetch — built for minimum tokens.
 *
 * One Haiku call with the web_search tool capped at max_uses: 1, reading
 * result snippets only (no page-fetch tool is offered). The model extracts
 * 3–5 dishes reviewers actually praise into a terse JSON shape:
 *
 *   { restaurant_blurb, crowd_favorites: [{ name, blurb }] }   or found:false
 *
 * Honesty invariant: the prompt forbids falling back to training knowledge
 * about the restaurant — a dry search returns found:false, and the UI says so
 * or hides the tile. We never invent reviews.
 *
 * Results are cached in AsyncStorage keyed by the normalized restaurant name
 * with a 14-day TTL, so the scan flow can surface crowd favorites for free.
 * AsyncStorage is lazy-required (with an in-memory fallback) so this module —
 * like the rest of src/engine — stays importable in plain Node for the eval and
 * test scripts.
 *
 * Like callLookup, the web-search loop bypasses callMessages (it needs the
 * tools param and pause_turn handling), so it records into the usage ledger
 * manually under the label 'reviews.fetch'.
 */
import { ANTHROPIC_API_KEY, MissingKeyError, parseJson, VISION_MODEL } from './anthropic';
import type { OnProgress } from './progress';
import { recordUsage } from './usage';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrowdFavorite = {
  name: string;
  /** One short line on why reviewers like it, grounded in search snippets. */
  blurb: string;
};

export type ReviewsResult = {
  /** False when the single web search came up dry — show that, don't invent. */
  found: boolean;
  /** One-line description of the place, from review snippets. */
  restaurant_blurb: string;
  crowd_favorites: CrowdFavorite[];
  /**
   * Best menu-page URL seen verbatim in the search results (restaurant's own
   * site preferred), or null. Piggybacks on the same single search so the
   * "get the menu online" step can fetch it directly instead of re-searching.
   */
  menu_url: string | null;
};

const NOT_FOUND: ReviewsResult = {
  found: false,
  restaurant_blurb: '',
  crowd_favorites: [],
  menu_url: null,
};

// ---------------------------------------------------------------------------
// Cache — AsyncStorage, normalized-name key, 14-day TTL
// ---------------------------------------------------------------------------

export const REVIEWS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'reviews_cache:';

/** Stored shape: when it was fetched + the (found) result. */
type CacheRecord = { at: number; result: ReviewsResult };

/**
 * Collapse a restaurant name to a stable cache key: lowercase, accents
 * stripped, punctuation dropped, whitespace collapsed — so "Bùi's Café!" and
 * "buis cafe" hit the same entry.
 */
export function normalizeRestaurantName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cacheKeyFor(restaurant: string): string {
  return CACHE_PREFIX + normalizeRestaurantName(restaurant);
}

/**
 * Parse one cached record. Returns null when the raw value is absent,
 * malformed, not a found-result, or outside the TTL window (a future
 * timestamp counts as expired — a skewed clock should refetch, not pin a
 * stale entry forever). Pure, so the TTL policy is unit-testable.
 */
export function parseCachedReviews(
  raw: string | null | undefined,
  now: number = Date.now()
): ReviewsResult | null {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as Partial<CacheRecord>;
    if (typeof rec.at !== 'number') return null;
    const age = now - rec.at;
    if (age < 0 || age > REVIEWS_TTL_MS) return null;
    const result = normalizeReviews(rec.result);
    return result.found ? result : null;
  } catch {
    return null;
  }
}

/** Coerce a model/cache payload into a safe ReviewsResult. */
export function normalizeReviews(raw: unknown): ReviewsResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.found !== true) return { ...NOT_FOUND };
  const favorites: CrowdFavorite[] = (Array.isArray(o.crowd_favorites) ? o.crowd_favorites : [])
    .filter(
      (f): f is { name: string; blurb?: unknown } =>
        !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string' &&
        ((f as { name: string }).name.trim() !== '')
    )
    .slice(0, 5)
    .map((f) => ({
      name: f.name.trim(),
      blurb: typeof f.blurb === 'string' ? f.blurb.trim() : '',
    }));
  if (favorites.length === 0) return { ...NOT_FOUND };
  const menuUrl = typeof o.menu_url === 'string' ? o.menu_url.trim() : '';
  return {
    found: true,
    restaurant_blurb: typeof o.restaurant_blurb === 'string' ? o.restaurant_blurb.trim() : '',
    crowd_favorites: favorites,
    menu_url: /^https?:\/\/\S+$/.test(menuUrl) ? menuUrl : null,
  };
}

/** The two AsyncStorage methods this module uses. */
type KVStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

let storage: KVStorage | null = null;

/**
 * Resolve AsyncStorage lazily so this module stays importable in plain Node
 * (scripts/eval.ts, unit tests). The package's web build actually loads under
 * Node but rejects at CALL time ("window is not defined"), so the fallback to
 * a per-process in-memory map happens per-call: the first failed call switches
 * to memory for good. Under Metro (native/web) the real AsyncStorage is used.
 */
function getStorage(): KVStorage {
  if (storage) return storage;

  const mem = new Map<string, string>();
  const memStore: KVStorage = {
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => {
      mem.set(k, v);
    },
  };

  let native: KVStorage | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = (require('@react-native-async-storage/async-storage') as { default: KVStorage })
      .default;
  } catch {
    native = null;
  }
  if (!native) {
    storage = memStore;
    return storage;
  }

  const n = native;
  storage = {
    getItem: async (k) => {
      try {
        return await n.getItem(k);
      } catch {
        storage = memStore;
        return memStore.getItem(k);
      }
    },
    setItem: async (k, v) => {
      try {
        await n.setItem(k, v);
      } catch {
        storage = memStore;
        return memStore.setItem(k, v);
      }
    },
  };
  return storage;
}

/**
 * Cached reviews for a restaurant, or null when absent/expired. Free and
 * instant — the scan flow uses this to light up crowd favorites at no cost.
 */
export async function getCachedReviews(restaurant: string): Promise<ReviewsResult | null> {
  if (normalizeRestaurantName(restaurant) === '') return null;
  try {
    const raw = await getStorage().getItem(cacheKeyFor(restaurant));
    return parseCachedReviews(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The fetch — one Haiku web search, snippets only
// ---------------------------------------------------------------------------

const REVIEWS_SYSTEM = `You scan restaurant reviews for plAIt. You get EXACTLY ONE web search.
Search "[restaurant] [city] reviews" and read ONLY the result snippets.

RULES
- Ground EVERYTHING in the snippets. You have NO other knowledge of this
  restaurant: never add dishes, facts, or reputation from memory or guesswork.
- Extract 3-5 dishes reviewers praise. Skip a dish that gets only a single
  passing mention — but a dish even ONE snippet calls popular / a favorite /
  must-order / known-for counts as crowd-praised (that wording aggregates
  many reviews).
- Per dish: "name" + "blurb" (one short line on why people like it).
- "restaurant_blurb": one line on what the place is, from the snippets.
- "menu_url": the most menu-likely URL that appears VERBATIM in the results —
  best: the restaurant's own menu page or PDF menu; acceptable: the
  restaurant's own homepage; never order-online platforms (toasttab,
  doordash, ubereats, grubhub) or review sites. null when none appears.
  Never construct or guess a URL.
- Only output {"found":false} when the snippets are about the wrong place or
  name no dishes at all.

OUTPUT: raw COMPACT JSON only — no markdown, no preamble, no extra keys:
{"found":true,"restaurant_blurb":"...","crowd_favorites":[{"name":"...","blurb":"..."}],"menu_url":"https://..." or null}
or {"found":false}`;

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

/**
 * Crowd favorites for a restaurant: cache first (free), then one web search.
 * Emits real ProgressEvents under the id 'reviews'. Truncation policy: this
 * call is a nicety, never load-bearing — a truncated or unparseable response
 * degrades to found:false rather than throwing past the tile.
 */
export async function callReviews(
  restaurant: string,
  city: string,
  onProgress?: OnProgress
): Promise<ReviewsResult> {
  const cached = await getCachedReviews(restaurant);
  if (cached) {
    onProgress?.({
      id: 'reviews',
      icon: '🌟',
      label: 'Crowd favorites ready',
      detail: 'from a recent search (cached, free)',
      status: 'done',
    });
    return cached;
  }

  if (!ANTHROPIC_API_KEY) throw new MissingKeyError();
  onProgress?.({
    id: 'reviews',
    icon: '🌟',
    label: 'Scanning reviews',
    detail: `“${restaurant}${city ? `, ${city}` : ''}”`,
    status: 'active',
  });

  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: `Restaurant: ${restaurant}${city ? `, ${city}` : ''}` },
  ];

  const t0 = Date.now();
  let usageIn = 0;
  let usageOut = 0;
  let searches = 0;
  let final: MessagesResponse | null = null;

  // The single search still goes through the server-side tool loop, which can
  // pause_turn; resume a couple of times like callLookup, capped hard.
  for (let i = 0; i < 3; i++) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        // Terse output: a blurb + 5 short favorites is well under this.
        max_tokens: 800,
        system: REVIEWS_SYSTEM,
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Review search failed (${res.status}): ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as MessagesResponse;
    usageIn += json.usage?.input_tokens ?? 0;
    usageOut += json.usage?.output_tokens ?? 0;
    searches += json.usage?.server_tool_use?.web_search_requests ?? 0;

    if (json.stop_reason === 'pause_turn' && json.content) {
      messages.push({ role: 'assistant', content: json.content });
      continue;
    }
    final = json;
    break;
  }

  const result = final ? parseReviewsResponse(final) : { ...NOT_FOUND };
  console.log(
    `[Reviews] ${Date.now() - t0}ms in=${usageIn} out=${usageOut} ` +
      `web_searches=${searches} found=${result.found} favorites=${result.crowd_favorites.length}`
  );
  recordUsage({
    label: 'reviews.fetch',
    model: VISION_MODEL,
    inputTokens: usageIn,
    outputTokens: usageOut,
    webSearches: searches,
  });

  // Cache only found results — a dry search shouldn't be pinned for 14 days.
  if (result.found) {
    try {
      const record: CacheRecord = { at: Date.now(), result };
      await getStorage().setItem(cacheKeyFor(restaurant), JSON.stringify(record));
    } catch {
      // Cache write failure is never worth surfacing — next fetch just pays.
    }
  }

  onProgress?.({
    id: 'reviews',
    icon: '🌟',
    label: result.found ? 'Crowd favorites found' : 'Review search finished',
    detail: result.found
      ? `${result.crowd_favorites.length} ${result.crowd_favorites.length === 1 ? 'dish' : 'dishes'} reviewers praise`
      : 'no reviews found online',
    status: 'done',
  });
  return result;
}

/** Concatenate text blocks and coerce into a ReviewsResult (dry on failure). */
function parseReviewsResponse(resp: MessagesResponse): ReviewsResult {
  const text = (resp.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
  if (!text.trim()) return { ...NOT_FOUND };
  try {
    return normalizeReviews(parseJson<unknown>(text));
  } catch {
    return { ...NOT_FOUND };
  }
}
