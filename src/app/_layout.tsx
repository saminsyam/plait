import { Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import {
  PublicSans_400Regular,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
} from '@expo-google-fonts/public-sans';
import {
  SplineSansMono_400Regular,
  SplineSansMono_600SemiBold,
} from '@expo-google-fonts/spline-sans-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Plait } from '@/constants/plait-theme';
import { ProfileProvider } from '@/state/profile';
import { SessionProvider } from '@/state/session';

// Hold the splash until the Sushi 2.1 type ramp is ready — the design system
// leans on Fraunces/Public Sans/Spline Sans Mono everywhere.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    PublicSans_400Regular,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    SplineSansMono_400Regular,
    SplineSansMono_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ProfileProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: Plait.color.paper },
              animation: 'slide_from_right',
            }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="preferences" />
            <Stack.Screen name="camera" />
            <Stack.Screen name="picks" />
            <Stack.Screen name="stats" />
          </Stack>
        </SessionProvider>
      </ProfileProvider>
    </SafeAreaProvider>
  );
}
