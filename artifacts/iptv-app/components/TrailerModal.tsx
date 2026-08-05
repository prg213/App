import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

interface Props {
  /**
   * null        → modal is closed
   * 'loading'   → modal open, spinner while caller fetches IDs
   * string[]    → ordered candidate video IDs; modal tries each on embed error
   */
  videoIds: string[] | 'loading' | null;
  onClose: () => void;
}

/**
 * Injected into each YouTube page to detect "Video unavailable" errors and
 * report them back so we can advance to the next candidate.
 *
 * We load m.youtube.com/watch?v=... (the real mobile site, not an iframe embed)
 * so there are no 150/152 embedding restrictions. The only remaining failure
 * mode is an actually deleted / private / geo-blocked video.
 */
const YT_ERROR_DETECTOR = `
(function() {
  var reported = false;
  function report() {
    if (reported) return;
    reported = true;
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'yt-error', code: 150 }));
  }
  function check() {
    if (reported) return;
    var text = (document.body && document.body.innerText) || '';
    if (
      text.indexOf('Video unavailable') !== -1 ||
      text.indexOf('not available') !== -1 ||
      text.indexOf('This video is private') !== -1 ||
      document.querySelector('#error-screen') ||
      document.querySelector('yt-alert-with-actions-renderer')
    ) {
      report();
    }
  }
  document.addEventListener('DOMContentLoaded', function() { setTimeout(check, 1500); });
  setTimeout(check, 3000);
  setTimeout(check, 7000);
})();
true;
`;

/** For non-YouTube URLs (provider trailers) keep the original iframe approach. */
function buildGenericHtml(url: string): string {
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
    src="${url}"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen>
  </iframe>
</div>
</body>
</html>`;
}

const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function isVideoId(s: string): boolean {
  return YT_ID_RE.test(s);
}

export function TrailerModal({ videoIds, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);
  const webviewKey = useRef(0); // increment to force remount on ID change

  // Reset to first candidate whenever a new set arrives
  useEffect(() => {
    setIdx(0);
    setWebviewLoading(true);
    setAllFailed(false);
    webviewKey.current += 1;
  }, [videoIds]);

  // Pause the YouTube WebView when the app goes to the background
  const [appActive, setAppActive] = useState(true);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => sub.remove();
  }, []);

  // Advance to the next candidate; mark allFailed when the last one errors.
  const advance = () => {
    const ids = Array.isArray(videoIds) ? videoIds : [];
    if (idx < ids.length - 1) {
      setIdx((i) => i + 1);
      setWebviewLoading(true);
      webviewKey.current += 1;
    } else {
      setAllFailed(true);
    }
  };

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'yt-error') advance();
    } catch (_) {}
  };

  if (!videoIds) return null;

  const isFetching = videoIds === 'loading';
  const ids = isFetching ? [] : videoIds;
  const current = ids[idx] ?? null;
  const isYt = current ? isVideoId(current) : false;

  // Pause script injected when app goes to background
  const pauseScript = !appActive && isYt
    ? `(function(){ try { var v = document.querySelector('video'); if(v) v.pause(); } catch(e){} })(); true;`
    : '';

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

        {/* ── Loading / error states ── */}
        {isFetching ? (
          <View style={styles.loaderFull}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loaderText}>Finding trailer…</Text>
          </View>
        ) : allFailed || !current ? (
          <View style={styles.loaderFull}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🎬</Text>
            <Text style={styles.loaderText}>No trailer available</Text>
            <Text style={[styles.loaderText, { fontSize: 12, marginTop: 4, opacity: 0.5 }]}>
              No playable trailer was found for this title.
            </Text>
          </View>
        ) : (
          <>
            {webviewLoading && (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#3B82F6" />
              </View>
            )}
            <WebView
              key={webviewKey.current}
              source={
                isYt
                  ? // Load the real YouTube mobile page — no embedding restrictions apply
                    { uri: `https://m.youtube.com/watch?v=${current}&autoplay=1` }
                  : // Provider trailer URL — keep iframe approach
                    { html: buildGenericHtml(current), baseUrl: 'about:blank' }
              }
              style={styles.webview}
              onLoadEnd={() => setWebviewLoading(false)}
              onMessage={handleMessage}
              onError={() => advance()}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
              injectedJavaScript={isYt ? YT_ERROR_DETECTOR : ''}
              injectedJavaScriptBeforeContentLoaded={pauseScript}
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
    position: 'absolute', left: 0, right: 0, bottom: 0,
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
