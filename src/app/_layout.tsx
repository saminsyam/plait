import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Plait } from '@/constants/plait-theme';
import { ProfileProvider } from '@/state/profile';
import { SessionProvider } from '@/state/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <SessionProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: Plait.color.background },
              animation: 'slide_from_right',
            }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="tdee" />
            <Stack.Screen name="preferences" />
            <Stack.Screen name="lookup" />
            <Stack.Screen name="camera" />
            <Stack.Screen name="budget" />
            <Stack.Screen name="questions" />
            <Stack.Screen name="results" />
          </Stack>
        </SessionProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
