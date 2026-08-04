import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAppContext } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

const TELEGRAM_FALLBACK_URL = 'https://t.me/s/twstqws';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

export default function TelegramScreen() {
  const insets = useSafeAreaInsets();
  const { credentials } = useAppContext();
  const colors = useColors();
  const [loading, setLoading] = useState(true);

  const url = credentials?.telegramChannel ?? TELEGRAM_FALLBACK_URL;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>💬  Community</Text>
      </View>

      {loading && (
        <View style={[StyleSheet.absoluteFillObject, styles.loader]}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
            Opening community…
          </Text>
        </View>
      )}

      <WebView
        source={{ uri: url }}
        style={styles.webview}
        userAgent={CHROME_UA}
        onLoadEnd={() => setLoading(false)}
        javaScriptEnabled
        domStorageEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  loader: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 10,
    backgroundColor: '#0A0A0F',
    // offset so it sits below the header
    top: 56,
  },
  loaderText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  webview: { flex: 1 },
});
