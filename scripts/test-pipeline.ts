/**
 * End-to-end pipeline test against a real menu photo (hits the Anthropic API).
 *
 *   npx tsx scripts/test-pipeline.ts [path-to-menu.jpg]
 *
 * Defaults to ./test-menu.jpg. Reads the key from EXPO_PUBLIC_ANTHROPIC_API_KEY
 * (or ANTHROPIC_API_KEY) in your .env. This is the quickest way to sanity-check
 * the core loop before touching the UI.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env into process.env before importing modules that read the key.
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env — rely on the ambient environment */
  }
  // Mirror a bare key onto the Expo-public name the app code expects.
  if (!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) {
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
}

async function main() {
  loadEnv();

  const imgPath = resolve(process.cwd(), process.argv[2] ?? 'test-menu.jpg');
  let base64: string;
  try {
    base64 = readFileSync(imgPath).toString('base64');
  } catch {
    console.error(`Could not read image at ${imgPath}.`);
    console.error('Pass a path: npx tsx scripts/test-pipeline.ts ./my-menu.jpg');
    process.exit(1);
  }

  // Dynamic imports so loadEnv() runs first.
  const { callVision } = await import('../src/engine/callVision');
  const { callReason } = await import('../src/engine/callReason');
  const { applyHardGate } = await import('../src/engine/dietaryFilter');
  const { parsePreferences } = await import('../src/engine/parsePreferences');
  const engine = await import('../src/engine/questionEngine');

  // Canonical benchmark profile: free-text preferences are smart-parsed into
  // hard constraints (halal → deterministic gate), while the full text also
  // flows to the model as soft ranking context (high-protein). Edit here to
  // exercise other scenarios (e.g. "allergic to shellfish").
  const userPreferences = 'halal, high-protein, building muscle, loves bold flavors';
  const hardConstraints = await parsePreferences(userPreferences);
  console.log(`Profile → "${userPreferences}"  →  constraints=${JSON.stringify(hardConstraints)}`);

  console.log('1/4  Reading menu with Claude Vision...');
  const { items, menu_context } = await callVision(base64);
  console.log(`     -> ${items.length} items: ${items.map((i) => i.name).join(', ')}`);
  console.log(`     -> cuisine=${menu_context.cuisine_type} | ${menu_context.orientation.summary}`);

  console.log('2/4  Applying deterministic hard-gate (on-device, no model)...');
  const gate = applyHardGate(items, hardConstraints);
  console.log(`     -> allowed=${gate.allowed.length}  verify=${gate.verify.length}  blocked=${gate.blocked.length}`);
  for (const v of gate.verify) console.log(`     VERIFY  ${v.item.name} — ${v.reasons.join('; ')}`);
  for (const b of gate.blocked) console.log(`     BLOCK   ${b.item.name} — ${b.reasons.join('; ')}`);

  const rankable = [...gate.allowed, ...gate.verify.map((v) => v.item)];
  const verifyById = Object.fromEntries(gate.verify.map((v) => [v.item.id, v.reasons]));
  if (rankable.length === 0) {
    console.log('\nNo items survived the hard-gate — nothing safe to rank.');
    return;
  }

  console.log('3/4  Narrowing with the deterministic engine (no model, mock answers)...');
  // Mock the user: medium spice, then always take the top option of each question.
  const choices = [engine.spiceChoice(2)];
  let pool = engine.filterBySpice(rankable, 2);
  const asked = new Set<string>();
  let dynamic = 0;
  while (!engine.shouldStopNarrowing(pool, dynamic)) {
    const q = engine.nextQuestion(pool, asked);
    if (!q) break;
    const opt = q.options[0];
    console.log(`     Q "${q.question}" -> ${opt.label} (${opt.count})`);
    pool = engine.filterByFacet(pool, q.facetId, opt.value);
    choices.push(engine.facetChoice(q, opt));
    asked.add(q.facetId);
    dynamic++;
  }
  const { questions, answers } = engine.choicesToQA(choices);
  const narrowedVerify = Object.fromEntries(
    Object.entries(verifyById).filter(([id]) => pool.some((i) => i.id === id))
  );

  console.log(`4/4  Reasoning over ${pool.length} narrowed candidates...`);
  const picks = await callReason({ items: pool, questions, answers, userPreferences, verifyById: narrowedVerify });
  console.log('\n===== TOP PICKS =====');
  for (const p of picks) {
    const item = pool.find((i) => i.id === p.item_id);
    const flag = p.flag ? `  [${p.flag}]` : '';
    console.log(`#${p.rank}  ${item?.name ?? p.item_id}  (${p.match_score}/100)${flag}`);
    console.log(`     ${p.why}`);
  }
}

main().catch((err) => {
  console.error('\nPipeline failed:', err.message);
  process.exit(1);
});
