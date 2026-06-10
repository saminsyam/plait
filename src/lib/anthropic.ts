/**
 * Thin Anthropic Messages API client over fetch (works in React Native /
 * Expo Go — no SDK needed). Single-user demo: the key is read from the
 * Expo-public env var and sent straight from the device.
 *
 * Two entry points:
 *   callMessages       — buffered: resolves once with the full text.
 *   callMessagesStream — SSE: emits the accumulated text on every delta via
 *                        `onText`, so callers can surface live progress (item
 *                        counts, pick numbers) while the model is still writing.
 *
 * Both paths report token usage to the ledger in ./usage (callLookup reports
 * its own search loop there too), so getUsage() sees every call the app makes.
 */
import { recordUsage } from './usage';

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
  /** Short purpose tag for the usage ledger, e.g. "vision.read". */
  label?: string;
};

/** Call the Messages API once and return the concatenated text output. */
export async function callMessages({ system, content, maxTokens, model = MODEL, label }: MessagesRequest): Promise<string> {
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
    content?: { type: string; text?: string }[];
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
  recordUsage({
    label,
    model,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
  });

  // The API's own signal that it ran out of room — definitive truncation.
  if (json.stop_reason === 'max_tokens') {
    throw new Error('TRUNCATED');
  }
  if (!text) throw new Error('Anthropic API returned an empty response.');
  return text;
}

type StreamRequest = MessagesRequest & {
  /** Called with the FULL accumulated text after every delta (not just the chunk). */
  onText?: (textSoFar: string) => void;
};

export type StreamResult = {
  text: string;
  /** stop_reason from the final message_delta — 'max_tokens' means truncated. */
  stopReason: string | null;
};

/** Shape of the SSE events we care about (everything else is skipped). */
type StreamEvent = {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  /** message_start carries the input token count. */
  message?: { usage?: { input_tokens?: number } };
  /** message_delta carries the cumulative output token count. */
  usage?: { output_tokens?: number };
  error?: { message?: string };
};

/** The slice of fetch both expo/fetch and the standard fetch satisfy. */
type StreamingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

let streamingFetch: StreamingFetch | null = null;

/**
 * Resolve a streaming-capable fetch lazily. On native we need expo/fetch
 * (RN's built-in fetch can't stream response bodies), but that module only
 * loads under Metro — in Node (scripts/test-pipeline.ts) and on the web the
 * global fetch already streams, so fall back to it there.
 */
function getStreamingFetch(): StreamingFetch {
  if (streamingFetch) return streamingFetch;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    streamingFetch = (require('expo/fetch') as { fetch: StreamingFetch }).fetch;
  } catch {
    streamingFetch = globalThis.fetch as unknown as StreamingFetch;
  }
  return streamingFetch;
}

/**
 * Streaming variant of callMessages. Returns the final text plus the
 * stop_reason so callers decide how to treat truncation — the Layer-1 read
 * treats max_tokens as fatal, while the normalize layers salvage the partial
 * JSON instead. Degrades to the buffered call when the runtime can't stream.
 */
export async function callMessagesStream({
  system,
  content,
  maxTokens,
  model = MODEL,
  label,
  onText,
}: StreamRequest): Promise<StreamResult> {
  if (!ANTHROPIC_API_KEY) throw new MissingKeyError();

  const res = await getStreamingFetch()(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      stream: true,
      messages: [{ role: 'user', content }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`);
  }

  if (!res.body || typeof TextDecoder === 'undefined') {
    // Runtime can't stream — fall back to one buffered call (no live updates;
    // callMessages records the usage, so don't record again here).
    const text = await callMessages({ system, content, maxTokens, model, label });
    onText?.(text);
    return { text, stopReason: null };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are newline-delimited; keep any trailing partial line buffered.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let event: StreamEvent;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        continue; // keep-alives / partial frames
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text ?? '';
        onText?.(text);
      } else if (event.type === 'message_start') {
        inputTokens = event.message?.usage?.input_tokens ?? 0;
      } else if (event.type === 'message_delta') {
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        // Cumulative — the last message_delta carries the final count.
        if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
      } else if (event.type === 'error') {
        throw new Error(`Anthropic stream error: ${event.error?.message ?? 'unknown'}`);
      }
    }
  }

  console.log(`[API] ${model} (stream) stop=${stopReason} text_len=${text.length}`);
  recordUsage({ label, model, inputTokens, outputTokens });
  if (!text.trim()) throw new Error('Anthropic API returned an empty response.');
  return { text: text.trim(), stopReason };
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
