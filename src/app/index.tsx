/**
 * Golden path (v2 spec §3): open app → camera IS home. This route only
 * decides where home is — first launch goes to the dietary-profile
 * onboarding, everyone else lands straight on the camera. Lookup, profile,
 * goals, and stats live behind the corner menu on the camera screen.
 * <Redirect> (not router.replace in an effect) is safe on a cold web load,
 * before the root navigator mounts.
 */
import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui-kit';
import { useProfile } from '@/state/profile';

export default function HomeScreen() {
  const { loaded, prefsCompleted } = useProfile();

  if (!loaded) return <Loading message="Loading…" />;
  return <Redirect href={prefsCompleted ? '/camera' : '/preferences'} />;
}
