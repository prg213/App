import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '@/context/AppContext';
import { StorageService } from '@/services/storage';
import type { Credentials } from '@/types';
import { FocusablePressable } from '@/components/FocusablePressable';

async function checkActivation(mac: string) {
  const base = process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : '';
  const res = await fetch(`${base}/api/activate?mac=${encodeURIComponent(mac)}`);
  if (!res.ok) throw new Error('Not activated');
  return res.json() as Promise<{
    status: 'active' | 'pending';
    type?: string;
    host?: string;
    username?: string;
    password?: string;
    m3u_url?: string;
    telegram_channel?: string | null;
  }>;
}

export default function ActivationScreen() {
  const insets = useSafeAreaInsets();
  const { deviceMac, setActivated, isActivated } = useAppContext();
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(true);
  const [deactivatedBanner, setDeactivatedBanner] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  // Read and clear the one-time logout reason written by AppContext on forced logout
  useEffect(() => {
    StorageService.consumeLogoutReason().then((reason) => {
      if (reason === 'deactivated') setDeactivatedBanner(true);
    });
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.02, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['activation', deviceMac],
    queryFn: () => checkActivation(deviceMac),
    enabled: !!deviceMac && !isActivated && isPolling,
    refetchInterval: isPolling ? 8000 : false,
    retry: false,
  });

  useEffect(() => {
    if (data?.status === 'active') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const creds: Credentials = {
        type: (data.type as 'xtream' | 'm3u') ?? 'xtream',
        host: data.host ?? null,
        username: data.username ?? null,
        password: data.password ?? null,
        m3uUrl: data.m3u_url ?? null,
        telegramChannel: data.telegram_channel ?? null,
      };
      setActivated(creds);
    }
  }, [data?.status]);

  const copyMac = useCallback(async () => {
    if (!deviceMac) return;
    await Clipboard.setStringAsync(deviceMac);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [deviceMac]);

  const handleCheck = useCallback(async () => {
    if (!isPolling) setIsPolling(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    refetch();
  }, [isPolling, refetch]);

  return (
    <View style={[styles.container, { paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* Admin-removal banner — shown once after a forced logout */}
      {deactivatedBanner && (
        <View style={[styles.deactivatedBanner, { top: insets.top + 12 }]}>
          <Text style={styles.deactivatedBannerText}>
            ⚠️  Your access was removed by an administrator. Please contact support.
          </Text>
          <FocusablePressable onPress={() => setDeactivatedBanner(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deactivatedBannerDismiss}>✕</Text>
          </FocusablePressable>
        </View>
      )}

      {/* Left: Branding */}
      <View style={[styles.left, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.logo}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoIcon}>▶</Text>
          </View>
          <Text style={styles.logoName}>StreamVault</Text>
          <Text style={styles.logoTagline}>IPTV PLAYER</Text>
        </View>

        {/* MAC address */}
        <Animated.View style={[styles.macCard, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.macLabel}>YOUR DEVICE MAC</Text>
          <Text style={styles.macAddress} selectable>
            {deviceMac || '——:——:——:——:——:——'}
          </Text>
          <FocusablePressable style={styles.copyBtn} onPress={copyMac}>
            <Text style={styles.copyText}>{copied ? '✓ Copied!' : 'Copy'}</Text>
          </FocusablePressable>
        </Animated.View>

        {isPolling && (
          <View style={styles.statusRow}>
            {isFetching
              ? <ActivityIndicator size="small" color="#3B82F6" />
              : <View style={styles.statusDot} />
            }
            <Text style={styles.statusText}>
              {isFetching ? 'Checking...' : 'Waiting — polls every 8s'}
            </Text>
          </View>
        )}
      </View>

      {/* Right: Instructions + button */}
      <ScrollView
        style={styles.right}
        contentContainerStyle={[styles.rightContent, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.instrTitle}>How to activate</Text>
        {[
          "Go to your provider's website or admin panel",
          'Enter the MAC address shown on the left',
          'Enter your M3U URL or Xtream Codes credentials',
          'Tap "Check Activation" — app will connect automatically',
        ].map((step: string, i: number) => (
          <View key={i} style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}

        <FocusablePressable
          style={[styles.checkBtn, isFetching && styles.checkBtnDisabled]}
          onPress={handleCheck}
          disabled={isFetching}
          hasTVPreferredFocus={Platform.isTV}
        >
          {isFetching
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.checkBtnText}>{isPolling ? '↻ Refresh' : 'Check Activation'}</Text>
          }
        </FocusablePressable>

        {isPolling && (
          <Text style={styles.autoHint}>Checking automatically every 8 seconds</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
    flexDirection: 'row',
  },
  left: {
    width: '45%',
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    borderRightWidth: 1,
    borderRightColor: '#1E1E30',
  },
  logo: { alignItems: 'center', gap: 6 },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#252538',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  logoIcon: { fontSize: 26, color: '#3B82F6' },
  logoName: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#F2F2F2', letterSpacing: -0.5 },
  logoTagline: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#6B7280', letterSpacing: 2 },
  macCard: {
    width: '100%',
    backgroundColor: '#13131E',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  macLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: '#6B7280', letterSpacing: 1.5 },
  macAddress: {
    fontSize: Platform.OS === 'web' ? 20 : 22,
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'Inter_700Bold' }),
    color: '#F2F2F2',
    letterSpacing: 2,
    textAlign: 'center',
  },
  copyBtn: {
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#252538',
    borderRadius: 99,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  copyText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#3B82F6' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: '#3B82F6' },
  statusText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#6B7280' },
  right: { flex: 1 },
  rightContent: { paddingHorizontal: 32, gap: 14 },
  instrTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#F2F2F2', marginBottom: 4 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#1A1A28', borderWidth: 1, borderColor: '#3B82F6',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0, marginTop: 1,
  },
  stepNumText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#3B82F6' },
  stepText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#C8C8C8', lineHeight: 20 },
  checkBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  checkBtnDisabled: { opacity: 0.6 },
  checkBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  autoHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6B7280', textAlign: 'center' },
  deactivatedBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3B1A1A',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
  },
  deactivatedBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#FCA5A5',
    lineHeight: 18,
  },
  deactivatedBannerDismiss: {
    fontSize: 14,
    color: '#FCA5A5',
    fontFamily: 'Inter_600SemiBold',
  },
});
