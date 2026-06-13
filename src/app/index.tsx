/**
 * Entry route — decides where home is. First launch goes to the dietary-profile
 * onboarding; everyone else lands on the dashboard (the opening screen, from
 * which the camera is one tap away). <Redirect> (not router.replace in an
 * effect) is safe on a cold web load, before the root navigator mounts.
 */
import { Redirect } from 'expo-router';

import { Loading } from '@/components/ui-kit';
import { useProfile } from '@/state/profile';

export default function HomeScreen() {
  const { loaded, prefsCompleted } = useProfile();

  if (!loaded) return <Loading message="Loading…" />;
  return <Redirect href={prefsCompleted ? '/dashboard' : '/preferences'} />;
}
