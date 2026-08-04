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

/**
 * Build a self-contained HTML page that embeds the YouTube player inside a
 * proper <iframe> with the correct `allow` attribute. Injecting HTML with
 * baseUrl="https://www.youtube.com" makes YouTube treat the embed as
 * originating from youtube.com, which avoids Error 153 ("Video player
 * configuration error") that occurs when the player is loaded as a bare URI
 * in a WebView (no real page origin → YouTube blocks playback).
 */
function buildEmbedHtml(url: string): string {
  const videoMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  const src = videoMatch
    ? `https://www.youtube.com/embed/${videoMatch[1]}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
    : url;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  .wrap{position:relative;width:100%;height:100%}
  iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:none}
</style>
</head>
<body>
<div class="wrap">
  <iframe
    src="${src}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen>
  </iframe>
</div>
</body>
</html>`;
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
  const embedHtml = isFetching ? '' : buildEmbedHtml(url);

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
              source={{ html: embedHtml, baseUrl: 'https://www.youtube.com' }}
              style={styles.webview}
              onLoadEnd={() => setWebviewLoading(false)}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
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
