/**
 * Persistent user profile (survives across scans and app restarts), stored in
 * AsyncStorage. Holds the optional TDEE / macro goals and the free-text dietary
 * preferences captured during onboarding.
 *
 * Storage keys (flat, per spec):
 *   tdee_completed        "true" once the TDEE step is done (saved OR skipped)
 *   tdee_calories         number | (absent if skipped)
 *   tdee_protein_g        number
 *   tdee_carbs_g          number
 *   tdee_fat_g            number
 *   preferences_completed "true" once the preferences step is done
 *   user_preferences      raw free-text string
 *
 * This is separate from the per-scan <SessionProvider>, which resets every scan.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

const K = {
  tdeeCompleted: 'tdee_completed',
  calories: 'tdee_calories',
  protein: 'tdee_protein_g',
  carbs: 'tdee_carbs_g',
  fat: 'tdee_fat_g',
  prefsCompleted: 'preferences_completed',
  preferences: 'user_preferences',
} as const;

/** Daily macro/calorie targets, computed on-device from the TDEE calculator. */
export type TdeeGoals = {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type ProfileValue = {
  /** True once the initial AsyncStorage read has finished. */
  loaded: boolean;
  /** Whether the user has finished the TDEE onboarding step (saved or skipped). */
  tdeeCompleted: boolean;
  /** Macro goals, or null if the user skipped the TDEE step. */
  tdee: TdeeGoals | null;
  /** Whether the user has finished the preferences onboarding step. */
  prefsCompleted: boolean;
  /** Raw free-text dietary preferences, or null if not set yet. */
  preferences: string | null;
  /** Persist TDEE goals (or null when the user skips) and mark the step done. */
  completeTdee: (goals: TdeeGoals | null) => Promise<void>;
  /** Persist preferences text and mark the step done. */
  savePreferences: (text: string) => Promise<void>;
};

const ProfileContext = createContext<ProfileValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [tdeeCompleted, setTdeeCompleted] = useState(false);
  const [tdee, setTdee] = useState<TdeeGoals | null>(null);
  const [prefsCompleted, setPrefsCompleted] = useState(false);
  const [preferences, setPreferences] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const entries = await AsyncStorage.multiGet([
          K.tdeeCompleted,
          K.calories,
          K.protein,
          K.carbs,
          K.fat,
          K.prefsCompleted,
          K.preferences,
        ]);
        if (!active) return;
        const map = Object.fromEntries(entries) as Record<string, string | null>;

        setTdeeCompleted(map[K.tdeeCompleted] === 'true');
        if (map[K.calories] != null) {
          setTdee({
            calories: Number(map[K.calories]),
            protein_g: Number(map[K.protein]),
            carbs_g: Number(map[K.carbs]),
            fat_g: Number(map[K.fat]),
          });
        }
        setPrefsCompleted(map[K.prefsCompleted] === 'true');
        if (map[K.preferences]) setPreferences(map[K.preferences]);
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

  const completeTdee = useCallback(async (goals: TdeeGoals | null) => {
    setTdee(goals);
    setTdeeCompleted(true);
    if (goals) {
      await AsyncStorage.multiSet([
        [K.tdeeCompleted, 'true'],
        [K.calories, String(goals.calories)],
        [K.protein, String(goals.protein_g)],
        [K.carbs, String(goals.carbs_g)],
        [K.fat, String(goals.fat_g)],
      ]);
    } else {
      // Skipped: mark done but clear any stale macro values.
      await AsyncStorage.multiRemove([K.calories, K.protein, K.carbs, K.fat]);
      await AsyncStorage.setItem(K.tdeeCompleted, 'true');
    }
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

  const value = useMemo<ProfileValue>(
    () => ({
      loaded,
      tdeeCompleted,
      tdee,
      prefsCompleted,
      preferences,
      completeTdee,
      savePreferences,
    }),
    [loaded, tdeeCompleted, tdee, prefsCompleted, preferences, completeTdee, savePreferences]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
