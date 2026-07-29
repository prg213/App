/**
 * PinPad — reusable 4-digit PIN entry component.
 *
 * Modes:
 *   unlock   — verify PIN to unlock the app (shows "Forgot PIN?" escape)
 *   verify   — verify PIN for a sensitive in-app action (shows Cancel)
 *   set      — enter a new PIN then confirm it (two-step)
 *
 * The caller is responsible for the verify function in unlock/verify modes.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type PinPadMode = 'unlock' | 'verify' | 'set';

interface PinPadProps {
  mode: PinPadMode;
  title?: string;
  subtitle?: string;
  /** Called with the entered PIN when it is verified/set successfully. */
  onSuccess: (pin: string) => void | Promise<void>;
  /** Shown in verify/set mode; tapping dismisses the pad without action. */
  onCancel?: () => void;
  /**
   * Verify mode only: called when the user taps "Forgot PIN / Reset".
   * Should perform a confirmation dialog + logout.
   */
  onForgotPin?: () => void;
  /**
   * Required in unlock/verify modes.
   * Receives the 4-digit string and should return true if the PIN is correct.
   */
  verify?: (pin: string) => Promise<boolean>;
}

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function PinPad({ mode, title, subtitle, onSuccess, onCancel, onForgotPin, verify }: PinPadProps) {
  const insets = useSafeAreaInsets();
  const [firstPin, setFirstPin] = useState('');
  const [entry, setEntry] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const shakeX = useRef(new Animated.Value(0)).current;

  const shake = useCallback(() => {
    shakeX.setValue(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -12, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [shakeX]);

  const reset = useCallback(() => {
    setEntry('');
    setFirstPin('');
    setIsConfirming(false);
    setError('');
    setBusy(false);
  }, []);

  const handleDigit = useCallback(
    (digit: string) => {
      if (busy || entry.length >= 4) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setError('');
      setEntry((p) => p + digit);
    },
    [busy, entry.length],
  );

  const handleDelete = useCallback(() => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEntry((p) => p.slice(0, -1));
    setError('');
  }, [busy]);

  // Auto-submit when 4 digits are entered
  useEffect(() => {
    if (entry.length !== 4 || busy) return;
    setBusy(true);

    const run = async () => {
      if (mode === 'set') {
        if (!isConfirming) {
          // First entry — move to confirm step
          setFirstPin(entry);
          setEntry('');
          setIsConfirming(true);
          setBusy(false);
          return;
        }
        // Confirm step
        if (entry !== firstPin) {
          shake();
          setError('PINs do not match. Try again.');
          setEntry('');
          setFirstPin('');
          setIsConfirming(false);
          setBusy(false);
          return;
        }
        await onSuccess(entry);
        setBusy(false);
        return;
      }

      // unlock / verify
      const ok = verify ? await verify(entry) : false;
      if (ok) {
        await onSuccess(entry);
        setBusy(false);
      } else {
        shake();
        setError('Incorrect PIN. Try again.');
        setEntry('');
        setBusy(false);
      }
    };

    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry]);

  const displayTitle =
    title ??
    (mode === 'set'
      ? isConfirming
        ? 'Confirm your PIN'
        : 'Choose a 4-digit PIN'
      : 'Enter PIN');

  return (
    <View style={[styles.root, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]}>
      {/* Cancel / back (verify mode) */}
      {onCancel && (
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      )}

      {/* Heading */}
      <Text style={styles.title}>{displayTitle}</Text>
      {subtitle && !isConfirming && !error ? (
        <Text style={styles.subtitle}>{subtitle}</Text>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <Text style={[styles.subtitle, { color: 'transparent' }]}>{'·'}</Text>
      )}

      {/* 4-dot indicator */}
      <Animated.View style={[styles.dots, { transform: [{ translateX: shakeX }] }]}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < entry.length ? styles.dotFilled : styles.dotEmpty,
            ]}
          />
        ))}
      </Animated.View>

      {/* Number pad */}
      <View style={styles.pad}>
        {PAD_KEYS.map((key, idx) => {
          if (key === '') return <View key={idx} style={styles.padCell} />;
          return (
            <TouchableOpacity
              key={idx}
              style={styles.padCell}
              onPress={() => (key === '⌫' ? handleDelete() : handleDigit(key))}
              activeOpacity={0.55}
              disabled={busy}
            >
              <View style={[styles.padBtn, key === '⌫' && styles.padBtnDelete]}>
                <Text style={[styles.padKey, key === '⌫' && styles.padKeyDelete]}>{key}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer links */}
      <View style={styles.footer}>
        {mode === 'unlock' && onForgotPin ? (
          <TouchableOpacity onPress={onForgotPin} activeOpacity={0.7}>
            <Text style={styles.forgotText}>Forgot PIN? Reset &amp; logout</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07070F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  cancelBtn: {
    position: 'absolute',
    top: 56,
    right: 24,
    padding: 8,
  },
  cancelText: { fontSize: 15, color: '#3B82F6', fontFamily: 'Inter_500Medium' },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: -0.4,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.45)', textAlign: 'center', marginBottom: 32 },
  errorText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: '#EF4444', textAlign: 'center', marginBottom: 32 },
  dots: { flexDirection: 'row', gap: 20, marginBottom: 40 },
  dot: { width: 16, height: 16, borderRadius: 8 },
  dotFilled: { backgroundColor: '#3B82F6' },
  dotEmpty: { backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 280,
    gap: 12,
    justifyContent: 'center',
  },
  padCell: { width: 80, height: 80, justifyContent: 'center', alignItems: 'center' },
  padBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  padBtnDelete: { backgroundColor: 'transparent' },
  padKey: { fontSize: 26, fontFamily: 'Inter_400Regular', color: '#fff' },
  padKeyDelete: { fontSize: 22, color: 'rgba(255,255,255,0.55)' },
  footer: { marginTop: 32, alignItems: 'center' },
  forgotText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.35)',
    textDecorationLine: 'underline',
  },
});
