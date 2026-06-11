/**
 * Token & cost ledger for every Anthropic call the app makes.
 *
 * The API client (anthropic.ts) reports usage from both the buffered and the
 * streaming paths, and callLookup reports its web-search loop, so this module
 * sees every dollar the app spends. Pure TS, no RN imports — works in the app
 * (Metro), the eval script, and unit tests (Node) alike.
 *
 * Costs are computed from cached pricing (docs, May 2026): update PRICING when
 * Anthropic's prices change.
 */

type ModelPricing = { inputPerMTok: number; outputPerMTok: number };

const PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5': { inputPerMTok: 1, outputPerMTok: 5 },
  'claude-sonnet-4-6': { inputPerMTok: 3, outputPerMTok: 15 },
};
// Unknown model id → price as Sonnet so costs are over- not under-estimated.
const DEFAULT_PRICING: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15 };

/** Server-side web_search tool: $10 per 1,000 searches, on top of tokens. */
const WEB_SEARCH_PER_CALL = 10 / 1000;

export type UsageEntry = {
  /** What the call was for, e.g. "vision.read", "lookup.search". */
  label: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
  at: number;
};

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  costUsd: number;
};

const entries: UsageEntry[] = [];

function pricingFor(model: string): ModelPricing {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return key ? PRICING[key] : DEFAULT_PRICING;
}

/** Record one API call's usage. Returns the entry (with computed cost). */
export function recordUsage(input: {
  label?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearches?: number;
  /** Prompt-cache tokens: writes cost 1.25× input, reads 0.1× input. */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}): UsageEntry {
  const p = pricingFor(input.model);
  const uncachedTokens = input.inputTokens ?? 0;
  const cacheWriteTokens = input.cacheWriteTokens ?? 0;
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  // Fold cache tokens into the input total so the stats screen stays honest
  // about volume; the cost split below prices each tier correctly.
  const inputTokens = uncachedTokens + cacheWriteTokens + cacheReadTokens;
  const outputTokens = input.outputTokens ?? 0;
  const webSearches = input.webSearches ?? 0;
  const costUsd =
    (uncachedTokens / 1_000_000) * p.inputPerMTok +
    (cacheWriteTokens / 1_000_000) * p.inputPerMTok * 1.25 +
    (cacheReadTokens / 1_000_000) * p.inputPerMTok * 0.1 +
    (outputTokens / 1_000_000) * p.outputPerMTok +
    webSearches * WEB_SEARCH_PER_CALL;

  const entry: UsageEntry = {
    label: input.label ?? input.model,
    model: input.model,
    inputTokens,
    outputTokens,
    webSearches,
    costUsd,
    at: Date.now(),
  };
  entries.push(entry);

  const totals = getUsage().totals;
  console.log(
    `[Usage] ${entry.label} in=${inputTokens} out=${outputTokens}` +
      (cacheReadTokens > 0 || cacheWriteTokens > 0
        ? ` (cache r=${cacheReadTokens} w=${cacheWriteTokens})`
        : '') +
      (webSearches > 0 ? ` searches=${webSearches}` : '') +
      ` cost=${formatUsd(costUsd)} | session: ${totals.calls} calls ${formatUsd(totals.costUsd)}`
  );
  return entry;
}

/** Snapshot of all recorded calls plus session totals. */
export function getUsage(): { entries: readonly UsageEntry[]; totals: UsageTotals } {
  const totals = entries.reduce<UsageTotals>(
    (acc, e) => ({
      calls: acc.calls + 1,
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      webSearches: acc.webSearches + e.webSearches,
      costUsd: acc.costUsd + e.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0 }
  );
  return { entries, totals };
}

export function resetUsage(): void {
  entries.length = 0;
}

/** "$0.0123" below a cent, "$0.12" above — readable at demo scale. */
export function formatUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
