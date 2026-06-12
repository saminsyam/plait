/**
 * Persistent user profile (survives across scans and app restarts), stored in
 * AsyncStorage. Holds the free-text dietary preferences, the structured hard
 * constraints derived from them, and the once-asked spice ceiling.
 *
 * Storage keys (flat):
 *   preferences_completed "true" once the preferences step is done
 *   user_preferences      raw free-text string
 *   hard_constraints      JSON-encoded HardConstraints (feeds the dietary gate)
 *   spice_ceiling         1 | 2 | 3
 *
 * This is separate from the per-scan <SessionProvider>, which resets every scan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { HardConstraints } from '@/engine/dietaryFilter';
import { DEFAULT_SPICE, parseSpiceCeiling, type SpiceLevel } from '@/engine/questionEngine';

const K = {
  prefsCompleted: 'preferences_completed',
  preferences: 'user_preferences',
  // Structured, machine-checkable hard constraints (allergens + religious
  // rules) smart-parsed from the free-text preferences. These feed the
  // deterministic dietary hard-gate — the model never enforces safety.
  hardConstraints: 'hard_constraints',
  // Spice is the one constant preference, so it's asked once here instead of
  // per scan. Pre-trims every ranking pool (instant and refine).
  spiceCeiling: 'spice_ceiling',
} as const;

type ProfileValue = {
  /** True once the initial AsyncStorage read has finished. */
  loaded: boolean;
  /** Whether the user has finished the preferences onboarding step. */
  prefsCompleted: boolean;
  /** Raw free-text dietary preferences, or null if not set yet. */
  preferences: string | null;
  /** Structured hard constraints for the deterministic gate. Defaults to []. */
  hardConstraints: HardConstraints;
  /** Usual heat ceiling (1 mild · 2 medium · 3 hot). Defaults to medium. */
  spiceCeiling: SpiceLevel;
  /** Persist preferences text and mark the step done. */
  savePreferences: (text: string) => Promise<void>;
  /** Persist the structured hard constraints (smart-parsed from the text). */
  saveHardConstraints: (constraints: HardConstraints) => Promise<void>;
  /** Persist the spice ceiling. */
  saveSpiceCeiling: (level: SpiceLevel) => Promise<void>;
};

const ProfileContext = createContext<ProfileValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [prefsCompleted, setPrefsCompleted] = useState(false);
  const [preferences, setPreferences] = useState<string | null>(null);
  const [hardConstraints, setHardConstraints] = useState<HardConstraints>([]);
  const [spiceCeiling, setSpiceCeiling] = useState<SpiceLevel>(DEFAULT_SPICE);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          K.prefsCompleted,
          K.preferences,
          K.hardConstraints,
          K.spiceCeiling,
        ]);
        if (!active) return;
        const map = Object.fromEntries(entries) as Record<string, string | null>;

        setPrefsCompleted(map[K.prefsCompleted] === 'true');
        if (map[K.preferences]) setPreferences(map[K.preferences]);
        setHardConstraints(parseHardConstraints(map[K.hardConstraints]));
        setSpiceCeiling(parseSpiceCeiling(map[K.spiceCeiling]));
      } catch {
        // First launch / unreadable storage — fall through to defaults.
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const savePreferences = useCallback(async (text: string) => {
    const trimmed = text.trim();
    setPreferences(trimmed);
    setPrefsCompleted(true);
    await AsyncStorage.multiSet([
      [K.preferences, trimmed],
      [K.prefsCompleted, 'true'],
    ]);
  }, []);

  const saveHardConstraints = useCallback(async (constraints: HardConstraints) => {
    setHardConstraints(constraints);
    await AsyncStorage.setItem(K.hardConstraints, JSON.stringify(constraints));
  }, []);

  const saveSpiceCeiling = useCallback(async (level: SpiceLevel) => {
    setSpiceCeiling(level);
    await AsyncStorage.setItem(K.spiceCeiling, String(level));
  }, []);

  const value = useMemo<ProfileValue>(
    () => ({
      loaded,
      prefsCompleted,
      preferences,
      hardConstraints,
      spiceCeiling,
      savePreferences,
      saveHardConstraints,
      saveSpiceCeiling,
    }),
    [
      loaded,
      prefsCompleted,
      preferences,
      hardConstraints,
      spiceCeiling,
      savePreferences,
      saveHardConstraints,
      saveSpiceCeiling,
    ]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}

/**
 * Parse the stored hard-constraints JSON, tolerating absence (older profiles),
 * malformed JSON, and unexpected shapes. Anything we can't validate is dropped
 * rather than trusted — the gate must only ever act on well-formed constraints.
 */
function parseHardConstraints(raw: string | null | undefined): HardConstraints {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is HardConstraints[number] => {
      if (!c || typeof c !== 'object') return false;
      if (c.kind === 'allergen') {
        return typeof c.allergen === 'string' && (c.severity === 'severe' || c.severity === 'mild');
      }
      if (c.kind === 'religious') return c.rule === 'halal' || c.rule === 'kosher';
      return false;
    });
  } catch {
    return [];
  }
}
