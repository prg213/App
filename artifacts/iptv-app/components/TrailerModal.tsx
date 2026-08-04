import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

interface Props {
  /**
   * null  → modal is closed
   * 'loading' → modal open, showing a full-screen spinner while the caller
   *              fetches the real URL asynchronously
   * string URL → modal open, rendering the video in a WebView
   */
  url: string | null;
  onClose: () => void;
}

// A recent desktop Chrome UA. YouTube checks this to decide whether to serve
// the embed player — without it the WebView gets Error 153 ("Video player
// configuration error") because YouTube treats bare WebViews as bots.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

/** Convert a YouTube watch/shorts URL to an embeddable autoplay URL. */
function toEmbedUrl(url: string): string {
  const watchMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (watchMatch) {
    return (
      `https://www.youtube.com/embed/${watchMatch[1]}` +
      `?autoplay=1&rel=0&modestbranding=1&playsinline=1` +
      `&origin=https%3A%2F%2Fwww.youtube.com`
    );
  }
  return url;
}

export function TrailerModal({ url, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [webviewLoading, setWebviewLoading] = useState(true);

  // Reset spinner each time a new URL is set
  useEffect(() => {
    if (url && url !== 'loading') setWebviewLoading(true);
  }, [url]);

  if (!url) return null;

  const isFetching = url === 'loading';
  const embedUrl = isFetching ? '' : toEmbedUrl(url);

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Trailer</Text>
          <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>
        </View>

        {/* ── Loading state (TMDB fetch in progress) ── */}
        {isFetching ? (
          <View style={styles.loaderFull}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loaderText}>Finding trailer…</Text>
          </View>
        ) : (
          <>
            {webviewLoading && (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#3B82F6" />
              </View>
            )}
            <WebView
              source={{ uri: embedUrl }}
              style={styles.webview}
              userAgent={CHROME_UA}
              onLoadEnd={() => setWebviewLoading(false)}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A0F',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#F2F2F2',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeTxt: {
    fontSize: 14,
    color: '#F2F2F2',
    lineHeight: 18,
  },
  loaderFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loaderText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 56,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
});
