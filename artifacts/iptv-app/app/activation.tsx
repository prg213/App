import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '@/context/AppContext';
import { useCheckActivation } from '@workspace/api-client-react';
import type { Credentials } from '@/types';

export default function ActivationScreen() {
  const insets = useSafeAreaInsets();
  const { deviceMac, setActivated, isActivated } = useAppContext();
  const [copied, setCopied] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  // Pulse animation for MAC address
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.03, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  // Poll activation endpoint
  const { data, isFetching, refetch } = useCheckActivation(
    { mac: deviceMac },
    {
      query: {
        enabled: !!deviceMac && !isActivated && isPolling,
        refetchInterval: isPolling ? 8000 : false,
        retry: false,
      },
    },
  );

  // Handle successful activation
  useEffect(() => {
    if (data?.status === 'active') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const creds: Credentials = {
        type: (data.type as 'xtream' | 'm3u') ?? 'xtream',
        host: data.host ?? null,
        username: data.username ?? null,
        password: data.password ?? null,
        m3uUrl: data.m3u_url ?? null,
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
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 0) }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Logo */}
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoIcon}>▶</Text>
          </View>
          <Text style={styles.logoName}>StreamVault</Text>
          <Text style={styles.logoTagline}>IPTV Player</Text>
        </View>

        {/* MAC Address */}
        <Animated.View style={[styles.macCard, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.macLabel}>YOUR DEVICE MAC ADDRESS</Text>
          <Text style={styles.macAddress} selectable>
            {deviceMac || '——:——:——:——:——:——'}
          </Text>
          <TouchableOpacity style={styles.copyBtn} onPress={copyMac} activeOpacity={0.7}>
            <Text style={styles.copyBtnText}>{copied ? '✓ Copied!' : 'Copy MAC Address'}</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Instructions */}
        <View style={styles.instructionCard}>
          <Text style={styles.instructionTitle}>How to activate</Text>
          <View style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>1</Text></View>
            <Text style={styles.stepText}>
              Go to your provider's website or admin panel
            </Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>2</Text></View>
            <Text style={styles.stepText}>
              Enter the MAC address shown above
            </Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>3</Text></View>
            <Text style={styles.stepText}>
              Enter your M3U URL or Xtream Codes credentials
            </Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepNum}><Text style={styles.stepNumText}>4</Text></View>
            <Text style={styles.stepText}>
              Tap "Check Activation" below — the app will connect automatically
            </Text>
          </View>
        </View>

        {/* Status */}
        {isPolling && (
          <View style={styles.statusRow}>
            {isFetching ? (
              <ActivityIndicator size="small" color="#3B82F6" />
            ) : (
              <View style={styles.waitDot} />
            )}
            <Text style={styles.statusText}>
              {isFetching ? 'Checking...' : 'Waiting for activation...'}
            </Text>
          </View>
        )}

        {/* Check Button */}
        <TouchableOpacity
          style={[styles.checkBtn, isFetching && styles.checkBtnDisabled]}
          onPress={handleCheck}
          activeOpacity={0.8}
          disabled={isFetching}
        >
          {isFetching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.checkBtnText}>
              {isPolling ? '↻ Refresh Activation' : 'Check Activation'}
            </Text>
          )}
        </TouchableOpacity>

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
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 20,
    alignItems: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    paddingTop: 32,
    gap: 6,
  },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#252538',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  logoIcon: {
    fontSize: 28,
    color: '#3B82F6',
  },
  logoName: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: '#F2F2F2',
    letterSpacing: -0.5,
  },
  logoTagline: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  macCard: {
    width: '100%',
    backgroundColor: '#13131E',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 12,
  },
  macLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#6B7280',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  macAddress: {
    fontSize: 26,
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
    paddingHorizontal: 20,
    paddingVertical: 8,
    marginTop: 4,
  },
  copyBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#3B82F6',
  },
  instructionCard: {
    width: '100%',
    backgroundColor: '#13131E',
    borderWidth: 1,
    borderColor: '#252538',
    borderRadius: 16,
    padding: 20,
    gap: 14,
  },
  instructionTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#F2F2F2',
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#1A1A28',
    borderWidth: 1,
    borderColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    marginTop: 1,
  },
  stepNumText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#3B82F6',
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#C8C8C8',
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  waitDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  statusText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
  },
  checkBtn: {
    width: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBtnDisabled: {
    opacity: 0.6,
  },
  checkBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#FFFFFF',
  },
  autoHint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#6B7280',
    textAlign: 'center',
  },
});
