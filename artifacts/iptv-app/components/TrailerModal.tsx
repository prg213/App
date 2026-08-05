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
 * Build a YouTube IFrame Player API page for a single video ID.
 *
 * Uses the IFrame API (not a bare embed URL) so we get a proper `onError`
 * callback. When the player fires an error (e.g. 150/152 = embedding disabled)
 * the page posts a message to React Native so we can advance to the next
 * candidate without closing the modal.
 *
 * baseUrl is set to https://www.youtube.com so the player sees a valid page
 * origin — this fixes error 153 (player configuration error).
 */
function buildYtHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden}
  #player{position:absolute;top:0;left:0;width:100%;height:100%}
</style>
</head>
<body>
<div id="player"></div>
<script>
  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  function onYouTubeIframeAPIReady() {
    new YT.Player('player', {
      videoId: '${videoId}',
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: function(e) { e.target.playVideo(); },
        onError: function(e) {
          try {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'yt-error', code: e.data, videoId: '${videoId}' })
            );
          } catch(_) {}
        }
      }
    });
  }
</script>
</body>
</html>`;
}

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
      // All candidates exhausted — show a clean error instead of YouTube's UI.
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

  const html = current
    ? isVideoId(current)
      ? buildYtHtml(current)
      : buildGenericHtml(current)
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
              source={{ html, baseUrl: 'https://www.youtube.com' }}
              style={styles.webview}
              onLoadEnd={() => setWebviewLoading(false)}
              onMessage={handleMessage}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
              // Pause the YouTube iframe when the app goes to the background
              injectedJavaScript={!appActive ? `(function(){ try { document.querySelector('iframe')?.contentWindow?.postMessage('{"event":"command","func":"pauseVideo","args":""}','*'); } catch(e){} })(); true;` : ''}
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
