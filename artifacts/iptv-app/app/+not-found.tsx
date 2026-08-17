import React, { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useColors } from '@/hooks/useColors';
import { requestTvFocus } from '@/lib/tvFocus';

export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();
  // TV: give the "Go home" button immediate D-pad focus so the user is not
  // stranded on a screen with no focusable element.
  const homeBtnRef = useRef<View>(null);
  useEffect(() => {
    if (!Platform.isTV) return;
    const t = setTimeout(() => requestTvFocus(homeBtnRef.current), 150);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          This screen doesn&apos;t exist.
        </Text>

        {/* Expo Link is not TV-focusable; FocusablePressable + router.replace is. */}
        <FocusablePressable ref={homeBtnRef} style={styles.link} onPress={() => router.replace('/')}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Go to home screen!
          </Text>
        </FocusablePressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  linkText: {
    fontSize: 14,
  },
});
