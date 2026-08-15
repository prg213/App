import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  ActivityIndicator,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
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
  /**
   * TV only: ref to the button that opened this modal.  When the modal closes,
   * focus is restored to this element so the D-pad cursor doesn't go dead.
   */
  openerRef?: React.RefObject<View | null>;
}

/**
 * Build a YouTube IFrame Player API page.
 *
 * Uses the IFrame API so we get a proper `onError` callback (150/152 =
 * embedding disabled). On error the page posts a message back so we can
 * advance to the next candidate without closing the modal.
 *
 * `onReady` immediately calls unMute() + setVolume(100) to override the
 * autoplay-muted behaviour YouTube applies by default in embedded players.
 *
 * baseUrl is set to https://www.youtube.com so the player origin check passes.
 */
function buildYtHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
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

  var player;
  var pendingUnmute = false; // buffered if unmute arrives before onReady

  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      videoId: '${videoId}',
      width: '100%',
      height: '100%',
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 1,
        mute: 1,
        controls: 1,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        fs: 1,
        iv_load_policy: 3,
        origin: 'https://www.youtube-nocookie.com'
      },
      events: {
        onReady: function(e) {
          e.target.playVideo();
          if (pendingUnmute) { e.target.unMute(); e.target.setVolume(100); }
          /* Tell the native side the player is ready — pill can now be shown */
          try {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'yt-ready' })
            );
          } catch(_) {}
        },
        onError: function(e) {
          /* 150/152 = embedding disabled; 100 = not found; 101 = not embeddable */
          try {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'yt-error', code: e.data, videoId: '${videoId}' })
            );
          } catch(_) {}
        }
      }
    });
  }

  /* Pause / resume / unmute when the host tells us to.
     React Native WebView delivers via window on iOS, document on Android — listen to both. */
  function handleHostMessage(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.cmd === 'pause')  { if (player) player.pauseVideo(); }
      if (msg.cmd === 'play')   { if (player) player.playVideo(); }
      if (msg.cmd === 'unmute') {
        if (player) { player.unMute(); player.setVolume(100); }
        else        { pendingUnmute = true; } /* apply once player is ready */
      }
    } catch(_) {}
  }
  document.addEventListener('message', handleHostMessage);
  window.addEventListener('message',   handleHostMessage);
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

export function TrailerModal({ videoIds, onClose, openerRef }: Props) {
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [webviewLoading, setWebviewLoading] = useState(true);
  const [allFailed, setAllFailed] = useState(false);
  /**
   * When every iframe candidate fails (embedding disabled), we fall back to
   * loading the mobile YouTube page directly in the WebView instead of
   * launching an external app.  This:
   *   1. Plays videos that block embedding — the m.youtube.com site has no
   *      such restriction.
   *   2. Keeps the user inside the IPTV app so BACK closes the modal and
   *      returns to StreamVault, instead of exiting to the Firestick homescreen.
   * null = iframe embed path;  string = direct m.youtube.com URI fallback.
   */
  const [fallbackUri, setFallbackUri] = useState<string | null>(null);
  const [showUnmute, setShowUnmute] = useState(false);
  const unmuteFade = useRef(new Animated.Value(1)).current;
  const unmuteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webviewKey = useRef(0);
  const webviewRef = useRef<WebView>(null);

  // Helper: dismiss the unmute pill and cancel its timer immediately
  const dismissUnmute = () => {
    if (unmuteTimer.current) {
      clearTimeout(unmuteTimer.current);
      unmuteTimer.current = null;
    }
    unmuteFade.stopAnimation();
    unmuteFade.setValue(0);
    setShowUnmute(false);
  };

  // Reset to first candidate whenever a new set arrives
  useEffect(() => {
    setIdx(0);
    setWebviewLoading(true);
    setAllFailed(false);
    setFallbackUri(null);
    dismissUnmute();
    webviewKey.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoIds]);

  // Dismiss the loading spinner once the WebView's HTML has loaded.
  // The unmute pill is shown later, when the page posts 'yt-ready' (player.onReady fired).
  const handleWebViewLoadEnd = () => {
    setWebviewLoading(false);
  };

  // Show the unmute pill for 3 s (called when the page confirms player readiness).
  const showUnmutePill = () => {
    unmuteFade.setValue(1);
    setShowUnmute(true);
    if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
    unmuteTimer.current = setTimeout(() => {
      Animated.timing(unmuteFade, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setShowUnmute(false));
    }, 3000);
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
    };
  }, []);

  // TV: ref to the close button — focused via Modal onShow instead of
  // hasTVPreferredFocus which re-fires requestFocus on every re-render
  // (loading state, webview events, idx changes all trigger re-renders).
  const closeBtnRef = useRef<View>(null);

  // TV: unified close handler — dismisses the modal then returns D-pad focus
  // to whichever button opened it so the cursor doesn't go dead on close.
  const handleClose = React.useCallback(() => {
    onClose();
    if (Platform.isTV && openerRef?.current) {
      setTimeout(() => (openerRef.current as any)?.focus?.(), 150);
    }
  }, [onClose, openerRef]);

  const handleUnmuteTap = () => {
    if (unmuteTimer.current) clearTimeout(unmuteTimer.current);
    webviewRef.current?.postMessage(JSON.stringify({ cmd: 'unmute' }));
    Animated.timing(unmuteFade, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setShowUnmute(false));
  };

  // Pause the YouTube player when the app goes to the background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!webviewRef.current) return;
      const cmd = state === 'active' ? 'play' : 'pause';
      webviewRef.current.postMessage(JSON.stringify({ cmd }));
    });
    return () => sub.remove();
  }, []);

  // Advance to the next candidate.
  // When all iframe embeds are exhausted, fall back to loading the mobile
  // YouTube page (m.youtube.com) directly in the WebView — this plays videos
  // that have embedding disabled AND keeps the user inside the app so BACK
  // returns to StreamVault instead of the Firestick homescreen.
  // Only reach setAllFailed when there is genuinely no YouTube ID at all.
  const advance = () => {
    const ids = Array.isArray(videoIds) ? videoIds : [];
    dismissUnmute();
    if (idx < ids.length - 1) {
      setIdx((i) => i + 1);
      setWebviewLoading(true);
      webviewKey.current += 1;
    } else {
      const firstYtId = ids.find(isVideoId);
      if (firstYtId) {
        // All iframe candidates failed — load the video on m.youtube.com instead.
        // The mobile site has no embedding restriction, plays in the WebView,
        // and keeps BACK working correctly on Firestick.
        setFallbackUri(`https://m.youtube.com/watch?v=${firstYtId}`);
        setWebviewLoading(true);
        webviewKey.current += 1;
      } else {
        // No YouTube ID available at all — show the generic error screen.
        setAllFailed(true);
      }
    }
  };

  const handleMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'yt-ready') showUnmutePill();
      if (data.type === 'yt-error') advance();
    } catch (_) {}
  };

  if (!videoIds) return null;

  const isFetching = videoIds === 'loading';
  const ids = isFetching ? [] : videoIds;
  const current = ids[idx] ?? null;
  const isYt = current ? isVideoId(current) : false;

  const html = current
    ? isYt
      ? buildYtHtml(current)
      : buildGenericHtml(current)
    : '';

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
      onShow={() => {
        // TV: focus the close button on modal open — avoids hasTVPreferredFocus
        // races when loading state, idx, or unmute visibility change mid-session.
        if (Platform.isTV) setTimeout(() => (closeBtnRef.current as any)?.focus?.(), 80);
      }}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.title}>Trailer</Text>
          <FocusablePressable ref={closeBtnRef} style={styles.closeBtn} onPress={handleClose} hitSlop={12}>
            <Text style={styles.closeTxt}>✕</Text>
          </FocusablePressable>
        </View>

        {/* ── Loading / error / player states ── */}
        {isFetching ? (
          <View style={styles.loaderFull}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.loaderText}>Finding trailer…</Text>
          </View>
        ) : fallbackUri ? (
          /* ── Fallback: load m.youtube.com directly in the WebView ──────────
             Reached when YouTube's iframe API rejects all embed candidates
             (error 150/152 — embedding disabled by the uploader).
             Loading the mobile YouTube page instead of launching an external
             app means:
               • BACK closes this modal and returns to StreamVault — not the
                 Firestick homescreen.
               • The video actually plays (no embed restriction on the real site).
               • Touch / D-pad controls work inside the WebView as normal. */
          <>
            {webviewLoading && (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#3B82F6" />
              </View>
            )}
            <WebView
              ref={webviewRef}
              key={webviewKey.current}
              source={{ uri: fallbackUri }}
              style={styles.webview}
              onLoadEnd={handleWebViewLoadEnd}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
              // m.youtube.com sends postMessage events in a different format;
              // we do not attach onMessage so the iframe-API handlers don't fire.
            />
          </>
        ) : allFailed || !current ? (
          /* ── No YouTube ID at all (provider-only trailer with no fallback) ── */
          <View style={styles.loaderFull}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🎬</Text>
            <Text style={styles.loaderText}>No trailer available</Text>
            <Text style={[styles.loaderText, { fontSize: 12, marginTop: 4, opacity: 0.5, textAlign: 'center', paddingHorizontal: 32 }]}>
              No playable trailer was found for this title.
            </Text>
          </View>
        ) : (
          /* ── Primary path: YouTube iframe API embed ── */
          <>
            {webviewLoading && (
              <View style={styles.loaderOverlay}>
                <ActivityIndicator size="large" color="#3B82F6" />
              </View>
            )}
            <WebView
              ref={webviewRef}
              key={webviewKey.current}
              source={{ html, baseUrl: 'https://www.youtube.com' }}
              style={styles.webview}
              onLoadEnd={handleWebViewLoadEnd}
              onMessage={handleMessage}
              allowsFullscreenVideo
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
            />
            {showUnmute && isYt && (
              <Animated.View style={[styles.unmutePill, { opacity: unmuteFade }]} pointerEvents="box-none">
                <FocusablePressable onPress={handleUnmuteTap} style={styles.unmutePressable} focusable={false}>
                  <Text style={styles.unmuteTxt}>🔊  Tap to unmute</Text>
                </FocusablePressable>
              </Animated.View>
            )}
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
  ytBtn: {
    marginTop: 20,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#FF0000',
  },
  ytBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  unmutePill: {
    position: 'absolute',
    bottom: 72,
    alignSelf: 'center',
    zIndex: 20,
  },
  unmutePressable: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  unmuteTxt: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
    letterSpacing: 0.2,
  },
});
