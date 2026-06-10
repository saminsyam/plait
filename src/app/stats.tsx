/**
 * Session stats — the screen behind the ⚡ line on results. Two halves:
 *
 *   1. The current scan (from the per-scan session): dishes read, how the
 *      dietary gate split them, and the final picks.
 *   2. The API ledger (src/lib/usage.ts): every model call this app session,
 *      grouped by purpose, with token counts and real dollar cost.
 *
 * The ledger is app-session-wide (it survives "Scan another menu"), so a
 * reset button lets you zero the counter to measure a single scan.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NavLink, PrimaryButton, Subtitle, Title } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import { formatUsd, getUsage, resetUsage, type UsageEntry } from '@/lib/usage';
import { useSession } from '@/state/session';

/** Friendly names for the ledger's call labels. */
const LABEL_INFO: Record<string, { icon: string; name: string }> = {
  'vision.read': { icon: '📖', name: 'Menu photo read' },
  'vision.tag': { icon: '🏷️', name: 'Dietary tagging' },
  'lookup.search': { icon: '🔎', name: 'Web menu search' },
  'lookup.tag': { icon: '🏷️', name: 'Dietary tagging' },
  'reason.rank': { icon: '👨‍🍳', name: 'Pick ranking' },
  'dish.detail': { icon: '🍽️', name: 'Dish details' },
  'prefs.parse': { icon: '🔒', name: 'Preference parsing' },
};

type Group = { icon: string; name: string; calls: number; tokens: number; costUsd: number };

function groupEntries(entries: readonly UsageEntry[]): Group[] {
  const byName = new Map<string, Group>();
  for (const e of entries) {
    const info = LABEL_INFO[e.label] ?? { icon: '⚙️', name: e.label };
    const g = byName.get(info.name) ?? { ...info, calls: 0, tokens: 0, costUsd: 0 };
    g.calls += 1;
    g.tokens += e.inputTokens + e.outputTokens;
    g.costUsd += e.costUsd;
    byName.set(info.name, g);
  }
  return [...byName.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const { items, candidates, blocked, picks, menuContext } = useSession();
  // Bump to re-render after the ledger is reset.
  const [, setTick] = useState(0);

  const { entries, totals } = getUsage();
  const groups = groupEntries(entries);
  const hasScan = items.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <NavLink label="‹ Back" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Title style={styles.title}>Session stats</Title>

        {/* ── This scan ─────────────────────────────────────────────────── */}
        {hasScan && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              THIS SCAN{menuContext?.cuisine_type && menuContext.cuisine_type !== 'unknown'
                ? ` · ${menuContext.cuisine_type.toUpperCase()}`
                : ''}
            </Text>
            <View style={styles.tileRow}>
              <StatTile value={String(items.length)} label="dishes read" />
              <StatTile value={String(candidates.length)} label="passed your gate" />
              <StatTile value={String(blocked.length)} label="ruled out" />
              <StatTile value={String(picks.length)} label="picks" />
            </View>
          </View>
        )}

        {/* ── API usage ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>API USAGE · THIS APP SESSION</Text>
          {totals.calls === 0 ? (
            <Subtitle>No API calls yet — scan a menu and come back.</Subtitle>
          ) : (
            <>
              <View style={styles.tileRow}>
                <StatTile value={formatUsd(totals.costUsd)} label="total cost" />
                <StatTile value={String(totals.calls)} label="calls" />
                <StatTile
                  value={`${((totals.inputTokens + totals.outputTokens) / 1000).toFixed(1)}k`}
                  label="tokens"
                />
                {totals.webSearches > 0 && (
                  <StatTile value={String(totals.webSearches)} label="web searches" />
                )}
              </View>

              <View style={styles.ledger}>
                {groups.map((g) => (
                  <View key={g.name} style={styles.ledgerRow}>
                    <Text style={styles.ledgerIcon}>{g.icon}</Text>
                    <View style={styles.ledgerText}>
                      <Text style={styles.ledgerName}>{g.name}</Text>
                      <Text style={styles.ledgerMeta}>
                        {g.calls} {g.calls === 1 ? 'call' : 'calls'} · {(g.tokens / 1000).toFixed(1)}k tokens
                      </Text>
                    </View>
                    <Text style={styles.ledgerCost}>{formatUsd(g.costUsd)}</Text>
                  </View>
                ))}
              </View>

              <PrimaryButton
                label="Reset counter"
                variant="ghost"
                onPress={() => {
                  resetUsage();
                  setTick((t) => t + 1);
                }}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Plait.color.background },
  header: { paddingHorizontal: Plait.space.lg, paddingTop: Plait.space.sm },
  scroll: {
    paddingHorizontal: Plait.space.lg,
    paddingTop: Plait.space.sm,
    paddingBottom: Plait.space.xl,
    gap: Plait.space.lg,
  },
  title: { fontSize: 36 },
  section: { gap: Plait.space.sm },
  sectionLabel: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: Plait.font.sans,
  },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Plait.space.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '22%',
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingVertical: 14,
    paddingHorizontal: Plait.space.sm,
    alignItems: 'center',
    gap: 2,
  },
  tileValue: {
    color: Plait.color.text,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Plait.font.sans,
  },
  tileLabel: {
    color: Plait.color.textDim,
    fontSize: 11,
    fontFamily: Plait.font.sans,
    textAlign: 'center',
  },
  ledger: {
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.border,
    paddingHorizontal: Plait.space.md,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Plait.color.border,
  },
  ledgerIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  ledgerText: { flex: 1, gap: 1 },
  ledgerName: {
    color: Plait.color.text,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
  },
  ledgerMeta: { color: Plait.color.textDim, fontSize: 12, fontFamily: Plait.font.sans },
  ledgerCost: {
    color: Plait.color.teal,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Plait.font.sans,
  },
});
