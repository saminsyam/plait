/**
 * On-device TDEE + macro math. No API calls — pure functions so the result is
 * instant and testable. Uses the Mifflin-St Jeor BMR equation.
 */
import type { TdeeGoals } from '@/state/profile';

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export const ACTIVITY_LEVELS: { value: ActivityLevel; label: string; multiplier: number }[] = [
  { value: 'sedentary', label: 'Sedentary', multiplier: 1.2 },
  { value: 'light', label: 'Light', multiplier: 1.375 },
  { value: 'moderate', label: 'Moderate', multiplier: 1.55 },
  { value: 'active', label: 'Active', multiplier: 1.725 },
  { value: 'very_active', label: 'Very active', multiplier: 1.9 },
];

// High-protein macro split, as fractions of total calories.
const PROTEIN_FRACTION = 0.35;
const CARBS_FRACTION = 0.4;
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
};

/** Returns calories + macro grams, all rounded to whole numbers. */
export function computeTdee({ age, weightKg, heightCm, sex, activity }: TdeeInput): TdeeGoals {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = sex === 'male' ? base + 5 : base - 161;
  const multiplier = ACTIVITY_LEVELS.find((a) => a.value === activity)?.multiplier ?? 1.2;
  const calories = Math.round(bmr * multiplier);

  return {
    calories,
    protein_g: Math.round((calories * PROTEIN_FRACTION) / 4),
    carbs_g: Math.round((calories * CARBS_FRACTION) / 4),
    fat_g: Math.round((calories * FAT_FRACTION) / 9),
  };
}
