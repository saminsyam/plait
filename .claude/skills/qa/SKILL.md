---
name: qa
description: Run a QA engineer's pass over the plAIt codebase — execute the full verification loop (tsc, eslint, unit tests, live pipeline eval), review changed code for edge cases and pipeline-specific risks, and produce a structured QA report with a ship/no-ship verdict. Use this whenever the user asks for QA, a quality check, code review, regression check, "is this safe to ship/commit", "test my changes", "find bugs", or after finishing any meaningful feature work — even if they don't say the word "QA".
---

# QA analysis for plAIt

Act as this repo's QA engineer. plAIt is an Expo SDK 54 React Native app (TypeScript, Expo Router) that photographs or looks up restaurant menus, hard-filters them against dietary constraints on-device, and ranks dishes with client-side Anthropic calls. Your job: verify, probe, and report — not to fix (offer fixes only after the report, or when the user asked for them).

Report everything you find, including low-confidence or low-severity findings, with a confidence label — coverage beats self-filtering; the user decides what to ignore.

## 1. Verification loop — run all of it, in this order

| Check | Command | Notes |
|---|---|---|
| Types | `npx tsc --noEmit` | Must be silent. |
| Lint | `npm run lint` | eslint-config-expo. |
| Unit tests | `npm test` | Dietary gate, question engine, TDEE math (`src/lib/*.test.ts`). |
| Pipeline eval | `npm run eval` | Live API eval (`scripts/eval.ts`): gate determinism + prefs→enrich→gate→rank assertions + cost guard. Costs ~$0.02/run; needs `EXPO_PUBLIC_ANTHROPIC_API_KEY` in `.env`. Ask before running it repeatedly in a loop. |
| Vision stage (optional) | `npm run eval -- ./menu.jpg` | Only when a menu photo is available. |

`npm run test:watch` exists for iterating on unit tests. If a check can't run (no key, no network), say so in the report — don't silently skip.

## 2. Review the diff

Scope to what changed: `git status` + `git diff` (or `git diff main...` on a branch). Read each changed file fully before judging it. For each change ask: what user-visible flow exercises this, what happens on the unhappy path (API error, truncation, empty menu, denied permission), and which existing test would catch a regression here — if none, flag the gap.

## 3. plAIt-specific risk checklist

These are the failure modes this codebase has actually hit or guards against. Check any that the diff touches:

- **Safety invariant (highest stakes):** dishes blocked by `applyHardGate` (`src/lib/dietaryFilter.ts`) must never reach `callReason` or appear as picks. The gate is the only safety layer — the model never enforces safety. Any change to gate logic, candidate-pool construction (`camera.tsx`, `lookup.tsx`), or `MenuItem` tags needs a gate unit test.
- **Node vs Metro imports:** everything under `src/lib/` must stay importable in plain Node — `scripts/eval.ts` and `scripts/test-pipeline.ts` depend on it. No top-level `import` of `expo/*` in lib code; `expo/fetch` is lazy-required in `anthropic.ts` with a `globalThis.fetch` fallback. A top-level expo import passes tsc but crashes the scripts.
- **Truncation handling:** streaming callers must check `stopReason === 'max_tokens'`. The normalize layers salvage partial JSON arrays (`salvageArray`) instead of dropping all tags; Layer-1 read treats truncation as fatal (`TRUNCATED` → user-facing retake message). New model calls need an explicit truncation decision.
- **Model-output parsing:** never trust raw model text — go through `parseJson` / `parseStrict` (fence-stripping, balanced-span fallback). String-matching serialized JSON is a bug.
- **Token ceilings:** normalize cap (6000) covers ~80 items at ~70 tokens/item. If a prompt change makes per-item output longer, re-derive the cap — a silent truncation here used to wipe all dietary tags.
- **Usage ledger:** every new Anthropic call must record into `src/lib/usage.ts` — automatic via `callMessages`/`callMessagesStream` (pass a `label`), manual (`recordUsage`) for bespoke fetch loops like `callLookup`.
- **Loading UX:** wait states must report real `ProgressEvent`s (`src/lib/progress.ts`) through `useProgressSteps` into `CookingLoader` — no fake timers or scripted steps. The loader navigates on the `done` prop; forgetting to set it strands the user.
- **Persisted state:** anything read from AsyncStorage (`src/state/profile.tsx`) must tolerate absence and malformed JSON (see `parseHardConstraints`) — old installs carry old shapes.
- **React Compiler is on** (`experiments.reactCompiler`): hooks must follow the rules strictly; no conditional hooks, no mutation of captured values.

## 4. Edge cases to probe by flow

- **Camera:** permission denied (library-upload path must still work), huge/blurry photo (TRUNCATED / PARSE_FAILED messages), zero items read.
- **Lookup:** restaurant not found, multi-location confirm, multi-meal-period filter leaving 0 items, web search rounds exhausted (4-iteration cap).
- **Questions:** zero candidates (must skip straight to results, avoid-list only), pool collapsing to 1 mid-narrowing, reason call failing (retry UI).
- **Results:** picks with null macros, verify-flagged picks (halal cert suppression), blocked-only results, dish-detail call failure (inline retry).

## 5. Report format

Always end with exactly this structure:

```
# QA Report — <scope>

## Verdict: SHIP | SHIP WITH NOTES | DO NOT SHIP

## Verification
| Check | Result |
(tsc / lint / unit tests / eval — pass counts, cost of eval run)

## Findings
P0 <blocks ship — safety invariant or crash> — file:line — evidence — confidence
P1 <wrong behavior users will hit>
P2 <edge case / robustness gap>
P3 <nit / cleanup>

## Untested edge cases
(what could break that no test covers)

## Suggested test additions
(concrete: which file, what assertion)
```

Verdict rule: any P0 → DO NOT SHIP; P1s → SHIP WITH NOTES; only P2/P3 → SHIP.
