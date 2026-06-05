/**
 * Quick offline test of the pure-TS funnel (no API).
 * Run: npx tsx scripts/test-funnel.ts
 */
import { analyzeMenu } from '../src/lib/analyzeMenu';
import { buildQuestionSet } from '../src/lib/buildQuestionSet';
import { DESI_MENU, SUSHI_MENU } from './mock-menus';

function report(name: string, items: Parameters<typeof analyzeMenu>[0]) {
  const ctx = analyzeMenu(items);
  console.log(`\n========== ${name} (${ctx.totalItems} items, ${ctx.cuisine_type}) ==========`);
  console.log('uniform_traits:', ctx.uniform_traits);
  console.log('sub_protein_split:', ctx.sub_protein_split);
  console.log('cooking_style_split:', ctx.cooking_style_split);
  console.log('high_signal_dimensions:');
  for (const d of ctx.high_signal_dimensions) {
    console.log(
      `  - ${d.dimension.padEnd(13)} power=${d.elimination_power.toFixed(2)} [${d.options_present.join(', ')}]`
    );
  }
  console.log('\nQUESTIONS:');
  for (const [i, q] of buildQuestionSet(ctx).entries()) {
    console.log(`  Q${i + 1} (${q.id}): ${q.text}`);
    console.log(`       ${q.options.map((o) => `${o.emoji ?? ''} ${o.label}`).join('  |  ')}`);
  }
}

report('SUSHI', SUSHI_MENU);
report('DESI', DESI_MENU);
