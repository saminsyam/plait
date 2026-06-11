/**
 * plAIt eval loop — verifies real pipeline behavior, not just types.
 *
 *   npm run eval                 # offline gate checks + live text-pipeline eval
 *   npm run eval -- ./menu.jpg   # additionally runs the live Vision (photo) stage
 *
 * Stages:
 *   1. OFFLINE  deterministic hard-gate on hand-tagged fixtures (free, no key)
 *   2. LIVE     parsePreferences → enrich (buildScanFromLookup) → gate → callReason
 *   3. LIVE     callVision on a menu photo (only when a path is given or
 *               ./test-menu.jpg exists)
 *
 * Prints PASS/FAIL per check plus the token/cost report from the usage ledger,
 * and exits non-zero on any failure — safe to wire into CI or run before a
 * model/prompt change.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env before importing modules that read the key (mirrors test-pipeline).
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
  if (!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) {
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }
}

type Check = { name: string; pass: boolean; info?: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, info?: string) {
  checks.push({ name, pass, info });
  console.log(`  ${pass ? '✅' : '❌'} ${name}${info ? `  (${info})` : ''}`);
}

async function main() {
  loadEnv();

  const { applyHardGate } = await import('../src/lib/dietaryFilter');
  const { getUsage, formatUsd } = await import('../src/lib/usage');
  type Constraints = import('../src/lib/dietaryFilter').HardConstraints;
  type Item = import('../src/lib/types').MenuItem;

  const CONSTRAINTS: Constraints = [
    { kind: 'religious', rule: 'halal' },
    { kind: 'allergen', allergen: 'shellfish', severity: 'severe' },
  ];

  // ── Stage 1: offline gate on hand-tagged fixtures (deterministic) ─────────
  console.log('\n── Stage 1: hard-gate (offline, deterministic) ──');
  const mk = (name: string, extra: Partial<Item> = {}): Item => ({
    id: name,
    name,
    price: 12,
    description: '',
    ingredients: [],
    flavor_profile: [],
    texture: [],
    spice_level: 0,
    dietary_tags: [],
    protein_type: [],
    category: 'main',
    cuisine_type: 'test',
    ...extra,
  });

  const gate = applyHardGate(
    [
      mk('Crispy Pork Belly Bao', { protein_type: ['pork'] }),
      mk('Garlic Butter Shrimp', { protein_type: ['shellfish'] }),
      mk('Beer-Battered Cod'), // alcohol keyword → halal conflict
      mk('Pan-Seared Salmon', { protein_type: ['fish'] }), // fish: halal-clear, shellfish-clear
      mk('Grilled Chicken Shawarma', { protein_type: ['chicken'] }), // halal unknown → verify
      mk('Tofu Pad Thai', { dietary_tags: ['vegan'], protein_type: ['vegan'] }),
    ],
    CONSTRAINTS
  );
  const names = (xs: { item: Item }[]) => xs.map((x) => x.item.name);
  check('pork dish blocked', names(gate.blocked).includes('Crispy Pork Belly Bao'));
  check('shrimp dish blocked for shellfish allergy', names(gate.blocked).includes('Garlic Butter Shrimp'));
  check('beer-battered dish blocked for halal', names(gate.blocked).includes('Beer-Battered Cod'));
  check('salmon allowed (fish is halal + shellfish-clear)', gate.allowed.some((i) => i.name === 'Pan-Seared Salmon'));
  check('chicken goes to verify (slaughter unknown)', names(gate.verify).includes('Grilled Chicken Shawarma'));
  check('vegan dish allowed', gate.allowed.some((i) => i.name === 'Tofu Pad Thai'));

  // ── Stage 2: live text pipeline ───────────────────────────────────────────
  if (!process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY) {
    console.log('\n⚠️  No API key — skipping live stages. Offline results only.');
  } else {
    console.log('\n── Stage 2: live pipeline (prefs → enrich → gate → rank) ──');
    const { parsePreferences } = await import('../src/lib/parsePreferences');
    const { buildScanFromLookup } = await import('../src/lib/callLookup');
    const { callReason } = await import('../src/lib/callReason');

    // 2a. Smart-parse free-text preferences into hard constraints.
    const parsed = await parsePreferences('halal, allergic to shellfish, high-protein');
    check(
      'parsePreferences finds halal rule',
      parsed.some((c) => c.kind === 'religious' && c.rule === 'halal')
    );
    check(
      'parsePreferences finds severe shellfish allergen',
      parsed.some((c) => c.kind === 'allergen' && /shell|shrimp|crustacean/.test(c.allergen) && c.severity === 'severe'),
      JSON.stringify(parsed)
    );

    // 2b. Enrich a fixture menu (same path the lookup flow uses).
    const FIXTURE = [
      'Crispy Pork Belly Bao', 'Garlic Butter Shrimp', 'Grilled Chicken Shawarma Plate',
      'Beef Bulgogi Bowl', 'Pan-Seared Salmon', 'Roasted Cauliflower Tacos',
      'Margherita Pizza', 'Lamb Rogan Josh', 'Tofu Pad Thai', 'Chocolate Lava Cake',
      'Mango Lassi', 'Beer-Battered Fish & Chips',
    ].map((name) => ({ name, description: '', price: '$14' }));

    const scan = await buildScanFromLookup(FIXTURE);
    check('enrich keeps every fixture item', scan.items.length === FIXTURE.length, `${scan.items.length}/${FIXTURE.length}`);
    const taggedCount = scan.items.filter((i) => i.protein_type.length > 0 || i.category !== '').length;
    check('enrich tags most items', taggedCount >= FIXTURE.length * 0.5, `${taggedCount} tagged`);

    // 2c. Gate the enriched menu — keyword-driven blocks hold regardless of tags.
    const liveGate = applyHardGate(scan.items, parsed.length > 0 ? parsed : CONSTRAINTS);
    const blockedNames = liveGate.blocked.map((b) => b.item.name);
    check('pork bao blocked on live-enriched menu', blockedNames.includes('Crispy Pork Belly Bao'));
    check('shrimp blocked on live-enriched menu', blockedNames.includes('Garlic Butter Shrimp'));
    check('beer-battered dish blocked', blockedNames.includes('Beer-Battered Fish & Chips'));
    const candidates = [...liveGate.allowed, ...liveGate.verify.map((v) => v.item)];
    check('a rankable candidate pool survives', candidates.length >= 4, `${candidates.length} candidates`);

    // 2d. Rank with Sonnet exactly like the app's INSTANT path: empty Q/A,
    // profile spice ceiling pre-trimming the pool, TDEE targets in play.
    const { filterBySpice, DEFAULT_SPICE } = await import('../src/lib/questionEngine');
    const instantPool = filterBySpice(candidates, DEFAULT_SPICE);
    check('spice pre-trim keeps a rankable pool', instantPool.length >= 1, `${instantPool.length} of ${candidates.length}`);
    const picks = await callReason({
      items: instantPool,
      questions: [],
      answers: {},
      userPreferences: 'halal, allergic to shellfish, high-protein',
      verifyById: Object.fromEntries(liveGate.verify.map((v) => [v.item.id, v.reasons])),
      tdeeContext: { calories: 2400, protein_g: 160, carbs_g: 250, fat_g: 70 },
      restaurantNotes: [],
    });
    const candidateIds = new Set(instantPool.map((i) => i.id));
    check('reason returns 1–3 picks', picks.length >= 1 && picks.length <= 3, `${picks.length} picks`);
    check('every pick is from the spice-trimmed instant pool', picks.every((p) => candidateIds.has(p.item_id)));
    check('ranks are ascending + unique', picks.every((p, i) => p.rank === i + 1));
    check('every pick has a specific why', picks.every((p) => p.why.trim().length > 10));
    const blockedIds = new Set(liveGate.blocked.map((b) => b.item.id));
    check('no blocked dish leaked into picks', picks.every((p) => !blockedIds.has(p.item_id)));

    // ── Stage 3: live Vision (optional, needs a photo) ──────────────────────
    const imgArg = process.argv[2];
    const imgPath = imgArg ? resolve(process.cwd(), imgArg) : resolve(process.cwd(), 'test-menu.jpg');
    if (existsSync(imgPath)) {
      console.log('\n── Stage 3: live Vision read ──');
      const { callVision } = await import('../src/lib/callVision');
      const base64 = readFileSync(imgPath).toString('base64');
      const vision = await callVision(base64);
      check('vision reads at least 5 dishes', vision.items.length >= 5, `${vision.items.length} items`);
      check('vision names a cuisine', vision.menu_context.cuisine_type.trim() !== '');
      check('every dish has a name', vision.items.every((i) => i.name.trim() !== ''));
      check(
        'menu_context carries restaurant_name as a string',
        typeof vision.menu_context.restaurant_name === 'string'
      );
      // The repo's bundled test-menu.jpg is the Burma Light menu (45 dishes,
      // halal note in the footer) — assert against its ground truth.
      if (!imgArg) {
        check('reads ≥35 of the 45 Burma Light dishes', vision.items.length >= 35, `${vision.items.length} items`);
        check(
          'reads the printed restaurant name (keys the review cache)',
          /burma/i.test(vision.menu_context.restaurant_name),
          JSON.stringify(vision.menu_context.restaurant_name)
        );
        check(
          'captures the halal footer as a restaurant note',
          vision.menu_context.restaurant_notes.some((n) => /halal/i.test(n)),
          JSON.stringify(vision.menu_context.restaurant_notes)
        );
      }
    } else {
      console.log(`\n(skipping Vision stage — no menu photo at ${imgPath})`);
    }

    // Cost guard: a full eval run should stay comfortably cheap.
    const { totals } = getUsage();
    check('eval run cost under $0.25', totals.costUsd < 0.25, formatUsd(totals.costUsd));
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const failed = checks.filter((c) => !c.pass);
  const { totals } = getUsage();
  console.log('\n══ Eval report ══');
  console.log(`checks: ${checks.length - failed.length}/${checks.length} passed`);
  console.log(
    `usage:  ${totals.calls} API calls · ${totals.inputTokens} in / ${totals.outputTokens} out tokens` +
      (totals.webSearches ? ` · ${totals.webSearches} web searches` : '') +
      ` · ${formatUsd(totals.costUsd)}`
  );
  if (failed.length > 0) {
    console.log('\nFailed:');
    for (const f of failed) console.log(`  ❌ ${f.name}${f.info ? `  (${f.info})` : ''}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Eval crashed:', e);
  process.exit(1);
});
