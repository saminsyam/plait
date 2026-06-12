/**
 * Tap-to-explain prose (v2 spec §5): unfamiliar words in the "why" text render
 * as dotted-underline green links; tapping one opens a plain-language
 * explanation in a soft green box right below the paragraph. The explanation
 * is the product — no term ever requires leaving the sheet.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Plait } from '@/constants/plait-theme';

/** Split `text` around every occurrence of each term, preserving order. */
function splitOnTerms(text: string, keys: string[]): (string | { k: string })[] {
  let parts: (string | { k: string })[] = [text];
  for (const k of keys) {
    parts = parts.flatMap((p) =>
      typeof p !== 'string'
        ? [p]
        : p.split(k).flatMap((seg, i, arr) => (i < arr.length - 1 ? [seg, { k }] : [seg]))
    );
  }
  return parts;
}

export function ExplainText({ text, terms }: { text: string; terms: Record<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const keys = Object.keys(terms).filter((k) => text.includes(k));

  if (keys.length === 0) return <Text style={styles.body}>{text}</Text>;

  const parts = splitOnTerms(text, keys);
  return (
    <View>
      <Text style={styles.body}>
        {parts.map((p, i) =>
          typeof p === 'string' ? (
            p
          ) : (
            <Text
              key={i}
              onPress={() => setOpen(open === p.k ? null : p.k)}
              accessibilityRole="button"
              accessibilityLabel={`Explain ${p.k}`}
              style={styles.term}>
              {p.k}
            </Text>
          )
        )}
      </Text>
      {open && (
        <View style={styles.box}>
          <Text style={styles.boxText}>
            <Text style={styles.boxTerm}>{open}</Text> — {terms[open]}
          </Text>
        </View>
      )}
      <Text style={styles.hint}>
        Tap any <Text style={styles.hintTerm}>underlined</Text> word for a plain-language
        explanation.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    fontFamily: Plait.font.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: Plait.color.inkSoft,
  },
  term: {
    fontFamily: Plait.font.bodySemiBold,
    color: Plait.color.green,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: Plait.color.green,
  },
  box: {
    marginTop: 8,
    backgroundColor: Plait.color.greenSoft,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  boxText: { fontFamily: Plait.font.body, fontSize: 12.5, lineHeight: 18, color: Plait.color.ink },
  boxTerm: { fontFamily: Plait.font.bodySemiBold, color: Plait.color.green },
  hint: {
    fontFamily: Plait.font.body,
    fontSize: 11.5,
    color: Plait.color.inkFaint,
    marginTop: 8,
  },
  hintTerm: {
    fontFamily: Plait.font.bodySemiBold,
    color: Plait.color.green,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: Plait.color.green,
  },
});
