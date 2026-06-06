/**
 * A disposable, abandonable toy for the loading screen: food ingredients drift
 * lazily around an open canvas; tapping one pops it with a juicy squish, a
 * particle burst, and a light haptic, then it respawns at a new edge. No score,
 * no goal — just something pleasant to do during the wait.
 *
 * All motion uses the RN Animated native driver (transforms + opacity), so it
 * stays on the UI thread at 60fps. Everything is torn down on unmount, so it
 * leaks nothing when the screen navigates away mid-pop.
 */
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { Plait } from '@/constants/plait-theme';

type Ingredient = { emoji: string; color: string; label: string };

// Sushi-leaning set to match the demo menu.
const INGREDIENTS: Ingredient[] = [
  { emoji: '🍣', color: '#E8704A', label: 'salmon nigiri' },
  { emoji: '🥑', color: '#7FB069', label: 'avocado' },
  { emoji: '🍤', color: '#E8954A', label: 'shrimp tempura' },
  { emoji: '🌶️', color: '#E85A4A', label: 'chili' },
  { emoji: '🍋', color: '#E8C84A', label: 'lemon' },
  { emoji: '🍚', color: '#F5F0E8', label: 'rice' },
];

const BOX = 58; // touch target / layout box
const EMOJI = 42;

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A position somewhere along one of the four edges, within bounds. */
function edgePosition(w: number, h: number) {
  const maxX = Math.max(0, w - BOX);
  const maxY = Math.max(0, h - BOX);
  switch (Math.floor(rand(0, 4))) {
    case 0: return { x: rand(0, maxX), y: rand(0, maxY * 0.18) }; // top
    case 1: return { x: rand(0, maxX), y: rand(maxY * 0.82, maxY) }; // bottom
    case 2: return { x: rand(0, maxX * 0.18), y: rand(0, maxY) }; // left
    default: return { x: rand(maxX * 0.82, maxX), y: rand(0, maxY) }; // right
  }
}

type Particle = { angle: number; dist: number; size: number };

function makeParticles(): Particle[] {
  const n = Math.floor(rand(4, 7)); // 4–6
  return Array.from({ length: n }, (_, i) => ({
    angle: (Math.PI * 2 * i) / n + rand(-0.5, 0.5),
    dist: rand(34, 66),
    size: rand(5, 9),
  }));
}

function FloatingIngredient({
  ingredient,
  index,
  bounds,
  reduceMotion,
  onPop,
}: {
  ingredient: Ingredient;
  index: number;
  bounds: { w: number; h: number };
  reduceMotion: boolean;
  onPop: () => void;
}) {
  const { w, h } = bounds;

  const pos = useRef(
    new Animated.ValueXY(reduceMotion
      ? { x: rand(0, Math.max(0, w - BOX)), y: rand(0, Math.max(0, h - BOX)) }
      : edgePosition(w, h))
  ).current;
  const bob = useRef(new Animated.Value(0)).current;
  const rot = useRef(new Animated.Value(rand(-1, 1))).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const burst = useRef(new Animated.Value(0)).current;

  const [particles, setParticles] = useState<Particle[]>([]);
  const [popped, setPopped] = useState(false);

  const mounted = useRef(true);
  const roamAnim = useRef<Animated.CompositeAnimation | null>(null);
  const loops = useRef<Animated.CompositeAnimation[]>([]);
  const respawnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lazily roam between random waypoints; reschedules itself on completion.
  const roam = () => {
    if (!mounted.current || reduceMotion) return;
    const target = { x: rand(0, Math.max(0, w - BOX)), y: rand(0, Math.max(0, h - BOX)) };
    roamAnim.current = Animated.timing(pos, {
      toValue: target,
      duration: rand(5200, 9000),
      easing: Easing.inOut(Easing.sin),
      useNativeDriver: true,
    });
    roamAnim.current.start(({ finished }) => {
      if (finished) roam();
    });
  };

  const respawn = () => {
    if (!mounted.current) return;
    setParticles([]);
    burst.setValue(0);
    setPopped(false);
    pos.setValue(reduceMotion
      ? { x: rand(0, Math.max(0, w - BOX)), y: rand(0, Math.max(0, h - BOX)) }
      : edgePosition(w, h));
    opacity.setValue(1);
    if (reduceMotion) {
      scale.setValue(1);
      return;
    }
    // Pop back into existence with a little bounce, then resume drifting.
    scale.setValue(0);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
    roam();
  };

  const pop = () => {
    if (popped) return;
    // Haptic on touch-down — latency here kills the physical feel.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPop();
    setPopped(true);
    roamAnim.current?.stop();

    if (reduceMotion) {
      Animated.parallel([
        Animated.timing(scale, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      respawnTimer.current = setTimeout(respawn, 600);
      return;
    }

    // Burst particles outward + fade.
    setParticles(makeParticles());
    burst.setValue(0);
    Animated.timing(burst, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Juicy squish: overshoot up, then snap to zero.
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.28, friction: 3, tension: 220, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();

    respawnTimer.current = setTimeout(respawn, 850);
  };

  // Mount: entrance + continuous loops (skipped under reduced motion).
  useEffect(() => {
    mounted.current = true;
    if (!reduceMotion) {
      // Bounce in (staggered slightly per ingredient).
      const entrance = setTimeout(() => {
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
        roam();
      }, index * 120);

      const bobLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: rand(1400, 2200), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(bob, { toValue: 0, duration: rand(1400, 2200), easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );
      const rotLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(rot, { toValue: 1, duration: rand(2600, 3800), easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(rot, { toValue: -1, duration: rand(2600, 3800), easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      bobLoop.start();
      rotLoop.start();
      loops.current = [bobLoop, rotLoop];

      return () => {
        mounted.current = false;
        clearTimeout(entrance);
        if (respawnTimer.current) clearTimeout(respawnTimer.current);
        roamAnim.current?.stop();
        loops.current.forEach((l) => l.stop());
      };
    }

    return () => {
      mounted.current = false;
      if (respawnTimer.current) clearTimeout(respawnTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const translateY = Animated.add(pos.y, bob.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }));
  const rotate = rot.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <Animated.View
      style={[styles.box, { transform: [{ translateX: pos.x }, { translateY }, { rotate }] }]}>
      <Pressable
        onPressIn={pop}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`${ingredient.label}, tap to pop`}
        style={styles.fill}>
        <Animated.Text style={[styles.emoji, { transform: [{ scale }], opacity }]}>
          {ingredient.emoji}
        </Animated.Text>
      </Pressable>

      {particles.map((p, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.particle,
            {
              backgroundColor: ingredient.color,
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              left: BOX / 2 - p.size / 2,
              top: BOX / 2 - p.size / 2,
              opacity: burst.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.6, 0] }),
              transform: [
                { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(p.angle) * p.dist] }) },
                { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(p.angle) * p.dist] }) },
                { scale: burst.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) },
              ],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

export function IngredientToy({ reduceMotion }: { reduceMotion: boolean }) {
  const [bounds, setBounds] = useState<{ w: number; h: number } | null>(null);
  const [count, setCount] = useState(0);
  const bump = useRef(new Animated.Value(1)).current;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Only set once — we don't want to recreate ingredients on every layout.
    setBounds((b) => b ?? { w: width, h: height });
  };

  const handlePop = () => {
    setCount((c) => c + 1);
    if (reduceMotion) return;
    // Quick scale bump on the counter for a satisfying tally.
    bump.setValue(1);
    Animated.sequence([
      Animated.spring(bump, { toValue: 1.3, friction: 3, tension: 240, useNativeDriver: true }),
      Animated.spring(bump, { toValue: 1, friction: 5, tension: 200, useNativeDriver: true }),
    ]).start();
  };

  return (
    <View style={styles.layer} onLayout={onLayout} pointerEvents="box-none">
      {bounds &&
        INGREDIENTS.map((ing, i) => (
          <FloatingIngredient
            key={`${ing.emoji}-${i}`}
            ingredient={ing}
            index={i}
            bounds={bounds}
            reduceMotion={reduceMotion}
            onPop={handlePop}
          />
        ))}

      {/* Pop counter — a little game while you wait. */}
      <View pointerEvents="none" style={styles.counterWrap}>
        <Animated.View style={[styles.counter, { transform: [{ scale: bump }] }]}>
          <Text style={styles.counterNum}>{count}</Text>
          <Text style={styles.counterLabel}>popped</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, alignSelf: 'stretch', overflow: 'hidden' },
  counterWrap: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  counter: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: Plait.radius.pill,
  },
  counterNum: {
    color: Plait.color.coral,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Plait.font.sans,
  },
  counterLabel: {
    color: Plait.color.textDim,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Plait.font.sans,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  box: { position: 'absolute', top: 0, left: 0, width: BOX, height: BOX },
  fill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: EMOJI, textAlign: 'center' },
  particle: { position: 'absolute' },
});
