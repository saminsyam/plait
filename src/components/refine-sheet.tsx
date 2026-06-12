/**
 * Refine sheet — the narrowing flow folded into a bottom sheet on the picks
 * page (Sushi 2.1: everything stays on one screen). The deterministic engine
 * drives it entirely on-device: a short series of questions, each built for
 * maximum information gain against the REMAINING candidates, zero tokens per
 * question. When the pool is small enough the sheet hands the final pool +
 * recorded choices back to the picks screen for ONE re-rank call.
 *
 * The profile's heat ceiling already pre-trimmed `pool`; it's recorded as a
 * choice so the spice answer stays in the ranking context like it always was.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Eyebrow } from '@/components/ui-kit';
import { Plait } from '@/constants/plait-theme';
import {
  facetChoice,
  filterByFacet,
  nextQuestion,
  shouldStopNarrowing,
  spiceChoice,
  type EngineChoice,
  type EngineOption,
  type EngineQuestion,
  type SpiceLevel,
} from '@/engine/questionEngine';
import type { MenuItem } from '@/engine/types';

export function RefineSheet({
  visible,
  initialPool,
  spiceCeiling,
  onDone,
  onClose,
}: {
  visible: boolean;
  /** The spice-trimmed candidate pool the narrowing starts from. */
  initialPool: MenuItem[];
  spiceCeiling: SpiceLevel;
  /** Called with the narrowed pool + recorded choices — parent re-ranks. */
  onDone: (pool: MenuItem[], choices: EngineChoice[]) => void;
  onClose: () => void;
}) {
  const [pool, setPool] = useState<MenuItem[]>(initialPool);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<EngineChoice[]>([]);
  const [dynamicCount, setDynamicCount] = useState(0);

  // Fresh narrowing state every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setPool(initialPool);
    setAsked(new Set());
    setChoices([spiceChoice(spiceCeiling)]);
    setDynamicCount(0);
  }, [visible, initialPool, spiceCeiling]);

  const question = nextQuestion(pool, asked);

  // Safety net: opened with nothing left to ask → just hand the pool back.
  // (The picks screen hides the refine link in this case.)
  useEffect(() => {
    if (visible && pool.length > 0 && question === null) onDone(pool, choices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, question]);

  const onAnswer = (q: EngineQuestion, option: EngineOption) => {
    const np = filterByFacet(pool, q.facetId, option.value);
    const nextAsked = new Set(asked).add(q.facetId);
    const nextChoices = [...choices, facetChoice(q, option)];
    const nextDynamic = dynamicCount + 1;
    setPool(np);
    setAsked(nextAsked);
    setChoices(nextChoices);
    setDynamicCount(nextDynamic);
    if (shouldStopNarrowing(np, nextDynamic) || nextQuestion(np, nextAsked) === null) {
      onDone(np, nextChoices);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Eyebrow>refine these picks</Eyebrow>
            <Text style={styles.count}>
              {pool.length} {pool.length === 1 ? 'dish' : 'dishes'} in the running
            </Text>
          </View>
          {question && (
            <>
              <Text style={styles.question}>{question.question}</Text>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.options}>
                {question.options.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => onAnswer(question, opt)}
                    style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}>
                    <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.optionCount}>{opt.count}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(27,30,27,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Plait.color.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Plait.space.md,
    paddingTop: 10,
    paddingBottom: Plait.space.lg,
    maxHeight: '75%',
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Plait.color.line,
    alignSelf: 'center',
    marginBottom: 16,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  count: { fontFamily: Plait.font.mono, fontSize: 11, color: Plait.color.inkSoft },
  question: {
    fontFamily: Plait.font.display,
    fontSize: 22,
    lineHeight: 27,
    color: Plait.color.ink,
    marginBottom: Plait.space.sm,
  },
  options: { gap: 8, paddingBottom: Plait.space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Plait.space.sm,
    backgroundColor: Plait.color.card,
    borderRadius: Plait.radius.md,
    borderWidth: 1,
    borderColor: Plait.color.line,
    paddingVertical: 14,
    paddingHorizontal: Plait.space.md,
  },
  optionEmoji: { fontSize: 20 },
  optionLabel: { fontFamily: Plait.font.bodySemiBold, fontSize: 15.5, color: Plait.color.ink },
  optionCount: {
    fontFamily: Plait.font.mono,
    fontSize: 12,
    color: Plait.color.inkSoft,
    backgroundColor: Plait.color.paper,
    borderRadius: Plait.radius.pill,
    minWidth: 26,
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
});
