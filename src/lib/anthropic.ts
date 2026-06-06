/**
 * Thin Anthropic Messages API client over fetch (works in React Native /
 * Expo Go — no SDK needed). Single-user demo: the key is read from the
 * Expo-public env var and sent straight from the device.
 */

// NOTE: Expo only inlines env vars prefixed with EXPO_PUBLIC_ into the app
// bundle, and only when accessed via dot notation. A bare ANTHROPIC_API_KEY
// would be `undefined` at runtime in Expo Go. We read the prefixed name and
// fall back to the bare one only so a misconfigured key fails loudly below.
export const ANTHROPIC_API_KEY =
  process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;

// Reasoning / ranking — quality matters most here, so we use Sonnet.
export const MODEL = 'claude-sonnet-4-6';
// Menu OCR + structuring — Haiku is much faster and plenty accurate for this.
export const VISION_MODEL = 'claude-haiku-4-5';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export class MissingKeyError extends Error {
  constructor() {
    super(
      'Missing Anthropic API key. Set EXPO_PUBLIC_ANTHROPIC_API_KEY in your .env ' +
        '(the EXPO_PUBLIC_ prefix is required for Expo to expose it), then restart Expo.'
    );
    this.name = 'MissingKeyError';
  }
}

export type TextBlock = { type: 'text'; text: string };
export type ImageBlock = {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
};
export type ContentBlock = TextBlock | ImageBlock;

type MessagesRequest = {
  system: string;
  content: ContentBlock[];
  maxTokens: number;
  /** Override the model for this call (defaults to MODEL / Sonnet). */
  model?: string;
};

/** Call the Messages API once and return the concatenated text output. */
export async function callMessages({ system, content, maxTokens, model = MODEL }: MessagesRequest): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new MissingKeyError();

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // Lets the request work from a browser/web origin too.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (json.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim();

  // Diagnostics — visible in the Metro console for every call.
  console.log(
    `[API] ${model} stop=${json.stop_reason} ` +
      `in=${json.usage?.input_tokens} out=${json.usage?.output_tokens} text_len=${text.length}`
  );

  // The API's own signal that it ran out of room — definitive truncation.
  if (json.stop_reason === 'max_tokens') {
    throw new Error('TRUNCATED');
  }
  if (!text) throw new Error('Anthropic API returned an empty response.');
  return text;
}

/**
 * Parse JSON from a model response, tolerating stray markdown fences or
 * preamble by extracting the first balanced array/object.
 */
export function parseJson<T>(raw: string): T {
  let text = raw.trim();

  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    // Fall back to the first [...] or {...} span.
    const start = text.search(/[[{]/);
    const open = text[start];
    const close = open === '[' ? ']' : '}';
    const end = text.lastIndexOf(close);
    if (start !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1)) as T;
    }
    throw new Error(`Could not parse JSON from model response: ${raw.slice(0, 300)}`);
  }
}
