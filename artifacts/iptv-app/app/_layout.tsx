import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, View } from 'react-native';
import { UpdateModal } from '@/components/UpdateModal';
import { ConfirmModal } from '@/components/ConfirmModal';
import { checkForUpdate, type UpdateInfo } from '@/services/updateService';
import { Toast } from '@/components/Toast';
import {
  addNotificationTapListener,
  cancelAndPruneExpiredReminders,
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
    queries: {
      retry: 1,
      staleTime: 2 * 60_000,
      // Firestick / Android TV: the OS fires focus-change events whenever an
      // overlay opens, a modal appears, or the app returns from the system
      // launcher.  Without this flag every active query refetches on each of
      // those events — hammering the IPTV provider API and causing the UI to
      // re-render during channel zapping.  Freshness is governed by staleTime
      // per query; window-focus refetches add nothing for an IPTV app.
      refetchOnWindowFocus: false,
    },
  },
});

/** Gates the entire tab navigator behind a PIN screen when the app is locked. */
function RootLayoutNav() {
  const { isLoading, isActivated } = useAppContext();
  const { isLocked, parentalReady, unlockApp, resetAndLogout } = useParentalContext();
  const router = useRouter();
  const segments = useSegments();
  const [expiredToast, setExpiredToast] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);

  // Tracks whether we have already performed the one-shot startup navigation to
  // Home.  Without this guard, React Navigation's persisted tab state can reopen
  // the app on whichever tab was last active (e.g. Live TV) instead of Home.
  const hasNavigatedHomeRef = React.useRef(false);

  useEffect(() => {
    if (isLoading) return;
    const inActivation = segments[0] === 'activation';
    if (!isActivated && !inActivation) {
      // Logged out or deactivated — send to activation.
      router.replace('/activation');
      hasNavigatedHomeRef.current = false;
    } else if (isActivated && inActivation) {
      // Just finished the activation flow — land on Home.
      router.replace('/(tabs)/home');
      hasNavigatedHomeRef.current = true;
    } else if (isActivated && !hasNavigatedHomeRef.current) {
      // Cold-start with an existing session.  React Navigation may have persisted
      // the last active tab (e.g. Live TV).  Always reset to Home so the app
      // never opens on a content tab without the user choosing it.
      hasNavigatedHomeRef.current = true;
      if ((segments as string[])[1] !== 'home') {
        router.replace('/(tabs)/home');
      }
    }
  }, [isLoading, isActivated, segments]);

  // Check for a newer APK on GitHub — Android only, shown once per session.
  useEffect(() => {
    if (!isActivated || Platform.OS !== 'android') return;
    checkForUpdate().then((info) => {
      if (info) setPendingUpdate(info);
    });
  }, [isActivated]);

  // Request notification permissions, reschedule any reminders lost on reboot,
  // and listen for notification taps once the app is ready.
  useEffect(() => {
    if (!isActivated) return;
    requestNotificationPermissions();
    // Cancel notifications and remove reminders whose programme has already
    // ended (handles clock drift and long app-closed periods).
    cancelAndPruneExpiredReminders().then((expiredCount) => {
      if (expiredCount > 0) {
        const label = expiredCount === 1 ? 'reminder' : 'reminders';
        setExpiredToast(`${expiredCount} ${label} removed — programme already ended`);
      }
    });
    // Fire-and-forget: restores reminders lost when Android cancelled all
    // alarms at device reboot.
    rescheduleStaleReminders();
    return addNotificationTapListener(({ channelId, start }) => {
      // Navigate to the TV Guide tab; pass channelId + start so the guide
      // can auto-select the relevant channel and highlight its programme.
      router.push({ pathname: '/(tabs)/guide', params: { channelId: channelId ?? '', start: start ? String(start) : '' } });
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
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
            // The Android VLC surface lives in this screen while the transparent
            // player route supplies controls. Do not freeze the owner while the
            // fullscreen route asks it to resize to the current window.
            freezeOnBlur: false,
          }}
        />
        <Stack.Screen name="activation" options={{ headerShown: false, gestureEnabled: false }} />
        {/*
          Android live fullscreen can reuse the already-mounted VLC mini-player
          underneath this route. A transparent modal lets that native surface
          grow to the window while this screen supplies only the controls.
        */}
        <Stack.Screen
          name="player"
          options={{
            headerShown: false,
            presentation: Platform.OS === 'android' ? 'transparentModal' : 'fullScreenModal',
            animation: 'none',
            contentStyle: { backgroundColor: 'transparent' },
            // Native Stack is otherwise allowed to detach the previous scene
            // underneath a modal. Keeping the Live TV scene attached is what
            // preserves the one TextureView and its active libVLC output.
            detachPreviousScreen: false,
          }}
        />
        <Stack.Screen name="movie/[id]" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false, animation: 'slide_from_right', gestureEnabled: true }} />
      </Stack>
      {expiredToast !== null && (
        <Toast
          message={expiredToast}
          visible
          onHide={() => setExpiredToast(null)}
        />
      )}
      {pendingUpdate && (
        <UpdateModal
          update={pendingUpdate}
          onDismiss={() => setPendingUpdate(null)}
        />
      )}
    </View>
  );
}

/**
 * Bridges AppContext.logout into the ParentalContextProvider so the
 * "Forgot PIN" escape can trigger a full logout with a confirmation dialog.
 */
function ParentalWrapper({ children }: { children: React.ReactNode }) {
  const { logout } = useAppContext();
  // TV: Alert.alert buttons are unreliable on Fire OS — ConfirmModal is the
  // safe alternative.  Touch keeps the native Alert (matching existing UX).
  const [forgotPinVisible, setForgotPinVisible] = useState(false);

  const handleForgotPin = useCallback(() => {
    if (Platform.isTV) {
      setForgotPinVisible(true);
    } else {
      Alert.alert(
        'Reset App',
        'This will remove your IPTV credentials and disable the PIN. You will need to set up the app again.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset & Logout', style: 'destructive', onPress: logout },
        ],
      );
    }
  }, [logout]);

  return (
    <ParentalContextProvider onForgotPin={handleForgotPin}>
      {children}
      {/* TV-safe "Forgot PIN / Reset App" confirmation modal */}
      <ConfirmModal
        visible={forgotPinVisible}
        title="Reset App"
        message="This will remove your IPTV credentials and disable the PIN. You will need to set up the app again."
        confirmLabel="Reset & Logout"
        destructive
        onConfirm={() => { setForgotPinVisible(false); logout(); }}
        onCancel={() => setForgotPinVisible(false)}
      />
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
