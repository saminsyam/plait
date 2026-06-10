/**
 * On-device TDEE + macro math. No API calls — pure functions so the result is
 * instant and testable.
 *
 * Method: Mifflin-St Jeor BMR × activity multiplier = maintenance TDEE, then
 * adjusted for the user's goal. Protein is set per kg of body weight (the
 * evidence-based way — a fixed %-of-calories split under-feeds protein for
 * light people on big cuts and over-feeds heavy people), fat gets 25% of
 * calories, and carbs take the remainder.
 */
import type { TdeeGoals } from '@/state/profile';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'cut' | 'maintain' | 'bulk';

export const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; multiplier: number }[] = [
  { value: 'sedentary', label: 'Sedentary', multiplier: 1.2 },
  { value: 'light', label: 'Light', multiplier: 1.375 },
  { value: 'moderate', label: 'Moderate', multiplier: 1.55 },
  { value: 'active', label: 'Active', multiplier: 1.725 },
  { value: 'very_active', label: 'Very active', multiplier: 1.9 },
];

export const GOALS: {
  value: Goal;
  label: string;
  /** Multiplier on maintenance calories. */
  calorieFactor: number;
  /** Daily protein target per kg of body weight. Higher in a deficit to spare muscle. */
  proteinPerKg: number;
}[] = [
  { value: 'cut', label: 'Lose fat', calorieFactor: 0.85, proteinPerKg: 2.2 },
  { value: 'maintain', label: 'Maintain', calorieFactor: 1.0, proteinPerKg: 1.6 },
  { value: 'bulk', label: 'Build muscle', calorieFactor: 1.1, proteinPerKg: 2.0 },
];

/** Fraction of calories allotted to fat; carbs absorb the rest. */
const FAT_FRACTION = 0.25;

const LBS_TO_KG = 0.45359237;
const INCH_TO_CM = 2.54;

export const lbsToKg = (lbs: number) => lbs * LBS_TO_KG;
export const ftInToCm = (ft: number, inches: number) => (ft * 12 + inches) * INCH_TO_CM;

export type TdeeInput = {
  age: number;
  weightKg: number;
  heightCm: number;
  sex: Sex;
  activity: ActivityLevel;
  goal: Goal;
};

/** Returns goal-adjusted calories + macro grams, all rounded to whole numbers. */
export function computeTdee({ age, weightKg, heightCm, sex, activity, goal }: TdeeInput): TdeeGoals {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = sex === 'male' ? base + 5 : base - 161;
  const multiplier = ACTIVITY_LEVELS.find((a) => a.value === activity)?.multiplier ?? 1.2;
  const g = GOALS.find((x) => x.value === goal) ?? GOALS[1];

  const calories = Math.round(bmr * multiplier * g.calorieFactor);
  const protein_g = Math.round(g.proteinPerKg * weightKg);
  const fat_g = Math.round((calories * FAT_FRACTION) / 9);
  // Carbs take whatever calories remain after protein and fat (never negative —
  // an extreme cut on a heavy person can spend them all on protein).
  const carbs_g = Math.max(0, Math.round((calories - protein_g * 4 - fat_g * 9) / 4));

  return { calories, protein_g, carbs_g, fat_g };
}
