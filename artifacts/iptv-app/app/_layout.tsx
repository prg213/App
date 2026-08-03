import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import {
  addNotificationTapListener,
  requestNotificationPermissions,
  rescheduleStaleReminders,
  setupNotifications,
} from '@/services/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AppContextProvider, useAppContext } from '@/context/AppContext';
import { ParentalContextProvider, useParentalContext } from '@/context/ParentalContext';
import { LivePlayerProvider } from '@/context/LivePlayerContext';
import { PinPad } from '@/components/PinPad';

// setBaseUrl inlined — @workspace/api-client-react is not available in EAS builds
let _apiBaseUrl: string | null = null;
function setBaseUrl(url: string | null) { _apiBaseUrl = url ? url.replace(/\/+$/, '') : null; }

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

SplashScreen.preventAutoHideAsync();

// Configure notification handler and Android channel once at module load
setupNotifications();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 2 * 60_000 },
  },
});

/** Gates the entire tab navigator behind a PIN screen when the app is locked. */
function RootLayoutNav() {
  const { isLoading, isActivated } = useAppContext();
  const { isLocked, parentalReady, unlockApp, resetAndLogout } = useParentalContext();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (isLoading) return;
    const inActivation = segments[0] === 'activation';
    if (!isActivated && !inActivation) {
      router.replace('/activation');
    } else if (isActivated && inActivation) {
      router.replace('/(tabs)');
    }
  }, [isLoading, isActivated, segments]);

  // Request notification permissions, reschedule any reminders lost on reboot,
  // and listen for notification taps once the app is ready.
  useEffect(() => {
    if (!isActivated) return;
    requestNotificationPermissions();
    // Fire-and-forget: restores reminders lost when Android cancelled all
    // alarms at device reboot.
    rescheduleStaleReminders();
    return addNotificationTapListener(({ channelId, start }) => {
      // Navigate to the TV Guide tab; the deep-link carries channelId + start
      // so the guide can highlight the right programme when task #85 lands.
      // For now we navigate to guide which is sufficient.
      router.push('/(tabs)/guide');
    });
  }, [isActivated, router]);

  if (isLoading || !parentalReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A0A0F', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  // Show PIN gate over the entire navigator when the app is locked
  if (isLocked && isActivated) {
    return (
      <PinPad
        mode="unlock"
        subtitle="Enter your PIN to continue"
        verify={unlockApp}
        onSuccess={() => {}}
        onForgotPin={resetAndLogout}
      />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="activation" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="player" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'none' }} />
      <Stack.Screen name="movie/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Bridges AppContext.logout into the ParentalContextProvider so the
 * "Forgot PIN" escape can trigger a full logout with a confirmation dialog.
 */
function ParentalWrapper({ children }: { children: React.ReactNode }) {
  const { logout } = useAppContext();

  const handleForgotPin = useCallback(() => {
    Alert.alert(
      'Reset App',
      'This will remove your IPTV credentials and disable the PIN. You will need to set up the app again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset & Logout', style: 'destructive', onPress: logout },
      ],
    );
  }, [logout]);

  return (
    <ParentalContextProvider onForgotPin={handleForgotPin}>
      {children}
    </ParentalContextProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AppContextProvider>
                <ParentalWrapper>
                  <LivePlayerProvider>
                    <RootLayoutNav />
                  </LivePlayerProvider>
                </ParentalWrapper>
              </AppContextProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
