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
  const { callVision } = await import('../src/lib/callVision');
  const { callReason } = await import('../src/lib/callReason');
  const { buildQuestions } = await import('../src/lib/questions');

  console.log('1/3  Reading menu with Claude Vision...');
  const { items, menu_context } = await callVision(base64);
  console.log(`     -> ${items.length} items: ${items.map((i) => i.name).join(', ')}`);
  console.log(`     -> cuisine=${menu_context.cuisine_type}, dimensions=${menu_context.dimensions.map((d) => d.id).join(', ')}`);

  console.log('2/3  Building questions (hunger + Vision dimensions)...');
  const questions = buildQuestions(menu_context);
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const choice = q.options[0]; // mock answer: pick the first option
    answers[q.id] = choice.value;
    console.log(`     Q (${q.id}) "${q.question_text}" -> ${choice.label}`);
  }

  console.log('3/3  Reasoning for top 3 picks...');
  const picks = await callReason({ items, questions, answers });
  console.log('\n===== TOP PICKS =====');
  for (const p of picks) {
    const item = items.find((i) => i.id === p.item_id);
    const flag = p.flag ? `  [${p.flag}]` : '';
    console.log(`#${p.rank}  ${item?.name ?? p.item_id}  (${p.match_score}/100)${flag}`);
    console.log(`     ${p.why}`);
  }
}

main().catch((err) => {
  console.error('\nPipeline failed:', err.message);
  process.exit(1);
});
