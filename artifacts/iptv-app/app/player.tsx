import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import * as Network from 'expo-network';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLivePlayer } from '@/context/LivePlayerContext';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '@/context/AppContext';
import { StorageService } from '@/services/storage';
import { cancelRemindersForActiveChannel } from '@/services/notifications';
import { getXtreamXmltvUrl, getXtreamCatchupUrls, getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { EpgProgram } from '@/types';
import { Image } from 'expo-image';
import { useCast } from '@/hooks/useCast';
import CastButton from '@/components/CastButton';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const FITS = [
  { value: 'contain' as const, label: 'Fit' },
  { value: 'cover' as const, label: 'Fill' },
  { value: 'fill' as const, label: 'Stretch' },
];

type ChannelEntry = { url: string; title: string; epgId: string; logo?: string; channelId?: string };

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

function fmtTime(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Add `seconds` to a server-local datetime string ("YYYY-MM-DD HH:MM:SS").
 * The string is treated as UTC so JS timezone never distorts the arithmetic.
 */
function addSecondsToServerTime(serverStart: string, seconds: number): string {
  const iso = serverStart.replace(' ', 'T') + 'Z';
  const d = new Date(new Date(iso).getTime() + seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function fmtSecs(secs: number) {
  const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ── Scrubber bar ─────────────────────────────────────────────────────────────
// Uses RNGH GestureDetector (Pan) so it can't be stolen by the
// TouchableWithoutFeedback tap-catcher or any other RN responder.
function VodScrubber({
  currentTime,
  duration,
  insetBottom,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  insetBottom: number;
  onSeek: (t: number) => void;
}) {
  const durationRef    = useRef(duration);
  const onSeekRef      = useRef(onSeek);
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { durationRef.current    = duration;    }, [duration]);
  useEffect(() => { onSeekRef.current      = onSeek;      }, [onSeek]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const trackW    = useRef(1);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubFrac, setScrubFrac] = useState(0);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));

  // .runOnJS(true) keeps all callbacks on the JS thread so we can freely
  // access refs and call setState — no worklet / shared-value needed.
  const pan = useMemo(() => Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      if (durationRef.current <= 0 || !isFinite(durationRef.current)) return;
      setScrubFrac(clamp(e.x / Math.max(trackW.current, 1)));
      setScrubbing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((e) => {
      if (durationRef.current <= 0) return;
      setScrubFrac(clamp(e.x / Math.max(trackW.current, 1)));
    })
    .onEnd((e) => {
      const frac = clamp(e.x / Math.max(trackW.current, 1));
      setScrubbing(false);
      onSeekRef.current(frac * durationRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })
    .onFinalize(() => {
      setScrubbing(false);
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);

  const hasDuration  = duration > 0 && isFinite(duration);
  const displayFrac  = scrubbing ? scrubFrac : (hasDuration ? currentTime / duration : 0);
  const displayTime  = scrubbing ? scrubFrac * duration : currentTime;

  return (
    <View style={[scrubberStyles.wrap, { bottom: insetBottom + 12 }]} pointerEvents="box-none">
      {/* Bubble above thumb while scrubbing */}
      {scrubbing && hasDuration && (
        <View
          style={[scrubberStyles.bubble, { left: `${Math.max(2, Math.min(90, displayFrac * 100))}%` as any }]}
          pointerEvents="none"
        >
          <Text style={scrubberStyles.bubbleText}>{fmtSecs(displayTime)}</Text>
          <View style={scrubberStyles.bubbleTip} />
        </View>
      )}

      {/* Hit area — GestureDetector handles all touch */}
      <GestureDetector gesture={pan}>
        <View
          style={scrubberStyles.hitArea}
          onLayout={(e) => { trackW.current = e.nativeEvent.layout.width; }}
        >
          {/* Visual track */}
          <View style={scrubberStyles.rail} pointerEvents="none">
            <View style={[scrubberStyles.filled, { width: `${displayFrac * 100}%` as any }]} />
          </View>
          {/* Thumb */}
          {hasDuration && (
            <View
              style={[
                scrubberStyles.thumb,
                { left: `${displayFrac * 100}%` as any },
                scrubbing && scrubberStyles.thumbActive,
              ]}
              pointerEvents="none"
            />
          )}
        </View>
      </GestureDetector>

      {/* Times */}
      <View style={scrubberStyles.timeRow} pointerEvents="none">
        <Text style={scrubberStyles.timeLeft}>{fmtSecs(displayTime)}</Text>
        <Text style={scrubberStyles.timeRight}>{hasDuration ? fmtSecs(duration) : 'LIVE'}</Text>
      </View>
    </View>
  );
}

const scrubberStyles = StyleSheet.create({
  // Outer absolutely-positioned container
  wrap: { position: 'absolute', left: 16, right: 16, gap: 4 },

  // Seek-position bubble shown above thumb while dragging
  bubble: {
    position: 'absolute',
    bottom: 64,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    transform: [{ translateX: -36 }],
    minWidth: 72,
  },
  bubbleText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff', textAlign: 'center' },
  bubbleTip: {
    position: 'absolute',
    bottom: -5,
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: 'rgba(0,0,0,0.85)',
  },

  // GestureDetector target — generous vertical touch area
  hitArea: {
    paddingVertical: 18,
    overflow: 'visible',
  },

  // Visual track inside hitArea
  rail: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'visible',
    justifyContent: 'center',
  },
  filled: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },

  // Thumb circle (positioned inside rail, overflow: 'visible' lets it poke out)
  thumb: {
    position: 'absolute',
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#fff',
    top: -6, marginLeft: -8,
    elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  thumbActive: {
    width: 24, height: 24, borderRadius: 12,
    top: -10, marginLeft: -12,
    elevation: 8,
  },

  // Time labels below the track
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  timeLeft:  { fontSize: 12, color: '#fff', fontFamily: 'Inter_600SemiBold' },
  timeRight: { fontSize: 12, color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_500Medium' },
});

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: 'live' | 'vod' | 'series' | 'catchup';
    epgId?: string;
    /** Raw channel ID (may differ from epgId on some providers). Used for reminder matching. */
    channelId?: string;
    channelsJson?: string;
    channelIndex?: string;
    /** Stable content ID used as the history key (movie stream ID or episode stream ID). */
    contentId?: string;
    /** For series episodes: the parent series ID, used by the Continue Watching rail. */
    parentId?: string;
    /** For series episodes: the parent series name, stored in watch history for the Recently Watched list. */
    parentTitle?: string;
    /** Logo/cover used as the history thumbnail. */
    logo?: string;
    /** Seconds to seek to after the player is ready. */
    startAt?: string;
    /** Known programme duration in seconds (catch-up streams don't expose this via the player API). */
    knownDuration?: string;
    /** Catch-up: stream ID used to regenerate the timeshift URL after a seek. */
    catchupStreamId?: string;
    /** Catch-up: server-local start time "YYYY-MM-DD HH:MM:SS" of the original programme. */
    catchupServerStart?: string;
    /** Catch-up: unix-seconds start timestamp of the original programme. */
    catchupStartTimestamp?: string;
    /** When 'true', backing out of live TV stops the stream instead of collapsing to mini-player. */
    stopOnBack?: string;
    /** groupTitle of the channel — used when launched from the Home screen so
     *  pressing Back lands on the correct Live TV category instead of going
     *  back to Home. */
    groupTitle?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isLive = params.type === 'live';
  const isCatchup = params.type === 'catchup';
  const startAtSecs = params.startAt ? parseFloat(params.startAt) : 0;
  const knownDurationSecs = params.knownDuration ? parseFloat(params.knownDuration) : 0;
  // Catch-up seek regeneration fields (undefined for non-catch-up streams)
  const catchupStreamId = params.catchupStreamId ?? '';
  const catchupServerStart = params.catchupServerStart ?? '';
  const catchupStartTimestamp = params.catchupStartTimestamp ? parseInt(params.catchupStartTimestamp, 10) : 0;

  // Tracks the URL currently loaded in the player so the cast hook can
  // reload the correct stream when the user switches channels.
  const [activeUrl, setActiveUrl] = useState(params.url);

  const { credentials, setLastWatchedUrl } = useAppContext();
  const isXtream = credentials?.type === 'xtream';
  const xmltvUrl = isXtream ? getXtreamXmltvUrl(buildCreds(credentials)) : null;

  // ── Channel list for prev/next navigation ────────────────────────────────
  const channelList = useMemo<ChannelEntry[]>(() => {
    try { return JSON.parse(params.channelsJson ?? '[]'); } catch { return []; }
  }, [params.channelsJson]);

  const [channelIdx, setChannelIdx] = useState(() => parseInt(params.channelIndex ?? '-1'));

  // Active channel state — updates when navigating prev/next
  const [activeTitle, setActiveTitle] = useState(params.title);
  const [activeLogo, setActiveLogo] = useState<string>(params.logo as string ?? '');
  const [activeEpgId, setActiveEpgId] = useState(params.epgId ?? '');

  const prevChannel = channelList.length > 0 && channelIdx > 0 ? channelList[channelIdx - 1] : null;
  const nextChannel = channelList.length > 0 && channelIdx < channelList.length - 1 ? channelList[channelIdx + 1] : null;

  // ── Cast (AirPlay on iOS / Chromecast on Android) ─────────────────────────
  const {
    isConnected: isCasting,
    deviceName:  castDeviceName,
    playRemote,
    pauseRemote,
    seekRemote,
  } = useCast(activeUrl, activeTitle, isLive);

  // ── Player state ─────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isBuffering, setIsBuffering] = useState(true);

  // ── Auto-reconnect state (live streams only) ──────────────────────────────
  const MAX_RECONNECTS = 5;
  const RECONNECT_DELAY_MS = 3000;
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false); // #137: silent URL re-resolve in progress
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  // #69: which catchup URL format is currently being tried (0 = Format B, 1 = Format A fallback)
  const catchupFormatRef = useRef(0);
  // Keep refs in sync so the statusChange closure always reads the latest values
  useEffect(() => { reconnectAttemptRef.current = reconnectAttempt; }, [reconnectAttempt]);
  // Source-of-truth URL ref — always points to the currently loaded stream URL
  const activeUrlRef = useRef(params.url);
  const { width: screenWidth } = useWindowDimensions();
  const [currentTime, setCurrentTime] = useState(0);
  // Seed with the known programme duration so catch-up scrubber works immediately
  // even when the timeshift stream doesn't expose its duration to expo-video.
  const [duration, setDuration] = useState(knownDurationSecs > 0 ? knownDurationSecs : 0);
  const [showControls, setShowControls] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  // Ref so BackHandler closure can read showInfo without going stale
  const showInfoRef = useRef(true);
  useEffect(() => { showInfoRef.current = showInfo; }, [showInfo]);
  // Ref so BackHandler closure can read showControls without going stale
  const showControlsRef = useRef(false);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  // Ref to block spurious onFocus channel-switch on initial TV mount
  const tvNavReadyRef = useRef(false);
  const tvCenterRef = useRef<View>(null);
  // TV VOD focus management refs
  const tvVodIdleRef   = useRef<View>(null); // catch-all when controls are hidden
  const tvPlayBtnRef   = useRef<View>(null); // play/pause button (focused when controls appear)
  const tvScrubAnchorRef = useRef<View>(null); // focusable scrubber progress bar
  const tvSeekBackRef  = useRef<View>(null); // hidden D-pad-left  bounce target → seek −10 s
  const tvSeekFwdRef   = useRef<View>(null); // hidden D-pad-right bounce target → seek +10 s
  const tvSeek30BackRef = useRef<View>(null); // visible −30 s button — wired nextFocusDown→scrubber
  const tvSeek30FwdRef  = useRef<View>(null); // visible +30 s button — wired nextFocusDown→scrubber

  // ── TV channel-switch preview overlay ────────────────────────────────────
  // Shown for ~1 s when the user presses D-pad left/right so they can see
  // which channel is coming before the stream actually switches.
  const [tvPreviewChannel, setTvPreviewChannel] = useState<ChannelEntry | null>(null);
  const [tvPreviewDir, setTvPreviewDir] = useState<'prev' | 'next' | null>(null);
  const tvPreviewOpacity = useRef(new Animated.Value(0)).current;
  const tvPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  /** 'back' | 'forward' | null — brief double-tap seek visual indicator */
  const [doubleTapSide, setDoubleTapSide] = useState<'back' | 'forward' | null>(null);
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Settings state ────────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showSubPicker, setShowSubPicker] = useState(false);
  // Refs to the chip buttons that open each picker — used to restore D-pad
  // focus after the picker modal closes on Firestick/Android TV.
  const audioChipRef = useRef<any>(null);
  const ccChipRef    = useRef<any>(null);
  const settingsChipRef = useRef<any>(null);
  // TV: refs for elements that get imperative focus instead of hasTVPreferredFocus
  // (hasTVPreferredFocus re-fires requestFocus on every re-render on Fire OS).
  const retryBtnRef       = useRef<any>(null);   // error-state retry button
  const firstAudioChipRef = useRef<any>(null);   // first audio-track chip in picker
  const firstSubChipRef   = useRef<any>(null);   // "Off" subtitle chip in picker
  const firstSpeedChipRef = useRef<any>(null);   // first speed chip in settings tray
  const [speed, setSpeed] = useState(1);
  const [contentFit, setContentFit] = useState<'contain' | 'cover' | 'fill'>('contain');

  // ── Track state (populated once the stream is ready) ─────────────────────
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<AudioTrack | null>(null);
  const [activeSubtitleTrack, setActiveSubtitleTrack] = useState<SubtitleTrack | null>(null);
  // Mirrors the persisted preferred audio language so the Auto chip can show it
  const [prefAudioLang, setPrefAudioLang] = useState<string | null>(null);
  // Mirrors the persisted preferred subtitle language (#43)
  const [prefSubtitleLang, setPrefSubtitleLang] = useState<string | null>(null);

  // Load the saved audio + subtitle language preferences on mount so the chip
  // labels are correct as soon as the settings tray is opened.
  // Also restore the last-used playback speed.
  useEffect(() => {
    StorageService.getPrefAudioLanguage().then(setPrefAudioLang).catch(() => {});
    StorageService.getPrefSubtitleLang().then(setPrefSubtitleLang).catch(() => {}); // #43
    import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
      AS.getItem('@pref_playback_speed').then((v) => {
        const n = v ? parseFloat(v) : NaN;
        if (!isNaN(n) && n > 0) setSpeed(n);
      })
    ).catch(() => {});
  }, []);

  // ── AppState — background suppression (#31) + foreground retry (#30) ─────
  // isBackgroundRef: true whenever the app is not in the foreground.
  // This prevents error UI from appearing during brief background stalls.
  const isBackgroundRef = useRef(false);
  // hasErrorRef: mirrors hasError so the AppState handler can read it
  // synchronously without stale closure issues.
  const hasErrorRef = useRef(false);
  // didAutoBackRef: prevents the VOD auto-back from firing more than once
  const didAutoBackRef = useRef(false);
  useEffect(() => {
    if (isWeb) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const wasBackground = isBackgroundRef.current;
      isBackgroundRef.current = state !== 'active';

      if (wasBackground && state === 'active') {
        // #31: App came back to foreground — re-evaluate player state.
        // If an error was suppressed while backgrounded, show it now only if
        // the player is genuinely still broken (hasError was set).
        // #30: For live streams, if the error screen is showing (or retries
        // were exhausted while backgrounded), reset and attempt playback again.
        if (isLive) {
          if (hasErrorRef.current || reconnectAttemptRef.current >= MAX_RECONNECTS) {
            setReconnectAttempt(0);
            reconnectAttemptRef.current = 0;
            setHasError(false);
            hasErrorRef.current = false;
            setIsReconnecting(true);
            setIsBuffering(true);
            try { player.replace(activeUrlRef.current); player.play(); } catch {}
          }
        } else if (hasErrorRef.current) {
          // #31: VOD/series — if an error was suppressed while backgrounded,
          // retry playback on foreground return instead of showing the error screen.
          setHasError(false);
          hasErrorRef.current = false;
          setIsBuffering(true);
          try { player.replace(activeUrlRef.current); player.play(); } catch {}
        }
      }
    });
    return () => sub.remove();
  }, [isLive, isWeb]); // eslint-disable-line react-hooks/exhaustive-deps — player declared after these effects; closure always has the current instance

  // Keep hasErrorRef in sync with hasError state
  useEffect(() => { hasErrorRef.current = hasError; }, [hasError]);

  // #30: Network-reconnect polling for live streams.
  // While the error screen is showing, poll expo-network every 3 s.
  // When the device goes from offline → online, immediately retry playback.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (!isLive || isWeb) return;
    // Only run the network poll while in an error/reconnecting state.
    if (!hasError && !isReconnecting) return;

    const poll = setInterval(async () => {
      try {
        const state = await Network.getNetworkStateAsync();
        const isOnline = state.isConnected === true && state.isInternetReachable !== false;
        if (!isOnline) {
          wasOfflineRef.current = true;
        } else if (wasOfflineRef.current) {
          // Network came back — attempt immediate reconnect
          wasOfflineRef.current = false;
          setReconnectAttempt(0);
          reconnectAttemptRef.current = 0;
          setHasError(false);
          hasErrorRef.current = false;
          setIsReconnecting(true);
          setIsBuffering(true);
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          try { player.replace(activeUrlRef.current); player.play(); } catch {}
        }
      } catch {
        // expo-network unavailable — ignore
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [isLive, isWeb, hasError, isReconnecting]); // eslint-disable-line react-hooks/exhaustive-deps — player declared after these effects; closure always has the current instance

  // #131: Always-current credentials ref so the async re-resolve closure reads
  // the latest value even though the statusChange listener is set up once.
  const credentialsRef = useRef(credentials);
  useEffect(() => { credentialsRef.current = credentials; }, [credentials]);

  // #131: Tracks whether we've already attempted a stale-URL re-resolution for
  // the current stream session.  Reset whenever the player loads a new URL so a
  // fresh resolve attempt is allowed after a channel switch.
  const didResolveStaleUrlRef = useRef(false);

  // #131: Always-current channel ID so the re-resolve closure looks up the
  // right channel after a prev/next switch (params.channelId is fixed from
  // the route and becomes stale after in-player navigation).
  const activeChannelIdRef = useRef(params.channelId ?? '');

  // #131: Monotonically-incrementing session token.  Incremented on every
  // channel switch and on readyToPlay so that any in-flight re-resolve
  // async closure can detect it has been superseded and bail out safely,
  // preventing a stale fetch from overwriting the new channel's playback.
  const resolveSessionRef = useRef(0);

  // #30: While the error screen is showing for a live stream, retry every 10 s
  // so the stream auto-recovers when the network returns while already foregrounded
  // (the AppState handler covers the foreground-transition case; this covers the
  // "network came back silently while the app was already open" case).
  useEffect(() => {
    if (!isLive || !hasError || isWeb) return;
    const t = setInterval(() => {
      setHasError(false);
      setIsBuffering(true);
      setIsReconnecting(true);
      setReconnectAttempt(0);
      reconnectAttemptRef.current = 0;
      try { player.replace(activeUrlRef.current); player.play(); } catch {}
    }, 10_000);
    return () => clearInterval(t);
  }, [isLive, hasError, isWeb]); // eslint-disable-line react-hooks/exhaustive-deps — player declared after these effects; closure always has the current instance

  // Refs so interval / unmount callbacks can read latest values without stale closures
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const didInitialSeekRef = useRef(false);
  // Stores the programme offset (seconds) that the catch-up wall-clock timer should
  // count from.  Updated on every seek so the timer survives isPlaying re-runs.
  const catchupSeekOffsetRef = useRef(0);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const infoOpacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── EPG ──────────────────────────────────────────────────────────────────
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
    enabled: !!xmltvUrl && isLive,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  const { currentProg, nextProg } = React.useMemo(() => {
    if (!epgMap || !activeEpgId) return { currentProg: null, nextProg: null };
    const progs = epgMap.get(activeEpgId) ?? [];
    const curIdx = progs.findIndex((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime());
    const cur = curIdx >= 0 ? progs[curIdx] : null;
    const nxt = curIdx >= 0 ? (progs[curIdx + 1] ?? null) : null;
    return { currentProg: cur, nextProg: nxt };
  }, [epgMap, activeEpgId, nowTs]);

  // ── Video player ─────────────────────────────────────────────────────────
  // For VOD/series: a local player created here (null source when live so it
  // doesn't waste resources).
  const localPlayer = useVideoPlayer(isLive || isWeb ? null : params.url, (p) => {
    p.loop = false;
    // Disable scrubbing mode for catch-up — timeshift streams don't support
    // seek via currentTime; we use a wall-clock timer instead.
    p.scrubbingModeOptions = { isEnabled: !isCatchup };
    if (!isWeb) p.play();
  });

  // For live TV: the shared player from context (already streaming from the
  // mini-player — reusing it means zero buffering gap on fullscreen entry).
  const { player: sharedPlayer, activeUrlRef: liveUrlRef, triggerCollapse, notifyPlayerReady } = useLivePlayer();

  // Controls whether the fullscreen VideoView is mounted.  We unmount it
  // before calling triggerCollapse so that the overlay VideoView in
  // LivePlayerContext becomes the sole renderer — having two VideoViews share
  // the same player simultaneously causes one of them to go black on Android.
  const [videoMounted, setVideoMounted] = useState(true);

  // The player this screen actually uses:
  const player = isLive ? sharedPlayer : localPlayer;

  // Ensure the correct URL is loaded in the shared player when opening fullscreen.
  // If liveUrlRef matches params.url the stream is already running — don't restart.
  useEffect(() => {
    if (!isLive || isWeb) return;
    if (liveUrlRef.current === params.url) {
      // #138: always allow a fresh stale-URL re-resolve attempt when entering
      // fullscreen, even if the URL matches (stream may already be failing).
      didResolveStaleUrlRef.current = false;
      try { if (!player.playing) player.play(); } catch {}
    } else {
      liveUrlRef.current = params.url;
      try { player.replace(params.url); player.play(); } catch {}
    }
    // Cancel any reminder whose programme is currently airing on this channel —
    // the user is already watching, so the notification would be redundant.
    // Pass both channelId and epgId: they can differ on some providers.
    cancelRemindersForActiveChannel({ channelId: params.channelId, epgId: params.epgId });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isWeb || !player) return;
    const subs = [
      player.addListener('playingChange', ({ isPlaying: playing }) => setIsPlaying(playing)),
      player.addListener('statusChange', ({ status, error }: { status: string; error?: unknown }) => {
        if (status === 'readyToPlay') {
          // Clear any pending reconnect when the stream comes back up
          if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
          setIsReconnecting(false);
          setIsResolvingUrl(false); // #137
          setReconnectAttempt(0);
          setIsBuffering(false);
          // #131: stream is healthy — allow a fresh re-resolve attempt if it
          // later errors again (e.g. provider rotates stream IDs mid-session).
          // Bump the session token so any in-flight re-resolve for the
          // previous error attempt is silently discarded.
          didResolveStaleUrlRef.current = false;
          resolveSessionRef.current += 1;
          // Seek to saved position (only once, on first ready)
          if (!didInitialSeekRef.current && startAtSecs > 0) {
            didInitialSeekRef.current = true;
            try { player.currentTime = startAtSecs; } catch {}
          }
          // Probe available audio/subtitle tracks — run immediately and again
          // after 2 s because some HLS streams populate track lists with a delay.
          const probeAudioTracks = () => {
            try {
              const tracks = player.availableAudioTracks ?? [];
              const subTracks = player.availableSubtitleTracks ?? [];
              setAudioTracks(tracks);
              setSubtitleTracks(subTracks);
              setActiveAudioTrack(player.audioTrack ?? null);
              setActiveSubtitleTrack(player.subtitleTrack ?? null);
              // Auto-apply saved audio language preference
              StorageService.getPrefAudioLanguage().then((prefLang) => {
                setPrefAudioLang(prefLang);
                if (!prefLang || tracks.length <= 1) return;
                const match = tracks.find((t) => t.language === prefLang);
                if (match) { try { player.audioTrack = match; setActiveAudioTrack(match); } catch {} }
              }).catch(() => {});
              // Auto-apply saved subtitle language preference (#43)
              StorageService.getPrefSubtitleLang().then((prefLang) => {
                setPrefSubtitleLang(prefLang);
                if (!prefLang || subTracks.length === 0) return;
                const match = subTracks.find((t) => t.language === prefLang);
                if (match) { try { player.subtitleTrack = match; setActiveSubtitleTrack(match); } catch {} }
              }).catch(() => {});
            } catch {}
          };
          probeAudioTracks();
          setTimeout(probeAudioTracks, 2000);
          // VOD/series streams often expose tracks later than live HLS;
          // do an extra probe at 5 s to catch late-populated track lists.
          if (!isLive) setTimeout(probeAudioTracks, 5000);
        }
        if (status === 'error' || error) {
          const msg = (error as any)?.message ?? (error as any)?.localizedDescription ?? String(error ?? '');
          setErrorMsg(msg);

          // #69: Catchup format fallback — Format B (index 0) failed, try Format A (index 1)
          if (isCatchup && catchupFormatRef.current === 0 && catchupStreamId && catchupServerStart && catchupStartTimestamp > 0 && credentials?.type === 'xtream') {
            catchupFormatRef.current = 1;
            const seekSecs = Math.floor(catchupSeekOffsetRef.current);
            const remainingSecs = Math.max(60, knownDurationSecs - seekSecs);
            const newDurationMins = Math.ceil(remainingSecs / 60);
            const newStartTs = catchupStartTimestamp + seekSecs;
            const newServerStart = addSecondsToServerTime(catchupServerStart, seekSecs);
            const creds69 = { host: credentials.host!, username: credentials.username!, password: credentials.password! };
            const urls = getXtreamCatchupUrls(creds69, catchupStreamId, newServerStart, newDurationMins, newStartTs);
            setIsBuffering(true);
            setHasError(false);
            try { player.replace(urls[1]); player.play(); } catch {}
            return;
          }

          // Auto-reconnect only for live streams
          if (isLive) {
            // #131: Before burning reconnect attempts, try re-resolving the stream
            // URL from the current channel list.  A 404/403 from a stale URL is
            // indistinguishable from a true network error at this layer, so we
            // always attempt one re-resolve on the first failure for any live
            // stream that carries a channelId (reminder-launched or channel-list
            // launched).  This catches rotated stream IDs that the focus-refresh
            // path missed when the cache was cold.
            if (activeChannelIdRef.current && !didResolveStaleUrlRef.current) {
              didResolveStaleUrlRef.current = true;
              setIsResolvingUrl(true); // #137: show "Refreshing stream…" during silent re-resolve
              setIsReconnecting(true);
              setIsBuffering(true);
              // Capture ref values synchronously before yielding to async so
              // we can detect a superseded session once the fetch completes.
              const resolveChannelId = activeChannelIdRef.current;
              const resolveSession = resolveSessionRef.current;
              (async () => {
                try {
                  const creds = credentialsRef.current;
                  let freshUrl: string | undefined;
                  if (creds?.type === 'xtream' && creds.host && creds.username && creds.password) {
                    const streams = await getXtreamLiveStreams({
                      host: creds.host,
                      username: creds.username,
                      password: creds.password,
                    });
                    freshUrl = streams.find((ch) => ch.id === resolveChannelId)?.streamUrl;
                  } else if (creds?.m3uUrl) {
                    const parsed = await fetchAndParseM3U(creds.m3uUrl);
                    freshUrl = parsed.channels.find((ch) => ch.id === resolveChannelId)?.streamUrl;
                  }
                  // Bail out if the user has switched channels or the stream
                  // recovered on its own while the fetch was in flight.
                  if (resolveSession !== resolveSessionRef.current) return;
                  if (freshUrl && freshUrl !== activeUrlRef.current) {
                    // Got a genuinely different URL — retry silently
                    activeUrlRef.current = freshUrl;
                    setActiveUrl(freshUrl);
                    setHasError(false);
                    setIsBuffering(true);
                    setIsResolvingUrl(false); // #137: hint clears as we hand off to player
                    setReconnectAttempt(0);
                    reconnectAttemptRef.current = 0;
                    try { player.replace(freshUrl); player.play(); } catch {}
                    return; // wait for next statusChange
                  }
                } catch {
                  // Re-resolution request failed — fall through to normal reconnect
                }
                // Bail if superseded (channel switch / recovery happened while fetching)
                if (resolveSession !== resolveSessionRef.current) return;
                setIsResolvingUrl(false); // #137: re-resolve done; switching to normal reconnect
                // Fresh URL unavailable or same as current — use normal reconnect
                const attempt = reconnectAttemptRef.current + 1;
                if (attempt <= MAX_RECONNECTS) {
                  setReconnectAttempt(attempt);
                  reconnectAttemptRef.current = attempt;
                  setIsReconnecting(true);
                  setIsBuffering(true);
                  if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
                  reconnectTimerRef.current = setTimeout(() => {
                    try { player.replace(activeUrlRef.current); player.play(); } catch {}
                  }, RECONNECT_DELAY_MS);
                } else {
                  setIsReconnecting(false);
                  if (!isBackgroundRef.current) setHasError(true);
                }
              })();
              return;
            }

            const attempt = reconnectAttemptRef.current + 1;
            if (attempt <= MAX_RECONNECTS) {
              setReconnectAttempt(attempt);
              setIsReconnecting(true);
              setIsBuffering(true);
              // Clear any previously-pending retry before scheduling a new one
              if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
              reconnectTimerRef.current = setTimeout(() => {
                try {
                  // Use the ref — always holds the correct URL even after channel switches
                  player.replace(activeUrlRef.current);
                  player.play();
                } catch {}
              }, RECONNECT_DELAY_MS);
            } else {
              // All retries exhausted — only show error screen if in foreground (#31)
              setIsReconnecting(false);
              if (!isBackgroundRef.current) setHasError(true);
              // If backgrounded: AppState listener resets and retries on next foreground
            }
          } else {
            // VOD: only surface the error if the user can see it (#31)
            if (!isBackgroundRef.current) setHasError(true);
          }
        }
      }),
      player.addListener('timeUpdate', ({ currentTime: t }: { currentTime: number }) => {
        // Catch-up: wall-clock timer owns currentTime — ignore player events
        if (isCatchup) return;
        setCurrentTime(t);
        const d = player.duration;
        if (d && isFinite(d) && d > 0) setDuration(d);
        else if (knownDurationSecs > 0) setDuration(knownDurationSecs);
      }),
    ];
    // Poll duration + currentTime for regular VOD/live streams.
    // Catch-up uses its own wall-clock timer instead.
    const durationPoll = isCatchup ? null : setInterval(() => {
      const d = player.duration;
      if (d && isFinite(d) && d > 0) setDuration(d);
      else if (knownDurationSecs > 0) setDuration(knownDurationSecs);
      const t = player.currentTime;
      if (typeof t === 'number' && t > 0) setCurrentTime(t);
      // VOD auto-back: navigate when content finishes (within last 2 s of duration)
      if (!isLive && d && isFinite(d) && d > 0 && typeof t === 'number' && d - t < 2 && !didAutoBackRef.current) {
        didAutoBackRef.current = true;
        handleBack();
      }
    }, 500);
    return () => {
      subs.forEach((s) => s.remove());
      if (durationPoll) clearInterval(durationPoll);
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    };
  }, [player, isWeb]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wall-clock timer for catch-up scrubber ────────────────────────────────
  // Timeshift HLS streams don't expose currentTime or duration to expo-video.
  // We seed duration from knownDurationSecs and advance currentTime via a
  // 1-second interval that starts once the stream is playing.
  //
  // catchupSeekOffsetRef persists the seek position across effect re-runs
  // (which happen when isPlaying changes during buffering after a seek).
  const catchupWallStartRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    if (!isCatchup || knownDurationSecs <= 0) return;
    // Always show the known duration immediately
    setDuration(knownDurationSecs);
    // Resume from the last seek offset (0 on first load)
    setCurrentTime(catchupSeekOffsetRef.current);
    catchupWallStartRef.current = null;

    const tick = setInterval(() => {
      if (!isPlayingRef.current) {
        // #70: Park the clock during buffering pauses so elapsed doesn't
        // accumulate while the player is stalled, preventing a forward jump
        // when playback resumes.  On the next tick where playing is true the
        // clock is re-anchored from the last-displayed scrubber position.
        catchupWallStartRef.current = null;
        return;
      }
      if (catchupWallStartRef.current === null) {
        // Anchor from the current scrubber position — handles both the initial
        // start (currentTimeRef = 0 or seek offset) and resume-after-buffer.
        catchupWallStartRef.current = Date.now() - currentTimeRef.current * 1000;
      }
      const elapsed = (Date.now() - catchupWallStartRef.current) / 1000;
      const capped = Math.min(elapsed, knownDurationSecs);
      setCurrentTime(capped);
    }, 1000);

    return () => clearInterval(tick);
  }, [isCatchup, knownDurationSecs]); // isPlaying intentionally excluded — see isPlayingRef

  // ── History save (every 10 s for VOD/series) ─────────────────────────────
  useEffect(() => {
    if (isLive || isWeb || !params.contentId) return;
    const interval = setInterval(async () => {
      const pos = currentTimeRef.current;
      const dur = durationRef.current;
      if (pos < 5 || dur <= 0) return;
      if (pos / dur >= 0.95) {
        await StorageService.removeFromHistory(params.contentId!);
      } else {
        await StorageService.addToHistory({
          id: params.contentId!,
          parentId: params.parentId,
          parentTitle: params.parentTitle,
          title: params.title,
          cover: params.logo,
          type: params.type === 'series' ? 'series' : 'movie',
          position: pos,
          duration: dur,
          timestamp: Date.now(),
        });
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [isLive, isWeb, params.contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Channel navigation ───────────────────────────────────────────────────
  // Track last-watched URL globally so the channel list can restore it on back
  useEffect(() => {
    setLastWatchedUrl(params.url);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchChannel = useCallback((entry: ChannelEntry, newIdx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setChannelIdx(newIdx);
    setActiveTitle(entry.title);
    setActiveLogo(entry.logo ?? '');
    setActiveEpgId(entry.epgId);
    setActiveUrl(entry.url);   // keeps cast hook in sync with the new stream
    // Notify the Live TV tab so its mini-player title/logo stay in sync
    { const { DeviceEventEmitter } = require('react-native'); DeviceEventEmitter.emit('channel:switched', { url: entry.url, logo: entry.logo ?? '', title: entry.title }); }
    activeUrlRef.current = entry.url; // keep ref in sync so reconnect targets the right channel
    setIsBuffering(true);
    setHasError(false);
    setErrorMsg('');
    // Dismiss the live controls bar on channel switch — the new stream starts
    // clean and focus returns to the centre zone via the channelIdx useEffect.
    setShowControls(false);
    controlsOpacity.setValue(0);
    // Reset auto-reconnect counter on manual channel switch
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    setReconnectAttempt(0);
    reconnectAttemptRef.current = 0;  // reset ref immediately so stale closures see 0
    setIsReconnecting(false);
    setIsResolvingUrl(false); // #137
    // #131: allow a fresh re-resolve attempt on the new channel; bump the
    // session token so any in-flight re-resolve for the previous channel
    // is discarded when it eventually completes.
    didResolveStaleUrlRef.current = false;
    activeChannelIdRef.current = entry.channelId ?? '';
    resolveSessionRef.current += 1;
    setLastWatchedUrl(entry.url);
    // Cancel any currently-airing reminder for the channel we're switching to.
    cancelRemindersForActiveChannel({ channelId: entry.channelId, epgId: entry.epgId });
    // Reset track lists — new stream will re-populate them on readyToPlay
    setAudioTracks([]);
    setSubtitleTracks([]);
    setActiveAudioTrack(null);
    setActiveSubtitleTrack(null);
    try {
      if (isLive) liveUrlRef.current = entry.url; // keep shared ref in sync
      player.replace(entry.url);
      player.play();
      // TV: relocate focus to the center zone at 150 ms so the remote cursor
      // is never stranded during the brief gap before the useEffect([channelIdx])
      // fires at 600 ms.  Critical at channel boundaries where the adjacent
      // left/right focus zone becomes non-focusable immediately after the switch
      // (e.g. switching to channel 0 makes the left zone non-focusable).
      if (Platform.isTV && isLive) {
        setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 150);
      }
    } catch {}
  }, [isLive, liveUrlRef, player, setLastWatchedUrl]);

  const navCooldownRef = useRef(false);
  const handlePrevChannel = useCallback(() => {
    if (!prevChannel || navCooldownRef.current) return;
    navCooldownRef.current = true;
    setTimeout(() => { navCooldownRef.current = false; }, 1200);
    switchChannel(prevChannel, channelIdx - 1);
  }, [prevChannel, channelIdx, switchChannel]);

  const handleNextChannel = useCallback(() => {
    if (!nextChannel || navCooldownRef.current) return;
    navCooldownRef.current = true;
    setTimeout(() => { navCooldownRef.current = false; }, 1200);
    switchChannel(nextChannel, channelIdx + 1);
  }, [nextChannel, channelIdx, switchChannel]);

  // ── Animated collapse back (live TV only) ────────────────────────────────
  // Plays the reverse mini-player animation before navigating back so the
  // user sees the fullscreen view shrink back down to the preview box.
  const handleBackLive = useCallback(() => {
    // When launched from recently-watched with stopOnBack=true, just pause and
    // go back — no mini-player collapse animation.  The Live TV tab's
    // useFocusEffect will clear the playing channel so audio stops completely.
    if (params.stopOnBack === 'true') {
      try { sharedPlayer?.pause(); } catch {}
      setVideoMounted(false);
      router.back();
      return;
    }
    // Immediately zero-out the controls and info bar via setValue so their
    // native opacity updates in the same frame — before the collapse overlay
    // snaps to full screen.  This makes the handoff seamless: the overlay
    // covers a plain-video surface rather than a surface still showing UI.
    controlsOpacity.setValue(0);
    infoOpacity.setValue(0);
    setShowControls(false);
    setShowInfo(false);
    // Unmount our VideoView BEFORE the overlay mounts.  expo-video only
    // renders cleanly to one VideoView at a time; if both are mounted
    // simultaneously one of them goes black.  By the time triggerCollapse's
    // measureInWindow + rAF chain runs and setOverlayVisible(true) fires,
    // this state update will already have committed to the native layer.
    setVideoMounted(false);
    // If launched from the Home screen (groupTitle present, no channelsJson),
    // collapse to the mini-player in the Live TV tab, pre-selecting the
    // channel's category so the user lands in the right place.
    if (params.groupTitle && !params.channelsJson) {
      import('@react-native-async-storage/async-storage').then(({ default: AS }) => {
        AS.setItem('@pref_live_cat', params.groupTitle!).catch(() => {});
      });
      // Tell the Live TV tab to show this channel in the mini-player BEFORE
      // triggerCollapse runs.  The mini-player has display:none when
      // playingChannel is null, so measureInWindow returns zeros and the
      // collapse animation is skipped entirely.  Emitting first makes the
      // mini-player visible and sized so triggerCollapse can hit it.
      const { DeviceEventEmitter: DEE } = require('react-native');
      DEE.emit('live:setPlayingChannel', {
        id: params.channelId ?? '',
        name: params.title ?? '',
        logo: params.logo ?? '',
        streamUrl: params.url ?? '',
        epgId: params.epgId ?? params.channelId ?? '',
        groupTitle: params.groupTitle ?? '',
      });
      // Two rAFs: first lets React commit the setPlayingChannel state update;
      // second lets the native layout pass update the mini-player's rect so
      // triggerCollapse's measureInWindow gets real pixel dimensions.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          triggerCollapse(() => router.navigate('/'));
        });
      });
      return;
    }
    triggerCollapse(() => router.back());
  }, [params.stopOnBack, params.groupTitle, params.channelsJson, sharedPlayer, triggerCollapse, router, controlsOpacity, infoOpacity]);

  /** Immediately hide the info bar — used by the Back-press dismiss flow. */
  const dismissInfoBar = useCallback(() => {
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
    Animated.timing(infoOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => setShowInfo(false), 320);
  }, [infoOpacity]);

  // ── Show / hide the live controls bar (Audio + CC chips) via D-pad ────────
  // On Fire TV / Android TV the controls bar is the only way to reach the
  // Audio and CC buttons during live playback.  These two helpers mirror the
  // VOD showVodControls / fade-out pattern so the behaviour is consistent.
  const showLiveControls = useCallback(() => {
    setShowControls(true);
    controlsOpacity.setValue(0);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (Platform.isTV) {
      // Give the overlay one frame to mount before requesting focus.
      setTimeout(() => (audioChipRef.current as any)?.focus?.(), 80);
    }
  }, [controlsOpacity]);

  const hideLiveControls = useCallback(() => {
    Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => {
      setShowControls(false);
      // Return D-pad focus to the centre zone so OK works again immediately.
      if (Platform.isTV) {
        setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 50);
      }
    }, 320);
  }, [controlsOpacity]);

  // ── Android hardware back button (live TV only) ───────────────────────────
  // Press 1: dismiss the controls bar if visible (Fire TV).
  // Press 2: dismiss the info bar if visible.
  // Press 3: collapse back to mini-player.
  useEffect(() => {
    if (!isLive || isWeb || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showControlsRef.current) {
        hideLiveControls();
        return true; // consumed — do not navigate back
      }
      if (showInfoRef.current) {
        dismissInfoBar();
        return true; // consumed — do not navigate back
      }
      handleBackLive();
      return true;
    });
    return () => sub.remove();
  }, [isLive, isWeb, handleBackLive, dismissInfoBar, hideLiveControls]);

  // ── Wire TV scrubber D-pad left/right via focus-bounce targets ───────────
  // The scrubber anchor uses nextFocusLeft / nextFocusRight (node handles)
  // so D-pad left/right routes to invisible seek-back / seek-forward targets.
  // Those targets seek ±10 s onFocus, then immediately return focus to the
  // anchor — the same technique used for live-TV channel switching.
  useEffect(() => {
    if (!Platform.isTV || isLive || isWeb) return;
    // Defer until after the controls overlay has mounted and laid out.
    const t = setTimeout(() => {
      const { findNodeHandle } = require('react-native');
      const backH  = tvSeekBackRef.current    ? findNodeHandle(tvSeekBackRef.current)    : null;
      const fwdH   = tvSeekFwdRef.current     ? findNodeHandle(tvSeekFwdRef.current)     : null;
      const scrubH = tvScrubAnchorRef.current ? findNodeHandle(tvScrubAnchorRef.current) : null;
      const playH  = tvPlayBtnRef.current     ? findNodeHandle(tvPlayBtnRef.current)     : null;

      // Scrubber anchor: LEFT/RIGHT → invisible seek-bounce targets (±10 s per tap).
      // UP → play button (explicit so D-pad finds it reliably across absolute layers).
      if (tvScrubAnchorRef.current && backH != null && fwdH != null) {
        (tvScrubAnchorRef.current as any).setNativeProps({
          nextFocusLeft:  backH,
          nextFocusRight: fwdH,
          nextFocusUp:    playH,
        });
      }

      // Play button DOWN → scrubber; seek buttons DOWN → scrubber.
      // Without explicit wiring the TV spatial engine can miss the target
      // when all these elements are absolute-positioned on the same layer.
      if (tvPlayBtnRef.current   && scrubH != null) (tvPlayBtnRef.current   as any).setNativeProps({ nextFocusDown: scrubH });
      if (tvSeek30BackRef.current && scrubH != null) (tvSeek30BackRef.current as any).setNativeProps({ nextFocusDown: scrubH });
      if (tvSeek30FwdRef.current  && scrubH != null) (tvSeek30FwdRef.current  as any).setNativeProps({ nextFocusDown: scrubH });
    }, 300);
    return () => clearTimeout(t);
  // Re-wire whenever controls become visible (overlay mounts its children).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, isWeb, showControls]);

  // TV: when the error screen appears, move D-pad focus to the Retry button.
  // Uses imperative focus rather than hasTVPreferredFocus to avoid Fire OS races.
  useEffect(() => {
    if (!Platform.isTV || !hasError) return;
    const t = setTimeout(() => retryBtnRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [hasError]);

  // TV VOD: when controls hide, return D-pad focus to the transparent idle
  // tap-catcher so the next OK press shows controls again.  Mirrors the
  // tvCenterRef.focus() call in hideLiveControls() for the live case.
  useEffect(() => {
    if (!Platform.isTV || isLive || isWeb || hasError) return;
    if (!showControls) {
      const t = setTimeout(() => (tvVodIdleRef.current as any)?.focus?.(), 80);
      return () => clearTimeout(t);
    }
  }, [showControls, isLive, isWeb, hasError]);

  // ── Save history on exit and navigate back ────────────────────────────────
  const handleBack = useCallback(async () => {
    // Clear hide/info timers before navigating so they don't fire on an unmounted component
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isLive && params.contentId) {
      const pos = currentTimeRef.current;
      const dur = durationRef.current;
      if (pos >= 5 && dur > 0) {
        if (pos / dur >= 0.95) {
          StorageService.removeFromHistory(params.contentId);
        } else {
          StorageService.addToHistory({
            id: params.contentId,
            parentId: params.parentId,
            parentTitle: params.parentTitle,
            title: params.title,
            cover: params.logo,
            type: params.type === 'series' ? 'series' : 'movie',
            position: pos,
            duration: dur,
            timestamp: Date.now(),
          });
        }
      }
    }
    router.back();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, router]);

  // ── Android hardware back button (VOD / series / catch-up) ───────────────
  // Fire TV BACK key during VOD playback:
  //   • Controls visible  → dismiss the overlay (first press).
  //   • Controls hidden   → save position and navigate back (second press).
  // Without this handler the Android default would pop the screen immediately
  // regardless of overlay state, and on some TV navigation stacks could skip
  // back to the launcher instead of the previous in-app screen.
  useEffect(() => {
    if (isLive || isWeb || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showControlsRef.current) {
        // Dismiss controls: cancel the hide timer, fade out, then unmount.
        if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
        Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
        setTimeout(() => {
          setShowControls(false);
          // Return TV focus to the idle catch-all so the next OK press
          // can show controls again.
          if (Platform.isTV) {
            setTimeout(() => (tvVodIdleRef.current as any)?.focus?.(), 50);
          }
        }, 320);
        return true; // consumed — do not navigate back
      }
      // Controls already hidden — save progress and navigate back.
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [isLive, isWeb, handleBack, controlsOpacity]);

  // ── Pause local playback while casting (device becomes the remote) ────────
  useEffect(() => {
    if (isCasting && !isWeb) {
      try { player.pause(); } catch {}
    }
  }, [isCasting, isWeb, player]);

  // ── Apply playback speed ──────────────────────────────────────────────────
  useEffect(() => {
    if (!player || isWeb) return;
    try { player.playbackRate = speed; } catch {}
  }, [speed, player, isWeb]);

  // ── Controls visibility ──────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      setTimeout(() => setShowControls(false), 450);
    }, 3000);
  }, [controlsOpacity]);

  const scheduleInfoHide = useCallback(() => {
    if (infoTimer.current) clearTimeout(infoTimer.current);
    infoTimer.current = setTimeout(() => {
      Animated.timing(infoOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      setTimeout(() => setShowInfo(false), 450);
    }, 3000);
  }, [infoOpacity]);

  useEffect(() => {
    // Live TV (any platform): overlay stays until dismissed — no auto-hide timer.
    if (!isLive) {
      scheduleInfoHide();
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (infoTimer.current) clearTimeout(infoTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleInfoHide]);

  // Live TV (all platforms): start with the info bar hidden so the stream opens
  // clean.  On TV the user presses OK to reveal it; on phone/tablet a tap shows
  // it.  BACK / swipe-right dismisses it.  (showInfo defaults to true, so we
  // need this effect to immediately zero it out on Live TV screens.)
  useEffect(() => {
    if (!isLive) return;
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
    setShowInfo(false);
    infoOpacity.setValue(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Allow TV D-pad channel nav after a short settle — prevents spurious
  // onFocus firing as the screen mounts from triggering an immediate switch.
  useEffect(() => {
    if (!Platform.isTV || !isLive) return;
    tvNavReadyRef.current = false;
    const t = setTimeout(() => { tvNavReadyRef.current = true; }, 900);
    return () => clearTimeout(t);
  }, [isLive]);

  // ── Restore TV focus to the center zone after every channel change ────────
  // hasTVPreferredFocus alone is NOT reliable on Fire OS: it calls the native
  // requestFocus() on EVERY React re-render, which races with ExoPlayer's audio-
  // focus acquisition triggered by player.replace() inside switchChannel().
  // That race can leave the TV remote with no stable UI focus target, causing OK,
  // LEFT, and RIGHT to stop responding until the app is restarted.
  //
  // An explicit .focus() call 600 ms after channelIdx changes gives ExoPlayer
  // enough time to finish its audio-focus handoff before we reclaim the remote
  // for the UI layer.  Using a useEffect on channelIdx (instead of a setTimeout
  // buried in the zone onFocus closures) also handles the initial-mount focus and
  // is immune to stale-closure issues.
  useEffect(() => {
    if (!Platform.isTV || !isLive) return;
    const t = setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 600);
    return () => clearTimeout(t);
  }, [channelIdx, isLive]);

  // Clean up the TV preview timer on unmount so it can't fire after the
  // component has been destroyed.
  useEffect(() => {
    return () => {
      if (tvPreviewTimerRef.current) { clearTimeout(tvPreviewTimerRef.current); tvPreviewTimerRef.current = null; }
    };
  }, []);

  const showInfoBar = useCallback(() => {
    setShowInfo(true);
    Animated.timing(infoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    // Live TV (any platform): overlay stays until BACK/swipe — no auto-hide.
    if (!isLive) {
      scheduleInfoHide();
    }
  }, [infoOpacity, scheduleInfoHide, isLive]);

  // Show the TV channel-switch preview overlay, then call onCommit after ~1 s.
  // Only relevant on TV (Platform.isTV) — phone/tablet paths never call this.
  const showTvChannelPreview = useCallback((
    channel: ChannelEntry,
    dir: 'prev' | 'next',
    onCommit: () => void,
  ) => {
    // Cancel any already-running preview timer
    if (tvPreviewTimerRef.current) { clearTimeout(tvPreviewTimerRef.current); tvPreviewTimerRef.current = null; }
    setTvPreviewChannel(channel);
    setTvPreviewDir(dir);
    // Fade in quickly
    tvPreviewOpacity.setValue(0);
    Animated.timing(tvPreviewOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    // After 1 s fade out and commit the channel switch
    tvPreviewTimerRef.current = setTimeout(() => {
      Animated.timing(tvPreviewOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setTvPreviewChannel(null);
        setTvPreviewDir(null);
        onCommit();
      });
    }, 1000);
  }, [tvPreviewOpacity]);

  // ── Show VOD controls from TV remote (OK on idle catcher) ───────────────
  // Mirrors handleTap but designed for the D-pad: no showInfoBar (live-only),
  // and moves focus to the play button once the overlay is visible.
  const showVodControls = useCallback(() => {
    if (showControlsRef.current) return;
    setShowControls(true);
    controlsOpacity.setValue(0);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    scheduleHide();
    if (Platform.isTV) {
      // Give the overlay a frame to mount its children before requesting focus.
      setTimeout(() => (tvPlayBtnRef.current as any)?.focus?.(), 80);
    }
  }, [controlsOpacity, scheduleHide]);

  const handleTap = useCallback(() => {
    showInfoBar();
    if (!showControls) {
      setShowControls(true);
      Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    scheduleHide();
  }, [showControls, controlsOpacity, scheduleHide, showInfoBar]);

  /** Double-tap left half → −10 s, right half → +10 s (VOD only). */
  const tapGesture = Gesture.Tap().runOnJS(true).onEnd(handleTap);
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((e) => {
      if (isLive) return;
      const isLeft = e.x < screenWidth / 2;
      const delta = isLeft ? -10 : 10;
      seek(delta);
      // Optimistically update the scrubber so it doesn't lag until next timeUpdate
      setCurrentTime((t) => Math.max(0, t + delta));
      if (doubleTapTimer.current) clearTimeout(doubleTapTimer.current);
      setDoubleTapSide(isLeft ? 'back' : 'forward');
      doubleTapTimer.current = setTimeout(() => setDoubleTapSide(null), 700);
    });
  // Live TV phone/tablet: swipe right → dismiss overlay if visible, else go back.
  // activeOffsetX(30) lets short taps through to tapGesture; failOffsetY prevents
  // stealing vertical scrolls inside any child.
  const liveSwipeGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX(30)
    .failOffsetY([-25, 25])
    .onEnd((e) => {
      if (!isLive || Platform.isTV) return;
      if (e.translationX > 60 && e.velocityX > 0) {
        if (showInfoRef.current) { dismissInfoBar(); }
        else { handleBackLive(); }
      }
    });
  const combinedGesture = Gesture.Race(liveSwipeGesture, Gesture.Exclusive(doubleTapGesture, tapGesture));

  const togglePlay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isCasting) {
      // Drive the remote cast device instead of the local player
      if (isPlaying) { pauseRemote(); setIsPlaying(false); }
      else           { playRemote();  setIsPlaying(true);  }
    } else {
      if (player.playing) { player.pause(); } else { player.play(); }
    }
    scheduleHide();
  }, [isCasting, isPlaying, player, scheduleHide, pauseRemote, playRemote]);

  const seek = useCallback((delta: number) => {
    if (isCasting) { seekRemote(currentTime + delta); }
    else           { player.seekBy(delta); }
    scheduleHide();
  }, [isCasting, currentTime, player, scheduleHide, seekRemote]);

  // ── CC pill behaviour ────────────────────────────────────────────────────
  // • Subtitles OFF + only 1 track  → enable that track directly.
  // • Subtitles OFF + multiple tracks → open the subtitle picker so the user
  //   can choose which track to enable (Task #42).
  // • Subtitles ON  → advance to the next track; wrap around to OFF after the
  //   last track (existing cycling behaviour).
  const handleCcPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (subtitleTracks.length === 0) return;

    if (activeSubtitleTrack === null) {
      // Subtitles are currently OFF
      if (subtitleTracks.length === 1) {
        // Only one track — enable it directly without showing a picker
        const first = subtitleTracks[0];
        try { player.subtitleTrack = first; } catch {}
        setActiveSubtitleTrack(first);
        if (first.language) StorageService.setPrefSubtitleLang(first.language).catch(() => {});
      } else {
        // Multiple tracks — open the picker so the user can choose (#42)
        setShowSubPicker(true);
      }
      return;
    }

    // Subtitles are ON → advance to next track, wrap to OFF after last
    const currentIdx = subtitleTracks.findIndex(
      (t) => t === activeSubtitleTrack || t.language === activeSubtitleTrack.language,
    );
    const nextIdx = currentIdx + 1;
    if (nextIdx >= subtitleTracks.length) {
      try { player.subtitleTrack = null; } catch {}
      setActiveSubtitleTrack(null);
      StorageService.clearPrefSubtitleLang().catch(() => {});
    } else {
      const next = subtitleTracks[nextIdx];
      try { player.subtitleTrack = next; } catch {}
      setActiveSubtitleTrack(next);
      if (next.language) StorageService.setPrefSubtitleLang(next.language).catch(() => {});
    }
  }, [player, subtitleTracks, activeSubtitleTrack]);

  // Label shown inside the CC pill — includes language code when cycling is available
  const ccLabel =
    subtitleTracks.length > 1 && activeSubtitleTrack?.language
      ? `CC · ${activeSubtitleTrack.language.toUpperCase()}`
      : 'CC';

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video layer */}
      {isWeb ? (
        <View style={styles.msgView}>
          <Text style={styles.msgIcon}>📱</Text>
          <Text style={styles.msgTitle}>Open in Expo Go</Text>
          <Text style={styles.msgSub}>Browsers can't play IPTV streams.{'\n'}Use the Expo Go app on your phone.</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={() => Linking.openURL('https://expo.dev/go')}>
            <Text style={styles.actionBtnText}>Get Expo Go →</Text>
          </TouchableOpacity>
        </View>
      ) : hasError ? (
        <View style={styles.msgView}>
          <Text style={styles.msgIcon}>⚠</Text>
          <Text style={styles.msgTitle}>Stream Error</Text>
          {!!params.title && (
            <Text style={[styles.msgSub, { fontFamily: 'Inter_600SemiBold', marginBottom: 2 }]} numberOfLines={2}>
              {params.title}
            </Text>
          )}
          <Text style={styles.msgSub}>Unable to load stream. Check your connection or try another channel.</Text>
          <FocusablePressable
            ref={retryBtnRef}
            style={styles.actionBtn}
            onPress={() => {
              setHasError(false);
              setIsBuffering(true);
              const currentEntry = channelIdx >= 0 && channelList[channelIdx];
              player.replace(currentEntry ? currentEntry.url : params.url);
              player.play();
              // TV belt-and-suspenders: once the error overlay unmounts and the
              // video surface + tap-catcher remount, move D-pad focus to the
              // right idle target so the user doesn't have to home in manually.
              if (Platform.isTV) {
                setTimeout(() => {
                  if (isLive) (tvCenterRef.current as any)?.focus?.();
                  else (tvVodIdleRef.current as any)?.focus?.();
                }, 400);
              }
            }}
          >
            <Text style={styles.actionBtnText}>Retry</Text>
          </FocusablePressable>
        </View>
      ) : videoMounted ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          allowsPictureInPicture
          nativeControls={false}
          // For live streams, signal the context overlay to fade out as soon as
          // the native video surface has rendered its first frame.  This prevents
          // the white/black flash that appears on slow devices when the overlay
          // disappears before the VideoView has attached to the shared player.
          onFirstFrameRender={isLive ? notifyPlayerReady : undefined}
        />
      ) : null}

      {/* Buffering — no overlay; video surface stalls silently until stream resumes */}

      {/* Refreshing stream overlay — shown during silent URL re-resolve (#137) */}
      {isResolvingUrl && !isWeb && (
        <View style={styles.reconnectOverlay} pointerEvents="none">
          <View style={styles.bufferCircle}>
            <Text style={styles.bufferIcon}>⟳</Text>
          </View>
          <Text style={styles.reconnectText}>Refreshing stream…</Text>
        </View>
      )}

      {/* Reconnecting overlay (live streams only) */}
      {isReconnecting && !isResolvingUrl && !isWeb && (
        <View style={styles.reconnectOverlay} pointerEvents="none">
          <View style={styles.bufferCircle}>
            <Text style={styles.bufferIcon}>↺</Text>
          </View>
          <Text style={styles.reconnectText}>
            Reconnecting… ({reconnectAttempt}/{MAX_RECONNECTS})
          </Text>
        </View>
      )}

      {/* Tap catcher — single tap shows controls, double tap on VOD seeks ±10 s */}
      {!isWeb && !hasError && (
        <GestureDetector gesture={combinedGesture}>
          <View style={StyleSheet.absoluteFill}>
            {doubleTapSide !== null && (
              <View
                style={[
                  styles.doubleTapFeedback,
                  doubleTapSide === 'back'
                    ? { left: 0, right: '50%' }
                    : { left: '50%', right: 0 },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.doubleTapIcon}>
                  {doubleTapSide === 'back' ? '« 10s' : '10s »'}
                </Text>
              </View>
            )}
          </View>
        </GestureDetector>
      )}

      {/* ── Fire TV / Android TV: VOD idle focus catcher ─────────────────────
          When the controls overlay is hidden there is nothing focusable on
          screen for the D-pad remote.  This full-screen transparent Pressable
          with hasTVPreferredFocus acts as the "resting" focus target.
          • OK (select) → show the controls overlay and move focus to ▶/⏸.
          • BACK is handled by the BackHandler registered above (dismisses
            controls if visible, otherwise navigates back).
          When controls are visible this element yields focus (focusable=false)
          so the remote can reach the actual control buttons. */}
      {Platform.isTV && !isLive && !isWeb && !hasError && (
        <Pressable
          ref={tvVodIdleRef as any}
          focusable={!showControls}
          style={StyleSheet.absoluteFill}
          onPress={showVodControls}
        />
      )}

      {/* ── Controls overlay (VOD: play/seek/back) ── */}
      {showControls && !isWeb && !isLive && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: controlsOpacity }]} pointerEvents="box-none">
          {/* VOD title bar — top-centre */}
          <View style={styles.vodTitleBar} pointerEvents="none">
            {params.parentTitle ? (
              <Text style={styles.vodParentTitle} numberOfLines={1}>{params.parentTitle}</Text>
            ) : null}
            <Text style={styles.vodTitle} numberOfLines={1}>{params.title}</Text>
          </View>
          {/* Back button + casting pill — absolute top-left */}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FocusablePressable style={styles.backBtn} onPress={handleBack}>
              <Text style={styles.backIcon}>←</Text>
            </FocusablePressable>
            {isCasting && (
              <View style={styles.castingPill}>
                <Text style={styles.castingText}>
                  {castDeviceName ? `📺 ${castDeviceName}` : '📺 Casting'}
                </Text>
              </View>
            )}
          </View>

          {/* Cast button + Audio + CC + Settings ⚙ — absolute top-right */}
          <View style={{ position: 'absolute', top: insets.top + 8, right: 16, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <CastButton />
            {/* Audio track button — always visible */}
            <FocusablePressable
              ref={audioChipRef}
              style={[styles.trackPill, audioTracks.length === 0 && { opacity: 0.35 }]}
              onPress={() => setShowAudioPicker(true)}
            >
              <Text style={styles.trackPillText}>
                🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
              </Text>
            </FocusablePressable>
            {/* CC / Subtitle button.
                Touch: tap cycles off→first→next→off; long-press opens picker.
                TV/D-pad: OK always opens the picker so the user can jump to any
                track without cycling through all of them. */}
            <FocusablePressable
              ref={ccChipRef}
              style={[styles.trackPill, subtitleTracks.length === 0 && { opacity: 0.35 }, activeSubtitleTrack !== null && styles.trackPillActive]}
              onPress={Platform.isTV ? () => setShowSubPicker(true) : handleCcPress}
              onLongPress={() => setShowSubPicker(true)}
              delayLongPress={400}
            >
              <Text style={[styles.trackPillText, activeSubtitleTrack !== null && styles.trackPillTextActive]}>
                CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
              </Text>
            </FocusablePressable>
            <FocusablePressable
              ref={settingsChipRef}
              style={styles.backBtn}
              onPress={() => { setShowSettings(true); }}
            >
              <Text style={{ fontSize: 18, color: '#fff' }}>⚙</Text>
            </FocusablePressable>
          </View>

          {/* Seek + play/pause buttons — absolute centre */}
          <View style={styles.centerAbs} pointerEvents="box-none">
            <FocusablePressable
              ref={tvSeek30BackRef}
              style={styles.seekBtn}
              onPress={() => seek(-30)}
            >
              <Text style={styles.seekIcon}>⏮</Text>
              <Text style={styles.seekLabel}>-30s</Text>
            </FocusablePressable>
            <View style={{ alignItems: 'center' }}>
              <FocusablePressable
                ref={tvPlayBtnRef}
                style={styles.playBtn}
                focusedStyle={styles.focusRing}
                onPress={togglePlay}
              >
                <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
              </FocusablePressable>
              {!isPlaying && !isLive && (
                <Text style={styles.pausedLabel}>PAUSED</Text>
              )}
            </View>
            <FocusablePressable
              ref={tvSeek30FwdRef}
              style={styles.seekBtn}
              onPress={() => seek(+30)}
            >
              <Text style={styles.seekIcon}>⏭</Text>
              <Text style={styles.seekLabel}>+30s</Text>
            </FocusablePressable>
          </View>

          {/* Scrubber + times — touch scrubber (phones/tablets) */}
          {!Platform.isTV && (
            <VodScrubber
              currentTime={currentTime}
              duration={duration}
              insetBottom={insets.bottom}
              onSeek={(t) => {
                // Optimistic update so the scrubber stays at the dragged position
                setCurrentTime(t);
                scheduleHide();

                if (isCatchup && catchupStreamId && catchupServerStart && catchupStartTimestamp > 0 && credentials?.type === 'xtream') {
                  // Timeshift HLS can't be seeked via currentTime — regenerate the
                  // URL with a new start offset and reload the stream.
                  const seekSecs = Math.floor(t);
                  const remainingSecs = Math.max(60, knownDurationSecs - seekSecs);
                  const newDurationMins = Math.ceil(remainingSecs / 60);
                  const newStartTs = catchupStartTimestamp + seekSecs;
                  const newServerStart = addSecondsToServerTime(catchupServerStart, seekSecs);
                  const creds = { host: credentials.host!, username: credentials.username!, password: credentials.password! };
                  // Use whichever format index succeeded on first load (#69)
                  const newUrl = getXtreamCatchupUrls(creds, catchupStreamId, newServerStart, newDurationMins, newStartTs)[catchupFormatRef.current];
                  // Update the wall-clock timer offset so it resumes from seek position
                  catchupSeekOffsetRef.current = seekSecs;
                  catchupWallStartRef.current = Date.now() - seekSecs * 1000;
                  setIsBuffering(true);
                  try { player.replace(newUrl); player.play(); } catch {}
                } else if (isCasting) {
                  seekRemote(t);
                } else {
                  player.currentTime = t;
                }
              }}
            />
          )}

          {/* ── TV scrubber row ───────────────────────────────────────────────
              RNGH Pan gestures do not fire from the D-pad remote.  Instead we
              render a focusable anchor bar (progress + times) with invisible
              "bounce" Pressables wired to its nextFocusLeft / nextFocusRight.
              When D-pad left/right lands on a bounce target its onFocus handler
              seeks ±10 s and immediately returns focus to the anchor — the same
              focus-bounce technique used for live TV channel switching. */}
          {Platform.isTV && (
            <>
              {/* Invisible seek-back target — receives focus when D-pad LEFT on anchor */}
              <Pressable
                ref={tvSeekBackRef as any}
                focusable
                style={[styles.tvSeekBounce, { left: 0, bottom: insets.bottom + 12 }]}
                onFocus={() => {
                  seek(-10);
                  scheduleHide();
                  setTimeout(() => (tvScrubAnchorRef.current as any)?.focus?.(), 70);
                }}
              />

              {/* Focusable progress bar — D-pad can reach it; LEFT/RIGHT wired below */}
              <FocusablePressable
                ref={tvScrubAnchorRef}
                focusable
                style={[styles.tvScrubAnchor, { bottom: insets.bottom + 12 }]}
                focusedStyle={styles.tvScrubAnchorFocused}
                onPress={() => { /* OK on scrubber: no-op; LEFT/RIGHT seek via bounce targets */ }}
              >
                <View style={styles.tvScrubRail}>
                  <View style={[styles.tvScrubFill, { width: `${Math.max(0, Math.min(100, progress))}%` as any }]} />
                </View>
                <View style={styles.tvScrubTimes}>
                  <Text style={styles.tvScrubTimeText}>{fmtSecs(currentTime)}</Text>
                  <Text style={styles.tvScrubTimeText}>
                    {duration > 0 && isFinite(duration) ? fmtSecs(duration) : isCatchup ? 'CATCH-UP' : 'LIVE'}
                  </Text>
                </View>
              </FocusablePressable>

              {/* Invisible seek-forward target — receives focus when D-pad RIGHT on anchor */}
              <Pressable
                ref={tvSeekFwdRef as any}
                focusable
                style={[styles.tvSeekBounce, { right: 0, bottom: insets.bottom + 12 }]}
                onFocus={() => {
                  seek(+10);
                  scheduleHide();
                  setTimeout(() => (tvScrubAnchorRef.current as any)?.focus?.(), 70);
                }}
              />
            </>
          )}
        </Animated.View>
      )}

      {/* Back button + Cast button + Audio + CC for Live */}
      {showControls && !isWeb && isLive && (
        <Animated.View
          style={{ opacity: controlsOpacity, position: 'absolute', top: insets.top + 8, left: 0, right: 0, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 16 }}
          pointerEvents="box-none"
        >
          <FocusablePressable style={styles.backBtn} onPress={handleBackLive}>
            <Text style={styles.backIcon}>←</Text>
          </FocusablePressable>
          <CastButton />
          <View style={{ flex: 1 }} />
          {/* Audio track button */}
          <FocusablePressable
            ref={audioChipRef}
            style={[styles.trackPill, audioTracks.length === 0 && { opacity: 0.35 }]}
            onPress={() => setShowAudioPicker(true)}
          >
            <Text style={styles.trackPillText}>
              🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
            </Text>
          </FocusablePressable>
          {/* CC / Subtitle button.
              Touch: tap cycles off→first→next→off; long-press opens picker.
              TV/D-pad: OK always opens the picker. */}
          <FocusablePressable
            ref={ccChipRef}
            style={[styles.trackPill, activeSubtitleTrack !== null && styles.trackPillActive]}
            onPress={Platform.isTV ? () => setShowSubPicker(true) : handleCcPress}
            onLongPress={() => setShowSubPicker(true)}
            delayLongPress={400}
          >
            <Text style={[styles.trackPillText, activeSubtitleTrack !== null && styles.trackPillTextActive]}>
              CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
            </Text>
          </FocusablePressable>
        </Animated.View>
      )}

      {/* ── Live TV info bar (NOW/NEXT + prev/next channel) ── */}
      {isLive && !isWeb && !hasError && showInfo && (
        <Animated.View
          style={[styles.infoBar, { paddingBottom: insets.bottom + 8, opacity: infoOpacity }]}
          pointerEvents="box-none"
        >
          {/* Single compact row: LIVE pill + casting pill + channel name + NOW prog + time + back */}
          <View style={styles.infoTop}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            {isCasting && (
              <View style={styles.castingPill}>
                <Text style={styles.castingText}>
                  {castDeviceName ? `📺 ${castDeviceName}` : '📺 Casting'}
                </Text>
              </View>
            )}
            {activeSubtitleTrack !== null && (
              <View style={styles.ccActiveBadge}>
                <Text style={styles.ccActiveBadgeText}>{ccLabel}</Text>
              </View>
            )}
            {!!activeLogo && (
              <Image
                source={{ uri: activeLogo }}
                style={styles.infoChannelLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            )}
            <Text style={styles.infoChannel} numberOfLines={1}>{activeTitle}</Text>
            {currentProg && (
              <>
                <View style={styles.infoSep} />
                <Text style={styles.infoNowLabel}>NOW</Text>
                <Text style={styles.infoNowTitle} numberOfLines={1}>{currentProg.title}</Text>
                <Text style={styles.infoProgTime}>
                  {fmtTime(currentProg.start)}–{fmtTime(currentProg.end)}
                </Text>
              </>
            )}
            <FocusablePressable onPress={handleBackLive} style={styles.backBtnSmall}>
              <Text style={styles.backIcon}>←</Text>
            </FocusablePressable>
          </View>

          {/* NEXT row — dimmed, compact */}
          {nextProg && (
            <View style={[styles.infoRow, styles.infoRowNext]}>
              <Text style={[styles.infoLabel, styles.infoLabelNext]}>NEXT</Text>
              <Text style={[styles.infoProgTitle, styles.infoProgTitleNext]} numberOfLines={1}>
                {nextProg.title}
              </Text>
              <Text style={[styles.infoProgTime, { color: 'rgba(255,255,255,0.4)' }]}>
                {fmtTime(nextProg.start)}–{fmtTime(nextProg.end)}
              </Text>
            </View>
          )}

          {/* Row 4: Prev / Next channel navigation */}
          {(prevChannel || nextChannel) && (
            <View style={styles.chNavRow}>
              {prevChannel ? (
                <FocusablePressable style={styles.chNavBtn} onPress={handlePrevChannel}>
                  <Text style={styles.chNavArrow}>‹</Text>
                  <Text style={styles.chNavLabel} numberOfLines={1}>{prevChannel.title}</Text>
                </FocusablePressable>
              ) : (
                <View style={styles.chNavPlaceholder} />
              )}

              {nextChannel ? (
                <FocusablePressable style={[styles.chNavBtn, styles.chNavBtnRight]} onPress={handleNextChannel}>
                  <Text style={styles.chNavLabel} numberOfLines={1}>{nextChannel.title}</Text>
                  <Text style={styles.chNavArrow}>›</Text>
                </FocusablePressable>
              ) : (
                <View style={styles.chNavPlaceholder} />
              )}
            </View>
          )}
        </Animated.View>
      )}

      {/* ── TV / Fire TV D-pad zones ─────────────────────────────────────────
          Three transparent full-screen strips. Android TV's focus engine moves
          focus between them when the user presses D-pad left / right.
          • Left zone  → onFocus triggers prev-channel switch
          • Center zone → hasTVPreferredFocus; OK (select) shows the info bar
          • Right zone → onFocus triggers next-channel switch
          After a switch the center zone reclaims focus after the nav cooldown.
          ────────────────────────────────────────────────────────────────── */}
      {Platform.isTV && isLive && !hasError && !isWeb && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Left third — D-pad left lands here → show prev-channel preview, then switch.
              Always focusable (unconditional) so this zone is never in a non-focusable
              state while it holds D-pad focus.  On Fire OS a view that becomes
              non-focusable while focused creates a dead zone where the remote stops
              responding.  Instead, onFocus bounces focus to center when there is no
              previous channel to switch to. */}
          <Pressable
            focusable
            style={styles.tvZoneLeft}
            onPress={showInfo ? dismissInfoBar : showInfoBar}
            onFocus={() => {
              if (!prevChannel || !tvNavReadyRef.current) {
                // No previous channel or nav not yet settled — immediately bounce
                // D-pad focus to center so the remote stays responsive.
                setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 50);
                return;
              }
              if (navCooldownRef.current) return;
              // Claim the cooldown upfront so rapid D-pad presses during the preview are ignored
              navCooldownRef.current = true;
              setTimeout(() => { navCooldownRef.current = false; }, 1400);
              const targetChannel = prevChannel;
              const targetIdx = channelIdx - 1;
              showTvChannelPreview(targetChannel, 'prev', () => {
                switchChannel(targetChannel, targetIdx);
                // Belt-and-suspenders: also request focus explicitly here in addition
                // to the useEffect[channelIdx] handler, in case the effect fires before
                // the native layer has settled after player.replace().
                setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 700);
              });
            }}
          />
          {/* Centre — explicit focus target; OK shows/hides info bar + controls.
              hasTVPreferredFocus has been intentionally removed: on Fire OS it calls
              the native requestFocus() on EVERY re-render, which races with ExoPlayer's
              audio-focus acquisition during player.replace() and can leave the remote
              with no stable UI focus target.  Initial focus and post-switch focus are
              now handled by the useEffect[channelIdx] above. */}
          <Pressable
            ref={tvCenterRef as any}
            focusable
            style={styles.tvZoneCenter}
            onPress={() => {
              if (Platform.isTV) {
                // On Fire TV: OK toggles info bar + controls overlay together.
                // If either is visible, dismiss both so the next OK starts clean.
                if (showControlsRef.current || showInfoRef.current) {
                  hideLiveControls();
                  if (showInfoRef.current) dismissInfoBar();
                } else {
                  showInfoBar();
                  showLiveControls();
                }
              } else {
                // On phone/tablet: just toggle the info bar (touch path).
                if (showInfo) { dismissInfoBar(); } else { showInfoBar(); }
              }
            }}
          />
          {/* Right third — D-pad right lands here → show next-channel preview, then switch.
              Always focusable for the same reason as the left zone above — prevents
              a dead zone at the last channel when this zone becomes non-focusable. */}
          <Pressable
            focusable
            style={styles.tvZoneRight}
            onPress={showInfo ? dismissInfoBar : showInfoBar}
            onFocus={() => {
              if (!nextChannel || !tvNavReadyRef.current) {
                // No next channel or nav not yet settled — bounce focus to center.
                setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 50);
                return;
              }
              if (navCooldownRef.current) return;
              navCooldownRef.current = true;
              setTimeout(() => { navCooldownRef.current = false; }, 1400);
              const targetChannel = nextChannel;
              const targetIdx = channelIdx + 1;
              showTvChannelPreview(targetChannel, 'next', () => {
                switchChannel(targetChannel, targetIdx);
                setTimeout(() => (tvCenterRef.current as any)?.focus?.(), 700);
              });
            }}
          />
        </View>
      )}

      {/* ── TV channel-switch preview overlay ───────────────────────────────
          Fades in for ~1 s when D-pad left/right is pressed so the viewer
          knows which channel is coming before the stream switches.
          Positioned at the bottom-centre, similar to the live info bar.
          Only rendered on TV (Platform.isTV check is in the condition above). */}
      {Platform.isTV && isLive && !hasError && !isWeb && tvPreviewChannel && (
        <Animated.View
          style={[styles.tvChannelPreview, { bottom: insets.bottom + 16, opacity: tvPreviewOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.tvPreviewArrow}>{tvPreviewDir === 'prev' ? '‹' : '›'}</Text>
          {!!tvPreviewChannel.logo && (
            <Image
              source={{ uri: tvPreviewChannel.logo }}
              style={styles.tvPreviewLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
          <Text style={styles.tvPreviewTitle} numberOfLines={1}>{tvPreviewChannel.title}</Text>
        </Animated.View>
      )}

      {/* Web back button */}
      {isWeb && (
        <TouchableOpacity
          style={[styles.backBtn, { position: 'absolute', top: insets.top + 8, left: 16 }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
      )}

      {/* ── Audio Track picker ── */}
      <Modal
        visible={showAudioPicker}
        transparent
        animationType="slide"
        onShow={() => {
          // TV: focus the first audio chip on modal open (replaces hasTVPreferredFocus
          // which fires requestFocus on every re-render and causes races on Fire OS).
          if (Platform.isTV) setTimeout(() => firstAudioChipRef.current?.focus(), 80);
        }}
        onRequestClose={() => {
          setShowAudioPicker(false);
          // Return D-pad focus to the chip that opened this picker
          setTimeout(() => audioChipRef.current?.focus(), 150);
        }}
      >
        <Pressable style={styles.settingsBackdrop} focusable={false} onPress={() => setShowAudioPicker(false)} />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.settingsHandle} />
          <Text style={styles.settingsTitle}>Audio Track</Text>
          {audioTracks.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
              No audio tracks detected yet — they appear once the stream has loaded.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {audioTracks.map((track, idx) => {
                const label = track.label || track.name || track.language || `Track ${idx + 1}`;
                const isActive =
                  activeAudioTrack != null &&
                  (track.id != null
                    ? track.id === activeAudioTrack.id
                    : track.language === activeAudioTrack.language && track.label === activeAudioTrack.label);
                return (
                  <FocusablePressable
                    key={track.id ?? `audio-${idx}`}
                    ref={idx === 0 ? firstAudioChipRef : undefined}
                    focusedStyle={styles.chipFocus}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => {
                      try {
                        player.audioTrack = track;
                        setActiveAudioTrack(track);
                        if (track.language) {
                          StorageService.setPrefAudioLanguage(track.language).catch(() => {});
                          setPrefAudioLang(track.language);
                        }
                      } catch {}
                      setShowAudioPicker(false);
                      setTimeout(() => audioChipRef.current?.focus(), 150);
                    }}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
                  </FocusablePressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Subtitle / CC picker ── */}
      <Modal
        visible={showSubPicker}
        transparent
        animationType="slide"
        onShow={() => {
          if (Platform.isTV) setTimeout(() => firstSubChipRef.current?.focus(), 80);
        }}
        onRequestClose={() => {
          setShowSubPicker(false);
          setTimeout(() => ccChipRef.current?.focus(), 150);
        }}
      >
        <Pressable style={styles.settingsBackdrop} focusable={false} onPress={() => setShowSubPicker(false)} />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.settingsHandle} />
          <Text style={styles.settingsTitle}>Subtitles / CC</Text>
          {subtitleTracks.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
              No subtitle tracks detected for this stream.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <FocusablePressable
                ref={firstSubChipRef}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, activeSubtitleTrack === null && styles.chipActive]}
                onPress={() => {
                  try {
                    player.subtitleTrack = null;
                    setActiveSubtitleTrack(null);
                    StorageService.clearPrefSubtitleLang().catch(() => {});
                  } catch {}
                  setShowSubPicker(false);
                  setTimeout(() => ccChipRef.current?.focus(), 150);
                }}
              >
                <Text style={[styles.chipText, activeSubtitleTrack === null && styles.chipTextActive]}>Off</Text>
              </FocusablePressable>
              {subtitleTracks.map((track, idx) => {
                const label = track.label || track.name || track.language || `Track ${idx + 1}`;
                const isActive =
                  activeSubtitleTrack != null &&
                  (track.id != null
                    ? track.id === activeSubtitleTrack.id
                    : track.language === activeSubtitleTrack.language && track.label === activeSubtitleTrack.label);
                return (
                  <FocusablePressable
                    key={track.id ?? `sub-${idx}`}
                    focusedStyle={styles.chipFocus}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => {
                      try {
                        player.subtitleTrack = track;
                        setActiveSubtitleTrack(track);
                        if (track.language) StorageService.setPrefSubtitleLang(track.language).catch(() => {});
                      } catch {}
                      setShowSubPicker(false);
                      setTimeout(() => ccChipRef.current?.focus(), 150);
                    }}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
                  </FocusablePressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Settings tray ── */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onShow={() => {
          if (Platform.isTV) setTimeout(() => firstSpeedChipRef.current?.focus(), 80);
        }}
        onRequestClose={() => {
          setShowSettings(false);
          setTimeout(() => settingsChipRef.current?.focus(), 150);
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          onPress={() => setShowSettings(false)}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.settingsHandle} />

          {/* Vertical scroll so audio/subtitle sections are reachable on small screens */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
          <Text style={styles.settingsTitle}>Playback Speed</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SPEEDS.map((s, idx) => (
              <FocusablePressable
                key={s}
                ref={idx === 0 ? firstSpeedChipRef : undefined}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, speed === s && styles.chipActive]}
                onPress={() => {
                  setSpeed(s);
                  player.playbackRate = s;
                  import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
                    AS.setItem('@pref_playback_speed', String(s))
                  ).catch(() => {});
                }}
              >
                <Text style={[styles.chipText, speed === s && styles.chipTextActive]}>
                  {s === 1 ? '1× Normal' : `${s}×`}
                </Text>
              </FocusablePressable>
            ))}
          </ScrollView>

          <Text style={[styles.settingsTitle, { marginTop: 8 }]}>Aspect Ratio</Text>
          <View style={styles.chipRow}>
            {FITS.map((f) => (
              <FocusablePressable
                key={f.value}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, contentFit === f.value && styles.chipActive]}
                onPress={() => setContentFit(f.value)}
              >
                <Text style={[styles.chipText, contentFit === f.value && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </FocusablePressable>
            ))}
          </View>

          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  // ── TV / Fire TV VOD scrubber ────────────────────────────────────────────
  // Invisible bounce targets sit to the left/right of the anchor.
  // Their onFocus seeks ±10 s then returns focus to the anchor.
  tvSeekBounce: {
    position: 'absolute',
    width: 8,
    height: 64,
    opacity: 0,
  },
  // Focusable progress-bar shown on TV in place of the RNGH drag scrubber.
  tvScrubAnchor: {
    position: 'absolute',
    left: 16, right: 16,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tvScrubAnchorFocused: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  tvScrubRail: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  tvScrubFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },
  tvScrubTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tvScrubTimeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },

  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  backBtnSmall: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    flexShrink: 0,
  },
  backIcon: { fontSize: 20, color: '#fff' },

  center: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  playIcon: { fontSize: 28, color: '#fff' },
  seekBtn: {
    alignItems: 'center', gap: 4,
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, borderWidth: 2, borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  seekIcon: { fontSize: 22, color: '#fff' },
  seekLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium' },
  focusRing: { borderColor: '#00E5FF' },

  centerAbs: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  vodBar: { gap: 6 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium' },
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 2 },

  // ── Live info bar ──
  infoBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  infoTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  liveDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#EF4444' },
  liveText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 1 },
  vodTitleBar: { position: 'absolute', top: 0, left: 80, right: 80, alignItems: 'center', paddingTop: 12 },
  vodParentTitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)', letterSpacing: 0.3 },
  vodTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff', textAlign: 'center' },
  infoChannelLogo: { width: 28, height: 20, marginRight: 6, flexShrink: 0 },
  infoChannel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff', flexShrink: 1 },
  infoSep: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: 'rgba(255,255,255,0.25)', flexShrink: 0 },
  infoNowLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#3B82F6', letterSpacing: 0.5, flexShrink: 0 },
  infoNowTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoRowNext: { opacity: 0.65 },
  infoLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#3B82F6',
    letterSpacing: 0.5,
    width: 34,
    flexShrink: 0,
  },
  infoLabelNext: { color: 'rgba(255,255,255,0.5)' },
  infoProgTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  infoProgTitleNext: { fontFamily: 'Inter_400Regular' },
  infoProgTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    flexShrink: 0,
  },

  // ── Prev / Next channel navigation ──
  chNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 12,
  },
  chNavBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chNavBtnRight: {
    justifyContent: 'flex-end',
  },
  chNavArrow: {
    fontSize: 22,
    color: '#fff',
    lineHeight: 24,
    flexShrink: 0,
  },
  chNavLabel: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.85)',
  },
  chNavPlaceholder: { flex: 1 },

  // ── Settings tray ──
  settingsBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  settingsSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
  },
  settingsHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  settingsTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: {
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderColor: '#3B82F6',
  },
  chipFocus: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.1)',
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.6)',
  },
  chipTextActive: {
    color: '#60A5FA',
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Audio / CC track pills ──
  trackPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackPillActive: {
    backgroundColor: 'rgba(59,130,246,0.3)',
    borderColor: '#3B82F6',
  },
  trackPillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.3,
  },
  trackPillTextActive: {
    color: '#60A5FA',
  },

  // ── Casting pill ──
  castingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  castingText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#60A5FA',
    letterSpacing: 0.5,
  },

  // CC subtitle-active pill
  ccPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  ccText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#C4B5FD',
    letterSpacing: 0.8,
  },

  // CC active badge on the Subtitles settings row header
  ccActiveBadge: {
    backgroundColor: 'rgba(124,58,237,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.65)',
    borderRadius: 99,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ccActiveBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#C4B5FD',
    letterSpacing: 0.8,
  },

  // Buffering
  bufferWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 16 },
  bufferCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  bufferIcon: { fontSize: 24, color: '#fff' },
  bufferText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },
  pausedLabel: { fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, marginTop: 4 },

  // Double-tap seek feedback flash
  doubleTapFeedback: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
  },
  doubleTapIcon: { fontSize: 22, color: '#fff', fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  // Reconnecting overlay
  reconnectOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.55)' },
  reconnectText: { fontSize: 15, color: '#fff', fontFamily: 'Inter_600SemiBold', letterSpacing: 0.2 },

  // Error / web message
  msgView: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  msgIcon: { fontSize: 40, color: '#fff' },
  msgTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  msgSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },
  actionBtn: { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12 },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // ── TV / Fire TV D-pad navigation zones (transparent, pointerEvents=none on parent) ──
  tvZoneLeft: {
    position: 'absolute', top: 0, bottom: 0,
    left: 0, width: '30%',
  },
  tvZoneCenter: {
    position: 'absolute', top: 0, bottom: 0,
    left: '30%', right: '30%',
  },
  tvZoneRight: {
    position: 'absolute', top: 0, bottom: 0,
    right: 0, width: '30%',
  },

  // ── TV channel-switch preview overlay ──
  tvChannelPreview: {
    position: 'absolute',
    left: 60,
    right: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.80)',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  tvPreviewArrow: {
    fontSize: 32,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 36,
    flexShrink: 0,
  },
  tvPreviewLogo: {
    width: 52,
    height: 36,
    flexShrink: 0,
  },
  tvPreviewTitle: {
    flex: 1,
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.2,
  },
});
