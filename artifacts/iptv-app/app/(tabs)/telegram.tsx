import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { useAppContext } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

/**
 * Injected after each page load to:
 *  1. Hide the "Download Telegram" channel-info popup / widget overlay
 *  2. Keep hiding it if Telegram re-renders it dynamically
 */
const HIDE_POPUP_JS = `
(function() {
  var style = document.createElement('style');
  style.textContent = [
    /* Channel-info popup card */
    '.tgme_channel_info_wrap, .tgme_channel_info, .tgme_channel_widget,',
    '.tgme_page_widget, .tgme_widget, .widget_frame,',
    /* "Download Telegram" footer bar */
    '.tgme_header_right_btn[href*="telegram"], .tgme_download,',
    /* Generic overlay / tooltip that pops up when tapping a name */
    '.popup, .popup_bg, .popup_holder,',
    '.tooltip, .tooltip-container,',
    /* t.me preview page footer links (About / Blog / Apps / Platform) */
    '.tgme_footer, .tgme_page_extra',
    '{ display: none !important; opacity: 0 !important; pointer-events: none !important; }'
  ].join(' ');
  document.head.appendChild(style);

  /* Also close any already-open popup by clicking its close button */
  function dismissPopup() {
    var closers = document.querySelectorAll(
      '.popup .btn-icon, .popup .close, [class*="close"], .popup_close, ' +
      '.tgme_channel_info_wrap .close'
    );
    closers.forEach(function(el) { try { el.click(); } catch(e) {} });
  }
  dismissPopup();

  /* Watch for dynamically added popups and hide them too */
  var obs = new MutationObserver(function() { dismissPopup(); });
  obs.observe(document.body, { childList: true, subtree: true });
})();
true;
`;

export default function TelegramScreen() {
  const insets = useSafeAreaInsets();
  const { credentials } = useAppContext();
  const colors = useColors();
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef<WebView>(null);

  const url = credentials?.telegramChannel ?? null;

  const handleRefresh = () => {
    webViewRef.current?.reload();
    setLoading(true);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>
          💬  Community
        </Text>

        {url ? (
          <FocusablePressable
            onPress={handleRefresh}
            hitSlop={10}
            style={styles.refreshBtn}
          >
            <Text style={[styles.refreshIcon, { color: colors.mutedForeground }]}>
              ↺
            </Text>
          </FocusablePressable>
        ) : null}
      </View>

      {url ? (
        <>
          {loading && (
            <View style={[StyleSheet.absoluteFill, styles.loader]}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={[styles.loaderText, { color: colors.mutedForeground }]}>
                Opening community…
              </Text>
            </View>
          )}
          <WebView
            ref={webViewRef}
            source={{ uri: url }}
            style={styles.webview}
            userAgent={CHROME_UA}
            onLoadEnd={() => setLoading(false)}
            injectedJavaScript={HIDE_POPUP_JS}
            javaScriptEnabled
            domStorageEnabled
          />
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No community channel
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            A Telegram channel hasn't been set up for your account yet.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  refreshIcon: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '300',
  },
  loader: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    zIndex: 10,
    backgroundColor: '#0A0A0F',
    top: 56,
  },
  loaderText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  webview: { flex: 1 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptyText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
});
