/**
 * Lightweight auto-dismissing toast banner shown at the bottom of the screen.
 *
 * Usage:
 *   <Toast message="Hello!" visible={show} onHide={() => setShow(false)} />
 *
 * The banner fades in, stays for `duration` ms, then fades out and calls
 * onHide so the parent can clear its state.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ToastProps {
  message: string;
  visible: boolean;
  /** How long (ms) the toast stays fully visible before fading out. Default 3000. */
  duration?: number;
  onHide: () => void;
}

export function Toast({ message, visible, duration = 3000, onHide }: ToastProps) {
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;

    // Fade in
    Animated.timing(opacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();

    // Schedule fade-out after duration
    hideTimer.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) onHide();
      });
    }, duration);

    return () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[styles.container, { opacity, bottom: Math.max(80, insets.bottom + 16) }]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(30, 30, 40, 0.92)',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 9999,
  },
  text: {
    color: '#E5E7EB',
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
