import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  Easing,
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
import { LiveChannelMenu } from '@/components/LiveChannelMenu';
import type { MenuChannelEntry } from '@/components/LiveChannelMenu';
import * as Network from 'expo-network';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useVideoPlayer } from 'expo-video';
import { useLivePlayer } from '@/context/LivePlayerContext';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '@/context/AppContext';
import { StorageService } from '@/services/storage';
import { cancelRemindersForActiveChannel } from '@/services/notifications';
import { getXtreamXmltvUrl, getXtreamCatchupUrls, getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { Channel, EpgProgram } from '@/types';
import { Image } from 'expo-image';
import { useCast } from '@/hooks/useCast';
import { useTVRemote } from '@/hooks/useTVRemote';
import { requestTvFocus } from '@/lib/tvFocus';
import { setPendingLivePlayerReturn } from '@/lib/livePlayerHandoff';
import CastButton from '@/components/CastButton';
import { useBackHandler } from '@/hooks/useBackHandler';
import { NativeStreamPlayer } from '@/components/NativeStreamPlayer';
import { Media3LivePlayer } from '@/components/Media3LivePlayer';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const FITS = [
  { value: 'contain' as const, label: 'Fit' },
  { value: 'cover' as const, label: 'Fill' },
  { value: 'fill' as const, label: 'Stretch' },
];
const USES_NATIVE_VLC = Platform.OS === 'android';
const VLC_TRACE = '[SV-VLC-TRACE]';

type ChannelEntry = {
  url: string;
  title: string;
  epgId: string;
  logo?: string;
  channelId?: string;
  num?: number;
  groupTitle?: string;
  tvArchive?: number;
  tvArchiveDuration?: number;
};

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
  onScrubStart,
  onScrubEnd,
}: {
  currentTime: number;
  duration: number;
  insetBottom: number;
  onSeek: (t: number) => void;
  /** Called when the user begins dragging — caller should enable scrubbing mode. */
  onScrubStart?: () => void;
  /** Called when the drag ends or is cancelled — caller should disable scrubbing mode. */
  onScrubEnd?: () => void;
}) {
  const durationRef    = useRef(duration);
  const onSeekRef      = useRef(onSeek);
  const onScrubStartRef = useRef(onScrubStart);
  const onScrubEndRef   = useRef(onScrubEnd);
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { durationRef.current    = duration;    }, [duration]);
  useEffect(() => { onSeekRef.current      = onSeek;      }, [onSeek]);
  useEffect(() => { onScrubStartRef.current = onScrubStart; }, [onScrubStart]);
  useEffect(() => { onScrubEndRef.current   = onScrubEnd;   }, [onScrubEnd]);
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
      onScrubStartRef.current?.();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })
    .onUpdate((e) => {
      if (durationRef.current <= 0) return;
      setScrubFrac(clamp(e.x / Math.max(trackW.current, 1)));
    })
    .onEnd((e) => {
      const frac = clamp(e.x / Math.max(trackW.current, 1));
      setScrubbing(false);
      onScrubEndRef.current?.();
      onSeekRef.current(frac * durationRef.current);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })
    .onFinalize(() => {
      setScrubbing(false);
      onScrubEndRef.current?.();
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
    /** 'true' when launched from the Home tab's recently-watched rail.  Tells
     *  the Back handler to do the Live TV category handoff even when
     *  channelsJson is also present (for prev/next navigation). */
    fromHome?: string;
    /** Route-scoped proof that this live route is borrowing Live TV's mounted VLC surface. */
    nativeSurfaceHandoffId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isLive = params.type === 'live';
  const isCatchup = params.type === 'catchup';
  const usesNativeMedia3Live = Platform.OS === 'android' && isLive;
  // This route param is synchronous. It is the only safe first-render signal
  // that Live TV has already mounted the Android VLC TextureView and is handing
  // it to this controls-only route. Do not wait for context state/effects before
  // deciding whether to show a loading screen — doing so produces a black
  // "Connecting to stream" flash over a healthy persistent surface.
  const nativeSurfaceHandoffId = typeof params.nativeSurfaceHandoffId === 'string'
    ? params.nativeSurfaceHandoffId
    : null;
  const hasPersistentNativeSurfaceHandoff =
    usesNativeMedia3Live
    && isLive
    && nativeSurfaceHandoffId !== null;
  const startAtSecs = params.startAt ? parseFloat(params.startAt) : 0;
  const knownDurationSecs = params.knownDuration ? parseFloat(params.knownDuration) : 0;
  // Catch-up seek regeneration fields (undefined for non-catch-up streams)
  const catchupStreamId = params.catchupStreamId ?? '';
  const catchupServerStart = params.catchupServerStart ?? '';
  const catchupStartTimestamp = params.catchupStartTimestamp ? parseInt(params.catchupStartTimestamp, 10) : 0;

  // Tracks the URL currently loaded in the player so the cast hook can
  // reload the correct stream when the user switches channels.
  const [activeUrl, setActiveUrl] = useState(params.url);
  // Source-of-truth URL for retry/reconnect paths.
  const activeUrlRef = useRef(params.url);

  const { credentials, setLastWatchedUrl } = useAppContext();
  const isXtream = credentials?.type === 'xtream';
  const xmltvUrl = isXtream ? getXtreamXmltvUrl(buildCreds(credentials)) : null;

  // ── Channel list for prev/next navigation ────────────────────────────────
  // Mutable state so the channel-menu can update the zap list when the viewer
  // picks a channel from a different category (keeps prev/next consistent).
  const [channelList, setChannelList] = useState<ChannelEntry[]>(() => {
    try { return JSON.parse(params.channelsJson ?? '[]'); } catch { return []; }
  });

  const [channelIdx, setChannelIdx] = useState(() => parseInt(params.channelIndex ?? '-1'));
  // Derived ID for the currently-playing channel — updates when zapping.
  const activeChannelId = channelList[channelIdx]?.channelId ?? (params.channelId as string | undefined) ?? '';

  // Active channel state — updates when navigating prev/next
  const [activeTitle, setActiveTitle] = useState(params.title);
  const [activeLogo, setActiveLogo] = useState<string>(params.logo as string ?? '');
  const [activeEpgId, setActiveEpgId] = useState(params.epgId ?? '');
  // Channel number shown in the fullscreen OSD — updates on every channel switch.
  const [activeChannelNum, setActiveChannelNum] = useState<number | undefined>(
    () => channelList[parseInt(params.channelIndex ?? '-1', 10)]?.num,
  );
  // Mutable ref to showInfoBar — lets switchChannel (declared before showInfoBar
  // in this file) call it without a stale closure or circular hook dependency.
  const showInfoBarRef = useRef<((userInvoked?: boolean) => void) | null>(null);
  // The persistent live-TV fullscreen route is controlled by the same OSD
  // controls row. Keep an imperative opener for the raw Fire TV Select fallback
  // without coupling it to the VLC surface or its lifecycle.
  const showTvLiveControlsRef = useRef<() => void>(() => {});
  // Tracks whether the OSD is currently visible because the user explicitly
  // pressed OK (true) or because it was auto-shown on entry / channel switch
  // (false).  Auto-shown OSD dismisses after 5 s; user-invoked OSD stays until
  // the user explicitly closes it with OK or BACK.
  const infoBarUserInvokedRef = useRef(false);

  // Wrap-around channel navigation: at the first channel LEFT wraps to the last,
  // at the last channel RIGHT wraps to the first — standard IPTV behaviour.
  // Both are null only when the list has 0 or 1 entries (no valid zap target).
  const _chN = channelList.length;
  const prevChannel = _chN > 1 ? channelList[(channelIdx - 1 + _chN) % _chN] : null;
  const nextChannel = _chN > 1 ? channelList[(channelIdx + 1) % _chN] : null;

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
  // A persistent VLC handoff is already presenting video in the mini-player.
  // Starting this route in buffering state would briefly paint its opaque
  // loading layer over that live texture before the effect below can clear it.
  const [isBuffering, setIsBuffering] = useState(() => !hasPersistentNativeSurfaceHandoff);
  const [vlcReloadKey, setVlcReloadKey] = useState(0);
  const [vlcSeekPosition, setVlcSeekPosition] = useState<number | undefined>();
  const reloadNativeVlc = useCallback((url = activeUrlRef.current) => {
    activeUrlRef.current = url;
    setActiveUrl(url);
    setVlcReloadKey((key) => key + 1);
  }, []);

  // ── Auto-reconnect state (live streams only) ──────────────────────────────
  const MAX_RECONNECTS = 5;
  const RECONNECT_DELAY_MS = 3000;
  // If a stream hasn't signalled readyToPlay after this many ms, surface it
  // as an error rather than leaving the user on a permanently blank screen.
  // Live streams get 15 s (CDN edge start-up); VOD/catchup get 20 s
  // (larger initial segments).  Not active during reconnect/URL-resolve phases.
  const BUFFER_TIMEOUT_MS = isLive ? 15_000 : 20_000;
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isResolvingUrl, setIsResolvingUrl] = useState(false); // #137: silent URL re-resolve in progress
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  // #69: which catchup URL format is currently being tried (0 = Format B, 1 = Format A fallback)
  const catchupFormatRef = useRef(0);
  // Keep refs in sync so the statusChange closure always reads the latest values
  useEffect(() => { reconnectAttemptRef.current = reconnectAttempt; }, [reconnectAttempt]);
  const { width: screenWidth } = useWindowDimensions();
  const [currentTime, setCurrentTime] = useState(0);
  // Seed with the known programme duration so catch-up scrubber works immediately
  // even when the timeshift stream doesn't expose its duration to expo-video.
  const [duration, setDuration] = useState(knownDurationSecs > 0 ? knownDurationSecs : 0);
  const [showControls, setShowControls] = useState(false);
  // A mini-player handoff already has moving video beneath this controls-only
  // route. Start its TV overlay hidden so the first OK explicitly opens it.
  const [showInfo, setShowInfo] = useState(() => !hasPersistentNativeSurfaceHandoff);
  // Ref so BackHandler closure can read showInfo without going stale
  const showInfoRef = useRef(showInfo);
  useEffect(() => { showInfoRef.current = showInfo; }, [showInfo]);

  // Picker-open refs — used by the OSD auto-dismiss timer to avoid hiding the
  // info bar while a picker is still on screen.  Doing so would unmount the
  // Audio / CC chips that the picker's close-path tries to re-focus, stranding
  // D-pad focus on TV.  The useEffect syncs are placed after the showAudioPicker
  // / showSubPicker useState declarations further below to satisfy TS TDZ rules.
  const showAudioPickerRef = useRef(false);
  const showSubPickerRef   = useRef(false);

  // Trailing hide-timer for dismissInfoBar — stored so showInfoBar can cancel
  // it if the user re-opens the OSD during the 320 ms fade-out window.
  // Without this, setShowInfo(false) fires after showInfoBar already set it
  // true, immediately collapsing the bar the user just opened.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref so BackHandler closure can read showControls without going stale
  const showControlsRef = useRef(false);
  useEffect(() => { showControlsRef.current = showControls; }, [showControls]);
  // ── Channel menu overlay (TV Live TV only) ────────────────────────────────
  const [showChannelMenu, setShowChannelMenu] = useState(false);
  const showChannelMenuRef = useRef(false);
  useEffect(() => { showChannelMenuRef.current = showChannelMenu; }, [showChannelMenu]);
  // TV: callback ref filled by LiveChannelMenu so D-pad zone onFocus handlers
  // can push focus back inside the overlay without a forwardRef chain.
  const channelMenuFocusRef = useRef<(() => void) | null>(null);
  // Ref to block spurious onFocus channel-switch on initial TV mount
  const tvNavReadyRef = useRef(false);
  const tvCenterRef = useRef<View>(null);
  const tvLiveChannelControlRef = useRef<View>(null);
  const tvLiveAudioControlRef = useRef<View>(null);
  const tvLiveCcControlRef = useRef<View>(null);
  const tvLiveBackControlRef = useRef<View>(null);
  const tvLiveControlsOpeningRef = useRef(false);
  // Set to true by the D-pad zone onFocus handlers when a wrap-around channel
  // switch is about to fire (ch 0 → last, or last → ch 0).  Read by the
  // useEffect([channelIdx]) below to extend the focus-restoration delay from
  // 600 ms to 900 ms — wrap-around switches involve a larger jump in the stream
  // URL list and can trigger a longer ExoPlayer audio-focus handoff cycle.
  const wrapAroundPendingRef = useRef(false);
  // TV VOD focus management refs
  const tvVodIdleRef   = useRef<View>(null); // catch-all when controls are hidden
  const tvPlayBtnRef   = useRef<View>(null); // play/pause button (focused when controls appear)
  const tvScrubAnchorRef = useRef<View>(null); // focusable scrubber progress bar
  // D-pad LEFT/RIGHT moves native focus through invisible bounce targets before
  // immediately returning to the scrubber. Keep its visible focus treatment
  // latched through that handoff so the border and thumb do not flash.
  const [tvScrubFocused, setTvScrubFocused] = useState(false);
  const tvScrubBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTvScrubFocus = useCallback(() => {
    if (tvScrubBlurTimerRef.current) {
      clearTimeout(tvScrubBlurTimerRef.current);
      tvScrubBlurTimerRef.current = null;
    }
    setTvScrubFocused(true);
  }, []);
  const deferTvScrubFocusClear = useCallback(() => {
    if (tvScrubBlurTimerRef.current) clearTimeout(tvScrubBlurTimerRef.current);
    // A bounce target receives focus immediately after the anchor blurs. Give
    // it enough time to cancel this clear, but remove the treatment promptly
    // when the viewer really moves to another player control.
    tvScrubBlurTimerRef.current = setTimeout(() => {
      tvScrubBlurTimerRef.current = null;
      setTvScrubFocused(false);
    }, 140);
  }, []);
  useEffect(() => () => {
    if (tvScrubBlurTimerRef.current) clearTimeout(tvScrubBlurTimerRef.current);
  }, []);
  const tvSeekBackRef  = useRef<View>(null); // hidden D-pad-left  bounce target → seek −10 s
  const tvSeekFwdRef   = useRef<View>(null); // hidden D-pad-right bounce target → seek +10 s
  const tvSeek30BackRef = useRef<View>(null); // visible −30 s button — wired nextFocusDown→scrubber
  const tvSeek30FwdRef  = useRef<View>(null); // visible +30 s button — wired nextFocusDown→scrubber

  // ── TV channel-switch preview overlay ────────────────────────────────────
  // Shown for ~1 s when the user presses D-pad left/right so they can see
  // which channel is coming before the stream actually switches.
  const [tvPreviewChannel, setTvPreviewChannel] = useState<ChannelEntry | null>(null);
  /** Current EPG programme airing on the preview channel — shown on the zap card. */
  const [tvPreviewNowProg, setTvPreviewNowProg] = useState<EpgProgram | null>(null);
  // Tracks which TV navigation zone (left / center / right) currently holds
  // D-pad focus so we can show a visible directional indicator.
  const [tvZoneFocused, setTvZoneFocused] = useState<'left' | 'center' | 'right' | null>(null);
  // True once the user has switched channel at least once — suppresses the
  // full-screen "Connecting to stream" interstitial on live zaps so channel
  // changes show nothing but the video surface (initial open still shows it).
  const [hasZapped, setHasZapped] = useState(false);
  const [tvPreviewDir, setTvPreviewDir] = useState<'prev' | 'next' | null>(null);
  const tvPreviewOpacity = useRef(new Animated.Value(0)).current;
  const tvPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonically-incrementing counter that gates the zap onCommit call.
  // Captured at the start of showTvChannelPreview and checked in the
  // Animated.timing completion callback — if the value has changed (because
  // the channel list was replaced while the fade-out animation was running),
  // the callback exits without calling onCommit/switchChannel.
  const zapGenRef = useRef(0);
  const [nowTs, setNowTs] = useState(Date.now());
  /** 'back' | 'forward' | null — brief double-tap seek visual indicator */
  const [doubleTapSide, setDoubleTapSide] = useState<'back' | 'forward' | null>(null);
  const doubleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Settings state ────────────────────────────────────────────────────────
  const [showSettings, setShowSettings] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showSubPicker, setShowSubPicker] = useState(false);
  // Sync picker-open refs declared above (after state to satisfy TS TDZ rules).
  useEffect(() => { showAudioPickerRef.current = showAudioPicker; }, [showAudioPicker]);
  useEffect(() => { showSubPickerRef.current   = showSubPicker;   }, [showSubPicker]);
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
    StorageService.getPrefPlaybackSpeed().then((v) => { if (v !== null) setSpeed(v); }).catch(() => {});
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
            if (USES_NATIVE_VLC) reloadNativeVlc();
            else try { player.replace(activeUrlRef.current); player.play(); } catch {}
          }
        } else if (hasErrorRef.current) {
          // #31: VOD/series — if an error was suppressed while backgrounded,
          // retry playback on foreground return instead of showing the error screen.
          setHasError(false);
          hasErrorRef.current = false;
          setIsBuffering(true);
          if (USES_NATIVE_VLC) reloadNativeVlc();
          else try { player.replace(activeUrlRef.current); player.play(); } catch {}
        }
      }
    });
    return () => sub.remove();
  }, [isLive, isWeb, reloadNativeVlc]); // eslint-disable-line react-hooks/exhaustive-deps -- player declared after these effects; closure always has the current instance

  // Keep hasErrorRef in sync with hasError state
  useEffect(() => { hasErrorRef.current = hasError; }, [hasError]);

  // ── Connection timeout ───────────────────────────────────────────────────
  // If a stream doesn't emit readyToPlay within BUFFER_TIMEOUT_MS, surface it
  // as an error.  Without this the player shows a permanently blank screen.
  // The effect is inactive during reconnect and URL-resolve phases; those
  // already have their own retry timers (MAX_RECONNECTS × RECONNECT_DELAY_MS).
  useEffect(() => {
    if (!isBuffering || isReconnecting || isResolvingUrl || hasError || isWeb) return;
    const t = setTimeout(() => {
      setErrorMsg('Connection timed out');
      setHasError(true);
      setIsBuffering(false);
    }, BUFFER_TIMEOUT_MS);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBuffering, isReconnecting, isResolvingUrl, hasError, isWeb, isLive]);

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
          if (USES_NATIVE_VLC) reloadNativeVlc();
          else try { player.replace(activeUrlRef.current); player.play(); } catch {}
        }
      } catch {
        // expo-network unavailable — ignore
      }
    }, 3000);

    return () => clearInterval(poll);
  }, [isLive, isWeb, hasError, isReconnecting, reloadNativeVlc]); // eslint-disable-line react-hooks/exhaustive-deps -- player declared after these effects; closure always has the current instance

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
      if (USES_NATIVE_VLC) reloadNativeVlc();
      else try { player.replace(activeUrlRef.current); player.play(); } catch {}
    }, 10_000);
    return () => clearInterval(t);
  }, [isLive, hasError, isWeb, reloadNativeVlc]); // eslint-disable-line react-hooks/exhaustive-deps -- player declared after these effects; closure always has the current instance

  // Refs so interval / unmount callbacks can read latest values without stale closures
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const didInitialSeekRef = useRef(false);
  // Stores the programme offset (seconds) that the catch-up wall-clock timer should
  // count from.  Updated on every seek so the timer survives isPlaying re-runs.
  const catchupSeekOffsetRef = useRef(0);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  /**
   * Mirrors the recovery decisions from Expo's status-error listener for the
   * Android VLC renderer. VLC owns Android decoding, so every successful
   * recovery reloads its source state instead of starting ExoPlayer.
   */
  const handleNativeVlcError = useCallback(() => {
    setIsBuffering(false);
    setErrorMsg('VLC could not open this stream.');

    // Catch-up Format B failed: reopen the provider's Format A URL at the
    // current programme offset before surfacing an error.
    if (
      isCatchup &&
      catchupFormatRef.current === 0 &&
      catchupStreamId &&
      catchupServerStart &&
      catchupStartTimestamp > 0 &&
      credentials?.type === 'xtream'
    ) {
      catchupFormatRef.current = 1;
      const seekSecs = Math.floor(catchupSeekOffsetRef.current);
      const remainingSecs = Math.max(60, knownDurationSecs - seekSecs);
      const newDurationMins = Math.ceil(remainingSecs / 60);
      const newStartTs = catchupStartTimestamp + seekSecs;
      const newServerStart = addSecondsToServerTime(catchupServerStart, seekSecs);
      const urls = getXtreamCatchupUrls(
        { host: credentials.host!, username: credentials.username!, password: credentials.password! },
        catchupStreamId,
        newServerStart,
        newDurationMins,
        newStartTs,
      );
      setHasError(false);
      setIsBuffering(true);
      reloadNativeVlc(urls[1]);
      return;
    }

    // Live providers can rotate channel stream URLs. Re-resolve once before
    // the regular foreground/network retry paths fall back to the old URL.
    if (isLive && activeChannelIdRef.current && !didResolveStaleUrlRef.current) {
      didResolveStaleUrlRef.current = true;
      setIsResolvingUrl(true);
      setIsReconnecting(true);
      setIsBuffering(true);
      const channelId = activeChannelIdRef.current;
      const session = resolveSessionRef.current;

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
            freshUrl = streams.find((channel) => channel.id === channelId)?.streamUrl;
          } else if (creds?.m3uUrl) {
            const parsed = await fetchAndParseM3U(creds.m3uUrl);
            freshUrl = parsed.channels.find((channel) => channel.id === channelId)?.streamUrl;
          }

          if (session !== resolveSessionRef.current) return;
          if (freshUrl && freshUrl !== activeUrlRef.current) {
            setHasError(false);
            setIsResolvingUrl(false);
            setIsReconnecting(false);
            setReconnectAttempt(0);
            reconnectAttemptRef.current = 0;
            setIsBuffering(true);
            reloadNativeVlc(freshUrl);
            return;
          }
        } catch {
          // The regular retry paths below will retry the current source.
        }

        if (session !== resolveSessionRef.current) return;
        setIsResolvingUrl(false);
        setIsReconnecting(false);
        if (!isBackgroundRef.current) setHasError(true);
      })();
      return;
    }

    if (!isBackgroundRef.current) setHasError(true);
  }, [
    isCatchup,
    catchupStreamId,
    catchupServerStart,
    catchupStartTimestamp,
    credentials,
    knownDurationSecs,
    isLive,
    reloadNativeVlc,
  ]);

  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const infoOpacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progBoundaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── EPG ──────────────────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => {
      const previous = queryClient.getQueryData<Map<string, EpgProgram[]>>(['xmltv-epg', credentials]);
      return fetchAndParseXmltv(xmltvUrl!, signal, previous);
    },
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

  // Programme-boundary timer — fires exactly when the current programme ends so
  // currentProg/nextProg update immediately without waiting for the 60 s tick.
  // Re-runs whenever currentProg changes (channel switch, EPG refresh, or the
  // previous boundary timer firing and bumping nowTs).
  useEffect(() => {
    if (progBoundaryTimerRef.current) { clearTimeout(progBoundaryTimerRef.current); progBoundaryTimerRef.current = null; }
    if (!currentProg) return;
    const msLeft = currentProg.end.getTime() - Date.now();
    if (msLeft <= 0) return; // already past end; 60 s tick will handle stale slot
    progBoundaryTimerRef.current = setTimeout(() => {
      setNowTs(Date.now()); // bumps nowTs → useMemo recomputes → bar updates
    }, msLeft + 1_000); // +1 s buffer ensures the next slot has definitely started
    return () => {
      if (progBoundaryTimerRef.current) { clearTimeout(progBoundaryTimerRef.current); progBoundaryTimerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProg]); // re-schedules whenever the active programme object changes

  // ── Video player ─────────────────────────────────────────────────────────
  // For VOD/series: a local player created here (null source when live so it
  // doesn't waste resources).
  const localPlayer = useVideoPlayer(isLive || isWeb || USES_NATIVE_VLC ? null : params.url, (p) => {
    p.loop = false;
    p.muted = false;
    p.volume = 1;
    // NOTE: do NOT set scrubbingModeOptions.scrubbingModeEnabled here. On
    // Android, enabling scrubbing mode SUPPRESSES playback (it's designed to
    // be toggled on only while the user drags a seek bar, then off again).
    // A previous line here enabled it permanently, which silently blocked
    // VOD/series autoplay. Default (false) gives normal playback.
    if (!isWeb) p.play();
  });

  // For live TV: the shared player from context (already streaming from the
  // mini-player — reusing it means zero buffering gap on fullscreen entry).
  const {
    player: sharedPlayer,
    activeUrlRef: liveUrlRef,
    setNativeSurfaceUrl,
    reloadNativeSurface,
    nativeSurfaceHandoff,
    updateNativeSurfaceHandoffUrl,
    endNativeSurfaceHandoff,
    transitionNativeSurface,
    triggerCollapse,
    notifyPlayerReady,
  } = useLivePlayer();
  // When Live TV already owns this Android stream, this route is controls-only.
  // The visual surface mode changes to `mini` before BACK removes this route,
  // so ownership must outlive the visual mode. A route-scoped handoff ID avoids
  // treating a retained URL as ownership: direct Home/recently-watched launches
  // have no ID and must mount their own VLC renderer.
  //
  // NOTE: we intentionally check nativeSurfaceHandoffId (from route params) rather
  // than comparing it against the context's nativeSurfaceHandoff?.id (React state).
  // The context state is set by beginNativeSurfaceHandoff() just before navigate()
  // is called, but React may not have committed that update by the time this route
  // renders — particularly when nativeSurfaceTransitionRef has no handler and
  // onComplete() fires in a single rAF (~16 ms).  Reading from params is always
  // synchronous and race-free.  The semantics are identical: a non-null param ID
  // means this route was explicitly opened as a handoff from the Live TV tab.
  const usesPersistentNativeSurface = hasPersistentNativeSurfaceHandoff;

  useEffect(() => {
    console.log(VLC_TRACE, 'player-route-mount', {
      live: isLive,
      persistentSurface: usesPersistentNativeSurface,
      handoffId: nativeSurfaceHandoffId ?? null,
      urlLength: params.url?.length ?? 0,
    });
    return () => {
      console.log(VLC_TRACE, 'player-route-unmount', {
        persistentSurface: usesPersistentNativeSurface,
        handoffId: nativeSurfaceHandoffId ?? null,
      });
    };
  }, [isLive, nativeSurfaceHandoffId, params.url, usesPersistentNativeSurface]);

  useEffect(() => () => {
    if (nativeSurfaceHandoffId) endNativeSurfaceHandoff(nativeSurfaceHandoffId);
  }, [endNativeSurfaceHandoff, nativeSurfaceHandoffId]);

  // Controls the direct-launch renderer. A Live TV handoff never mounts this
  // renderer: its persistent VLC child remains owned by the Live TV container.
  const [videoMounted, setVideoMounted] = useState(true);
  // Fire TV can report a quick repeated BACK press while the first press is
  // collapsing. Keep the transparent player route alive until the single native
  // VLC surface has reached the mini-player bounds.
  const persistentSurfaceBackInFlightRef = useRef(false);

  // The player this screen actually uses:
  const player = isLive ? sharedPlayer : localPlayer;
  // Android Live TV uses the workspace-owned Media3 bridge. Android VOD and
  // catch-up continue through their existing VLC component until they have a
  // separately validated replacement path.
  const PlaybackRenderer: React.ComponentType<any> = usesNativeMedia3Live
    ? Media3LivePlayer
    : NativeStreamPlayer;

  // Ensure the correct URL is loaded in the shared player when opening fullscreen.
  // If liveUrlRef matches params.url the stream is already running — don't restart.
  useEffect(() => {
    if (!isLive || isWeb) return;
    if (usesNativeMedia3Live) {
      if (isLive) {
        liveUrlRef.current = params.url;
        setNativeSurfaceUrl(params.url);
        if (nativeSurfaceHandoffId) {
          updateNativeSurfaceHandoffUrl(nativeSurfaceHandoffId, params.url);
        }
      }
      setActiveUrl(params.url);
      setVlcReloadKey((key) => key + 1);
    } else if (USES_NATIVE_VLC) {
      liveUrlRef.current = params.url;
      cancelRemindersForActiveChannel({ channelId: params.channelId, epgId: params.epgId });
      return;
    }
    if (liveUrlRef.current === params.url) {
      // #138: always allow a fresh stale-URL re-resolve attempt when entering
      // fullscreen, even if the URL matches (stream may already be failing).
      didResolveStaleUrlRef.current = false;
      // First-channel bug: the tab's loader writes liveUrlRef BEFORE its async
      // replaceAsync commits, so on the very first watch this branch can run
      // while the shared player has no source loaded yet ('idle') or a failed
      // one ('error'). In that state play() alone does nothing — force a
      // synchronous replace so the stream always starts. When the stream is
      // already loading/playing (mini-player expand) we leave it untouched.
      try {
        const st = (player as any).status;
        if (!player.playing && (st === 'idle' || st === 'error')) {
          player.replace(params.url);
          player.play();
        } else if (!player.playing) {
          player.play();
        }
        // Stuck-"Connecting" fix: this screen mounts with isBuffering=true and
        // relies on a readyToPlay event to clear it. When the shared player is
        // ALREADY ready/playing (mini-player expand), no new event fires — the
        // overlay would sit on top of a healthy stream forever. Clear it now
        // based on the player's current state instead of a future event.
        if (player.playing || st === 'readyToPlay') {
          setIsBuffering(false);
        }
      } catch {}
    } else {
      liveUrlRef.current = params.url;
      try { player.replace(params.url); player.play(); } catch {}
    }
    // Cancel any reminder whose programme is currently airing on this channel —
    // the user is already watching, so the notification would be redundant.
    // Pass both channelId and epgId: they can differ on some providers.
    cancelRemindersForActiveChannel({ channelId: params.channelId, epgId: params.epgId });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persistent VLC handoff (Android/Fire TV mini→fullscreen): the mini-player's
  // VLC surface is already streaming — this route is controls-only.  Clear the
  // loading state immediately so the "Connecting to stream" overlay never covers
  // a healthy live stream.  A separate effect (not the [] one) handles this so
  // it fires reliably even if context commits after the initial mount.
  useEffect(() => {
    if (!usesPersistentNativeSurface || !isLive) return;
    setIsBuffering(false);
    setIsPlaying(true);
  }, [usesPersistentNativeSurface, isLive]);

  useEffect(() => {
    if (isWeb || USES_NATIVE_VLC || !player) return;
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
              // Never force an Expo/ExoPlayer audio-track assignment. Some
              // MPEG transport streams expose a track descriptor that cannot
              // safely be selected, which prevents the whole video source from
              // starting. Android uses the VLC renderer for those streams.
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

  const switchChannel = useCallback((entry: ChannelEntry, newIdx: number, isWrapAround = false) => {
    // Signal the post-switch focus-restoration useEffect to use the extended
    // 900 ms delay for wrap-around switches (ch 0 → last or last → ch 0).
    // Must be set here — before player.replace() — so the flag is readable when
    // the useEffect fires after the channelIdx state update.
    wrapAroundPendingRef.current = isWrapAround;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setChannelIdx(newIdx);
    setActiveTitle(entry.title);
    setActiveLogo(entry.logo ?? '');
    setActiveEpgId(entry.epgId);
    setActiveChannelNum(entry.num);
    setActiveUrl(entry.url);   // keeps cast hook in sync with the new stream
    // Keep fullscreen on the already-mounted mini-player VLC surface while
    // the tab receives channel:switched and replaces its source.
    if (usesPersistentNativeSurface && nativeSurfaceHandoffId) {
      setNativeSurfaceUrl(entry.url);
      updateNativeSurfaceHandoffUrl(nativeSurfaceHandoffId, entry.url);
    }
    // Notify the Live TV tab with the complete channel identity. Resolving the
    // return state by URL alone is unsafe when providers reuse a URL or refresh
    // their channel catalogue while fullscreen is open.
    {
      const { DeviceEventEmitter } = require('react-native');
      const switchedChannel: Channel = {
        id: entry.channelId ?? entry.url,
        name: entry.title,
        logo: entry.logo ?? '',
        streamUrl: entry.url,
        epgId: entry.epgId,
        groupTitle: entry.groupTitle ?? '',
        num: entry.num,
        tvArchive: entry.tvArchive,
        tvArchiveDuration: entry.tvArchiveDuration,
      };
      DeviceEventEmitter.emit('channel:switched', {
        url: entry.url,
        channel: switchedChannel,
      });
    }
    activeUrlRef.current = entry.url; // keep ref in sync so reconnect targets the right channel
    setIsBuffering(true);
    setHasError(false);
    setErrorMsg('');
    // Dismiss the live controls bar on channel switch — the new stream starts
    // clean and focus returns to the centre zone via the channelIdx useEffect.
    setShowControls(false);
    controlsOpacity.setValue(0);
    // No auto-OSD on channel switch (user request: nothing on screen while
    // zapping — just load the channel).  The viewer can press OK to open the
    // info bar; if it's already pinned open (userInvoked mode), its content
    // updates automatically via state changes.
    // Mark that a zap happened so the "Connecting to stream" interstitial is
    // suppressed for this and all further live switches this session.
    if (isLive) setHasZapped(true);
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
    setVlcSeekPosition(undefined);
    didInitialSeekRef.current = false;
    if (USES_NATIVE_VLC) {
      if (isLive) liveUrlRef.current = entry.url;
      setVlcReloadKey((key) => key + 1);
    } else {
      try {
        if (isLive) liveUrlRef.current = entry.url; // keep shared ref in sync
        player.replace(entry.url);
        player.play();
      } catch {}
    }
    // TV: relocate focus to the center zone at 150 ms so the remote cursor
    // is never stranded during the brief gap before the useEffect([channelIdx])
    // fires at 600 ms.  Critical at channel boundaries where the adjacent
    // left/right focus zone becomes non-focusable immediately after the switch
    // (e.g. switching to channel 0 makes the left zone non-focusable).
    //
    // Wrap-around exception: when wrapAroundPendingRef is set the D-pad zone
    // has already signalled that the useEffect will use the extended 900 ms
    // delay.  Firing the 150 ms call here would race with ExoPlayer's longer
    // audio-focus handoff before that guard completes, creating exactly the
    // dead-zone this task is designed to prevent.  On the wrap path the
    // useEffect at 900 ms (plus the 950 ms zone belt-and-suspenders) is the
    // single authoritative focus restoration — skip the early call entirely.
    if (Platform.isTV && isLive && !wrapAroundPendingRef.current) {
      setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
    }
  }, [isLive, liveUrlRef, nativeSurfaceHandoffId, player, setLastWatchedUrl, setNativeSurfaceUrl, updateNativeSurfaceHandoffUrl, usesPersistentNativeSurface]);

  const navCooldownRef = useRef(false);
  // Timestamp of the moment the OSD info bar was hidden/unmounted.  When the
  // bar's focused chip unmounts, Fire OS spatially reassigns focus BEFORE our
  // explicit centre-focus call lands — and it can pick a side zap zone, which
  // switched channel "on its own" a few seconds after opening a channel.  The
  // side zones bounce (instead of zapping) for a short window after this time.
  const osdHiddenAtRef = useRef(0);
  const handlePrevChannel = useCallback(() => {
    if (!prevChannel || navCooldownRef.current) return;
    navCooldownRef.current = true;
    setTimeout(() => { navCooldownRef.current = false; }, 1200);
    const n = channelList.length;
    switchChannel(prevChannel, (channelIdx - 1 + n) % n, channelIdx === 0);
  }, [prevChannel, channelIdx, channelList, switchChannel]);

  const handleNextChannel = useCallback(() => {
    if (!nextChannel || navCooldownRef.current) return;
    navCooldownRef.current = true;
    setTimeout(() => { navCooldownRef.current = false; }, 1200);
    switchChannel(nextChannel, (channelIdx + 1) % channelList.length, channelIdx === channelList.length - 1);
  }, [nextChannel, channelIdx, channelList, switchChannel]);

  // ── Return to Live TV (live only) ───────────────────────────────────────
  // The persistent VLC surface stays mounted. Its owning preview container
  // returns to mini layout before the fullscreen controls route is removed.
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
    // Do not let a repeated BACK interrupt the parent-layout handoff and pop
    // the transparent fullscreen route before the persistent VLC surface is
    // visibly back in its mini-player container.
    if (usesPersistentNativeSurface && persistentSurfaceBackInFlightRef.current) return;
    // Immediately zero-out the controls and info bar so the persistent
    // container can return to mini layout without a competing surface.
    controlsOpacity.setValue(0);
    infoOpacity.setValue(0);
    setShowControls(false);
    setShowInfo(false);
    // Direct launches use the local renderer. Persistent Live TV handoffs do
    // not mount a second renderer and only change the owner's layout mode.
    setVideoMounted(false);
    // Always hand back the channel that is playing now, not the channel that
    // originally opened fullscreen. The Live TV screen remains mounted while
    // fullscreen is open, but its channel row can be virtualized or the user
    // may have zapped since launch. Persisting the current channel makes the
    // receiving screen select its category, scroll the list, and focus that row.
    const currentEntry = channelList[channelIdx];
    const returnChannel: Channel = {
      id:        currentEntry?.channelId ?? params.channelId ?? '',
      name:      activeTitle  ?? currentEntry?.title ?? params.title  ?? '',
      logo:      activeLogo   ?? currentEntry?.logo  ?? params.logo   ?? '',
      // The zapped entry is the complete source-of-truth for the fullscreen
      // player (URL and metadata came from the same item). Prefer it over the
      // shared ref so a delayed context update can never return a title/EPG
      // for one channel with the stream URL from another.
      streamUrl: currentEntry?.url || liveUrlRef.current || params.url || '',
      epgId:     activeEpgId  ?? currentEntry?.epgId ?? params.channelId ?? '',
      groupTitle: currentEntry?.groupTitle ?? params.groupTitle ?? '',
      num: currentEntry?.num,
      tvArchive: currentEntry?.tvArchive,
      tvArchiveDuration: currentEntry?.tvArchiveDuration,
    };
    // Store before emitting so the Live TV tab can recover even if it was
    // temporarily unmounted or has not yet regained route focus.
    setPendingLivePlayerReturn(returnChannel);
    const { DeviceEventEmitter: DEE } = require('react-native');
    DEE.emit('live:setPlayingChannel', returnChannel);

    // Android/Fire TV keeps the original mini-player VLC view alive. Shrink
    // that same native surface before removing this transparent controls route;
    // do not unmount or recreate a decoder for a normal BACK handoff.
    if (usesPersistentNativeSurface) {
      persistentSurfaceBackInFlightRef.current = true;
      const returnToLive = () => {
        // The container layout handoff is complete at this point. Restore
        // Fire TV focus only after the Live TV route becomes active again; the
        // nested VLC surface is deliberately not a focus target.
        if (Platform.isTV) DEE.emit('live:restore-preview-focus');
        if (params.groupTitle && (params.fromHome === 'true' || !params.channelsJson)) {
          StorageService.setPrefLiveCat(params.groupTitle!).catch(() => {});
          router.navigate('/');
        } else {
          router.back();
        }
      };
      transitionNativeSurface('mini', returnToLive);
      return;
    }

    // If launched from the Home screen (groupTitle present, and either fromHome
    // is explicitly set or no channelsJson was supplied), collapse to the
    // mini-player in the Live TV tab, pre-selecting the channel's category so
    // the user lands in the right place.  fromHome decouples this check from
    // channelsJson so prev/next navigation (#350) can coexist with the Back
    // handoff when both params are present.
    if (params.groupTitle && (params.fromHome === 'true' || !params.channelsJson)) {
      StorageService.setPrefLiveCat(params.groupTitle!).catch(() => {});
      triggerCollapse(() => router.navigate('/'));
      return;
    }
    triggerCollapse(() => router.back());
  }, [params.stopOnBack, params.groupTitle, params.channelsJson, params.fromHome,
      sharedPlayer, triggerCollapse, router, controlsOpacity, infoOpacity,
      transitionNativeSurface, usesPersistentNativeSurface,
      // Current channel state — stale params otherwise give the wrong channel on back
      channelList, channelIdx, activeTitle, activeLogo, activeEpgId, liveUrlRef]);

  /** Immediately hide the info bar — used by the Back-press dismiss flow. */
  const dismissInfoBar = useCallback(() => {
    infoBarUserInvokedRef.current = false;
    if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
    // Cancel any previously-scheduled trailing hide before scheduling a new one.
    // This prevents double-scheduling if dismissInfoBar is called twice quickly.
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
    Animated.timing(infoOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    // Track the trailing timer so showInfoBar can cancel it if the user
    // re-opens the OSD during the fade window.
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      osdHiddenAtRef.current = Date.now();
      setShowInfo(false);
    }, 320);
    // TV: restore D-pad focus to the centre zone BEFORE the OSD unmounts
    // (unmounting a focused chip lets Fire OS spatially reassign focus, which
    // can land on a zap zone and change channel), and again after as a backstop.
    // NEVER touch player-zone focus while the channel browser is open (or
    // about to open — Menu press dismisses the OSD right before mounting it):
    // competing focus commands across the two layers crashed the app on
    // Fire OS when the menu opened. All calls guarded — an exception inside
    // a bare setTimeout bypasses every ErrorBoundary and kills a release build.
    if (Platform.isTV && !showChannelMenuRef.current) {
      requestTvFocus(tvCenterRef.current)
      setTimeout(() => {
        if (showChannelMenuRef.current) return;
        requestTvFocus(tvCenterRef.current)
      }, 400);
    }
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
      setTimeout(() => requestTvFocus(audioChipRef.current), 80);
    }
  }, [controlsOpacity]);

  const hideLiveControls = useCallback(() => {
    Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    setTimeout(() => {
      setShowControls(false);
      // Return D-pad focus to the centre zone so OK works again immediately.
      if (Platform.isTV) {
        setTimeout(() => requestTvFocus(tvCenterRef.current), 50);
      }
    }, 320);
  }, [controlsOpacity]);

  // ── Android hardware back button (live TV only) ───────────────────────────
  // Contextual priority so BACK always does the most-local thing first:
  //   1. Channel menu open         → close menu
  //   2. Audio / CC picker open    → close picker
  //   3. OSD info bar visible      → dismiss info bar
  //   4. Controls bar visible      → dismiss controls bar
  //   5. Nothing open              → collapse to mini-player
  // Each level consumes the press (returns true); the next level only fires
  // if the current one has nothing to close.
  // Note: useBackHandler keeps handlerRef.current = handler on every render,
  // so all state values (showChannelMenu, showAudioPicker, showSubPicker)
  // are always fresh — no stale closure issues.
  useBackHandler(() => {
    if (showChannelMenuRef.current) { setShowChannelMenu(false); return true; }
    if (showAudioPicker) {
      setShowAudioPicker(false);
      // TV: the picker Modal intercepts BACK before onRequestClose fires, so
      // the Modal's own focus-restore is never reached.  Explicitly return
      // focus to the centre zone so the remote doesn't go silent after close.
      if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
      return true;
    }
    if (showSubPicker) {
      setShowSubPicker(false);
      if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
      return true;
    }
    if (showInfoRef.current) {
      dismissInfoBar();
      return true;
    }
    if (showControlsRef.current) {
      hideLiveControls();
      return true;
    }
    handleBackLive();
    return true;
  }, isLive && !isWeb && Platform.OS === 'android');

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
    const t = setTimeout(() => requestTvFocus(retryBtnRef.current), 100);
    return () => clearTimeout(t);
  }, [hasError]);

  // TV VOD: when controls hide, return D-pad focus to the transparent idle
  // tap-catcher so the next OK press shows controls again.  Mirrors the
  // tvCenterRef.focus() call in hideLiveControls() for the live case.
  useEffect(() => {
    if (!Platform.isTV || isLive || isWeb || hasError) return;
    if (!showControls) {
      const t = setTimeout(() => requestTvFocus(tvVodIdleRef.current), 80);
      return () => clearTimeout(t);
    }
  }, [showControls, isLive, isWeb, hasError]);

  // TV live: keep D-pad focus on the centre zone while a channel is loading so
  // the Back key always has a focusable target and the remote never freezes.
  // This fires on initial mount, on channel switch, and whenever isBuffering
  // re-enters true (e.g. after an auto-reconnect attempt).
  useEffect(() => {
    if (!Platform.isTV || !isLive || isWeb || !isBuffering || hasError) return;
    const t = setTimeout(() => requestTvFocus(tvCenterRef.current), 100);
    return () => clearTimeout(t);
  }, [isBuffering, isLive, isWeb, hasError]);

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
  useBackHandler(() => {
    if (showControlsRef.current) {
      // Dismiss controls: cancel the hide timer, fade out, then unmount.
      if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
      Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      setTimeout(() => {
        setShowControls(false);
        // Return TV focus to the idle catch-all so the next OK press
        // can show controls again.
        if (Platform.isTV) {
          setTimeout(() => requestTvFocus(tvVodIdleRef.current), 50);
        }
      }, 320);
      return true; // consumed — do not navigate back
    }
    // Controls already hidden — save progress and navigate back.
    handleBack();
    return true;
  }, !isLive && !isWeb && Platform.OS === 'android');

  // ── Firestick / Android TV media key bindings ────────────────────────────
  // Handles Play/Pause, Channel Up/Down (live), and FF/RW (VOD/catchup).
  // useTVRemote gates the subscription on screen focus so it never fires
  // while a different screen (Guide, Movies, etc.) is in the foreground.
  // D-pad navigation (UP/DOWN/LEFT/RIGHT) and BACK are handled separately by
  // the native spatial-focus engine and BackHandler respectively.
  useTVRemote({
    onPlayPause: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1) return; // act on key-up (confirmed press)
      // If controls are hidden on VOD, show them first (same as an OK press).
      if (!showControlsRef.current && !isLive) {
        showVodControls();
        return;
      }
      togglePlay();
    },
    onChannelUp: ({ eventKeyAction }) => {
      // Channel Up = next channel in the list (higher index).
      if (eventKeyAction !== 1 || !isLive) return;
      handleNextChannel();
    },
    onChannelDown: ({ eventKeyAction }) => {
      // Channel Down = previous channel in the list (lower index).
      if (eventKeyAction !== 1 || !isLive) return;
      handlePrevChannel();
    },
    // D-pad UP/DOWN → channel zap on live TV. These fire through the
    // onHWKeyEvent fallback when the spatial engine has no focus target
    // above/below the centre zone. The info bar stays visible while zapping;
    // only modal overlays (channel browser and Audio/CC pickers) own the
    // D-pad exclusively.
    up: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || !isLive) return;
      // The OSD owns every D-pad direction while its controls are visible.
      // Do not let the raw fallback zap channels when spatial focus is moving
      // between its buttons.
      if (showInfoRef.current || showChannelMenuRef.current || showAudioPickerRef.current || showSubPickerRef.current) return;
      handleNextChannel();
    },
    down: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || !isLive) return;
      if (showInfoRef.current || showChannelMenuRef.current || showAudioPickerRef.current || showSubPickerRef.current) return;
      handlePrevChannel();
    },
    select: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || !isLive || showInfoRef.current) return;
      if (showChannelMenuRef.current || showAudioPickerRef.current || showSubPickerRef.current) return;
      // Native Pressable activation normally handles Select. This is the
      // Firestick raw-key fallback when focus remains on the full-screen centre
      // zone after a transition.
      showTvLiveControlsRef.current();
    },
    onFastForward: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || isLive) return;
      seek(30);
    },
    onRewind: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || isLive) return;
      seek(-30);
    },
    // Menu / hamburger button → toggle the channel browser overlay.
    // Opening: close OSD first so the full screen is available for the menu.
    // Closing: focus is restored by the useEffect([showChannelMenu]) below,
    // which fires regardless of whether a channel was selected.
    onMenu: ({ eventKeyAction }) => {
      if (eventKeyAction !== 1 || !isLive) return;
      if (showChannelMenuRef.current) {
        setShowChannelMenu(false);
      } else {
        // Mark the menu as open BEFORE dismissing the OSD so every focus
        // path inside dismissInfoBar sees showChannelMenuRef=true and stays
        // away from the player layer (competing focus commands crashed the
        // app on Fire OS when the browser opened).
        showChannelMenuRef.current = true;
        if (showInfoRef.current) dismissInfoBar();
        setShowChannelMenu(true);
      }
    },
  });

  // ── Channel menu: select channel + update zap list ───────────────────────
  // Called when the viewer picks a channel from the LiveChannelMenu overlay.
  // Updates the zap list (so prev/next navigation reflects the menu's filter)
  // then switches the stream without leaving the player.
  const handleMenuSelectChannel = useCallback(
    (entry: MenuChannelEntry, idx: number, newList: MenuChannelEntry[]) => {
      // Synchronously cancel any in-flight zap-preview commit BEFORE updating
      // the channel list or switching streams.  The passive useEffect([channelList])
      // is React-deferred and may not run until after the Animated.timing
      // completion callback — if the 250 ms timeout had already fired the
      // gen-check is the only guard, so we must advance it here, right now,
      // while we are still synchronous.  clearTimeout covers Stage 1 (timer
      // still pending); the gen increment covers Stage 2 (animation in flight).
      zapGenRef.current += 1;
      if (tvPreviewTimerRef.current) {
        clearTimeout(tvPreviewTimerRef.current);
        tvPreviewTimerRef.current = null;
        setTvPreviewChannel(null);
        setTvPreviewDir(null);
        setTvPreviewNowProg(null);
      }
      // Convert MenuChannelEntry[] → ChannelEntry[] (same shape, separate type)
      const asEntries: ChannelEntry[] = newList.map((e) => ({
        url: e.url,
        title: e.title,
        epgId: e.epgId,
        logo: e.logo,
        channelId: e.channelId,
        num: e.num,
      }));
      setChannelList(asEntries);
      // Switch using `entry` directly — it is toMenuEntry(ch), the exact channel
      // the user pressed, with the correct url/channelId/num already populated.
      // Using asEntries[idx] here inherited any index error from the caller and
      // could load a different channel if idx was wrong (e.g. findIndex → -1 → 0).
      switchChannel({
        url: entry.url,
        title: entry.title,
        epgId: entry.epgId,
        logo: entry.logo ?? '',
        channelId: entry.channelId,
        num: entry.num,
      }, idx);
      setShowChannelMenu(false);
    },
    [switchChannel],
  );

  // Stable close handler for LiveChannelMenu — must be useCallback so the
  // React.memo wrapper on the menu component is not defeated by a new function
  // reference on every PlayerScreen render.
  const handleMenuClose = useCallback(() => setShowChannelMenu(false), []);

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
    // On TV/Firestick: controls stay visible until the user presses BACK.
    // Professional IPTV apps never auto-dismiss overlays while on a remote.
    if (Platform.isTV) return;
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
      // Store in dismissTimerRef so showInfoBar() can cancel it if the user
      // reopens the OSD during the 450 ms fade-out window.
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null;
        setShowInfo(false);
      }, 450);
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

  // Live TV entry:
  // • Firestick/TV — show OSD immediately for 5 s then auto-dismiss, so the
  //   viewer always knows which channel they tuned to (professional IPTV standard).
  // • Phone/tablet — start hidden; a tap reveals it.
  useEffect(() => {
    if (!isLive) return;
    if (Platform.isTV) {
      // A persistent VLC handoff enters fullscreen with focus parked on the
      // transparent centre target. The viewer opens controls explicitly with
      // OK, which avoids an initial overlay stealing focus during the video
      // expansion.
      if (hasPersistentNativeSurfaceHandoff) {
        setShowInfo(false);
        infoOpacity.setValue(0);
        return;
      }
      infoBarUserInvokedRef.current = false; // entry is always auto mode
      setShowInfo(true);
      infoOpacity.setValue(1);
      const t = setTimeout(() => {
        // Only dismiss if the user hasn't opened the OSD manually in the meantime.
        if (!infoBarUserInvokedRef.current) {
          Animated.timing(infoOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
          // Store in dismissTimerRef so showInfoBar() can cancel it if the user
          // reopens the OSD during the 420 ms fade-out window.
          dismissTimerRef.current = setTimeout(() => {
            dismissTimerRef.current = null;
            setShowInfo(false);
          }, 420);
        }
      }, 5000);
      infoTimer.current = t;
      return () => clearTimeout(t);
    } else {
      if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
      setShowInfo(false);
      infoOpacity.setValue(0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The fullscreen handoff route is presented only after the underlying
  // persistent VLC owner reaches fullscreen bounds. Claim a stable, non-native
  // focus target immediately so the physical remote is never left without a
  // target during that presentation transition.
  useEffect(() => {
    if (!Platform.isTV || !isLive || !hasPersistentNativeSurfaceHandoff) return;
    const t = setTimeout(() => requestTvFocus(tvCenterRef.current), 80);
    return () => clearTimeout(t);
  }, [isLive, hasPersistentNativeSurfaceHandoff]);

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
  //
  // Wrap-around switches (ch 0 → last, last → ch 0) jump to a stream URL far
  // away in the channel list; ExoPlayer's audio-focus handoff can take longer
  // for these transitions.  wrapAroundPendingRef signals that the delay should
  // be extended from 600 ms to 900 ms to avoid a focus dead-zone on Fire OS.
  useEffect(() => {
    if (!Platform.isTV || !isLive) return;
    const delay = wrapAroundPendingRef.current ? 900 : 600;
    wrapAroundPendingRef.current = false; // consume the flag
    const t = setTimeout(() => requestTvFocus(tvCenterRef.current), delay);
    return () => clearTimeout(t);
  }, [channelIdx, isLive]);

  // TV: restore D-pad focus to the centre zone whenever the channel menu
  // closes — regardless of whether a channel was selected.
  //
  // The useEffect([channelIdx]) above only fires when the user picks a channel
  // (channelIdx changes).  When the viewer presses BACK or Menu to close the
  // browser without choosing anything, channelIdx stays the same, so the
  // channelIdx effect never runs and focus is left wherever it was inside the
  // now-unmounted menu.  This effect fills that gap with a single, authoritative
  // restore that covers every close path (BACK handler, Menu-button toggle, or
  // any future programmatic close).
  useEffect(() => {
    if (!Platform.isTV || !isLive || showChannelMenu) return;
    const t = setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
    return () => clearTimeout(t);
  }, [showChannelMenu, isLive]);

  // Clean up the TV preview timer on unmount so it can't fire after the
  // component has been destroyed.
  useEffect(() => {
    return () => {
      if (tvPreviewTimerRef.current) { clearTimeout(tvPreviewTimerRef.current); tvPreviewTimerRef.current = null; }
    };
  }, []);

  // Cancel any pending zap-preview timer when the channel list is replaced
  // (e.g. the user switches category in the channel menu while a 250 ms
  // commit timer is still outstanding).  Without this guard, the timer holds
  // a stale onCommit closure that calls switchChannel for a channel from the
  // old list — a channel that no longer maps to the user's current context.
  //
  // Incrementing zapGenRef covers the full commit path: both the 250 ms
  // timeout window (via clearTimeout) and the subsequent 120 ms Animated
  // fade-out window (via the gen !== zapGenRef.current guard in the animation
  // completion callback).  Clearing the timer here also dismisses the preview
  // overlay so the UI reflects the new list immediately.
  useEffect(() => {
    // Advance the generation unconditionally — this invalidates any in-flight
    // animation callback even if the 250 ms timeout has already fired and
    // tvPreviewTimerRef.current is already null.
    zapGenRef.current += 1;
    if (tvPreviewTimerRef.current) {
      clearTimeout(tvPreviewTimerRef.current);
      tvPreviewTimerRef.current = null;
      setTvPreviewChannel(null);
      setTvPreviewDir(null);
      setTvPreviewNowProg(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelList]);

  /**
   * Show the live-TV OSD info bar.
   *
   * @param userInvoked  Pass `true` when the viewer explicitly pressed OK —
   *   the bar stays on-screen until they dismiss it with OK or BACK.
   *   Omit or pass `false` for automatic shows (entry, channel switch) —
   *   the bar auto-dismisses after 5 s on Firestick / Android TV.
   */
  const showInfoBar = useCallback((userInvoked = false) => {
    infoBarUserInvokedRef.current = userInvoked;
    // Cancel any in-flight trailing hide from a recent dismiss so the bar
    // can't vanish immediately after the user re-opens it during the 320 ms
    // fade-out window of a previous dismissInfoBar call.
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
    setShowInfo(true);
    Animated.timing(infoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    if (!isLive) {
      // VOD / catchup: auto-hide after 3 s.
      scheduleInfoHide();
    } else if (Platform.isTV) {
      if (userInvoked) {
        // User explicitly opened the OSD — cancel any pending auto-dismiss and
        // leave the bar visible until they close it.
        if (infoTimer.current) { clearTimeout(infoTimer.current); infoTimer.current = null; }
      } else {
        // Auto-show (entry or channel switch): dismiss after 5 s.
        // Two guards inside the callback prevent premature dismissal:
        //   1. infoBarUserInvokedRef — user pressed OK and pinned the bar.
        //   2. showAudioPickerRef / showSubPickerRef — a picker is open.
        //      The Audio / CC chips that the picker's close-path re-focuses
        //      live inside this bar.  Dismissing while a picker is on screen
        //      unmounts those chips, causing D-pad focus to be lost on close.
        //      When the picker eventually closes the timer is already gone, so
        //      the bar stays visible long enough for the user to see it.
        if (infoTimer.current) clearTimeout(infoTimer.current);
        infoTimer.current = setTimeout(() => {
          if (
            !infoBarUserInvokedRef.current &&
            !showAudioPickerRef.current &&
            !showSubPickerRef.current
          ) {
            Animated.timing(infoOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
            if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
            dismissTimerRef.current = setTimeout(() => {
              dismissTimerRef.current = null;
              osdHiddenAtRef.current = Date.now();
              setShowInfo(false);
            }, 420);
            // Move TV focus to the centre zone BEFORE the bar unmounts — if a
            // chip inside the bar holds focus when it unmounts, Fire OS
            // spatially reassigns focus and can land on a side zap zone,
            // switching channel "on its own".  Backstop call after unmount too.
            // Skip entirely while the channel browser is open: focus commands
            // aimed at the player layer while the overlay owns the D-pad
            // crashed the app on Fire OS.  try/catch because a throw inside
            // this bare timer bypasses ErrorBoundaries and kills the app.
            if (!showChannelMenuRef.current) {
              requestTvFocus(tvCenterRef.current)
              setTimeout(() => {
                if (showChannelMenuRef.current) return;
                requestTvFocus(tvCenterRef.current)
              }, 450);
            }
          }
        }, 5000);
      }
    }
    // Phone/tablet live: stays until BACK/swipe — no change needed here.
  }, [infoOpacity, scheduleInfoHide, isLive]);
  // Keep the ref current so switchChannel (declared above) can call showInfoBar.
  showInfoBarRef.current = showInfoBar;

  // Fire TV live controls live inside the OSD. Opening them is deliberately a
  // UI-only action: the persistent VLC view stays behind this route and is not
  // paused, resized by libVLC, remounted, or asked to reload.
  const showTvLiveControls = useCallback(() => {
    if (!Platform.isTV || !isLive || tvLiveControlsOpeningRef.current) return;
    tvLiveControlsOpeningRef.current = true;
    if (!showInfoRef.current) {
      showInfoBar(true);
    }
    setTimeout(() => {
      tvLiveControlsOpeningRef.current = false;
      requestTvFocus(tvLiveChannelControlRef.current);
    }, 120);
  }, [isLive, showInfoBar]);
  showTvLiveControlsRef.current = showTvLiveControls;

  // The OSD actions are a single visual row, but Fire OS can route UP/DOWN out
  // of absolutely-positioned overlays. Wire all four directions explicitly so
  // every D-pad press stays inside the controls until BACK dismisses them.
  useEffect(() => {
    if (!Platform.isTV || !isLive || !showInfo) return;
    const t = setTimeout(() => {
      const { findNodeHandle } = require('react-native');
      const channelHandle = findNodeHandle(tvLiveChannelControlRef.current);
      const audioHandle = findNodeHandle(tvLiveAudioControlRef.current);
      const ccHandle = findNodeHandle(tvLiveCcControlRef.current);
      const backHandle = findNodeHandle(tvLiveBackControlRef.current);
      if (channelHandle == null || audioHandle == null || ccHandle == null || backHandle == null) return;

      (tvLiveChannelControlRef.current as any)?.setNativeProps({
        nextFocusLeft: backHandle, nextFocusRight: audioHandle,
        nextFocusUp: backHandle, nextFocusDown: audioHandle,
      });
      (tvLiveAudioControlRef.current as any)?.setNativeProps({
        nextFocusLeft: channelHandle, nextFocusRight: ccHandle,
        nextFocusUp: channelHandle, nextFocusDown: ccHandle,
      });
      (tvLiveCcControlRef.current as any)?.setNativeProps({
        nextFocusLeft: audioHandle, nextFocusRight: backHandle,
        nextFocusUp: audioHandle, nextFocusDown: backHandle,
      });
      (tvLiveBackControlRef.current as any)?.setNativeProps({
        nextFocusLeft: ccHandle, nextFocusRight: channelHandle,
        nextFocusUp: ccHandle, nextFocusDown: channelHandle,
      });
    }, 80);
    return () => clearTimeout(t);
  }, [showInfo, isLive]);

  // Show the TV channel-switch preview overlay, then call onCommit after 700 ms.
  // Only relevant on TV (Platform.isTV) — phone/tablet paths never call this.
  const showTvChannelPreview = useCallback((
    channel: ChannelEntry,
    dir: 'prev' | 'next',
    onCommit: () => void,
  ) => {
    if (tvPreviewTimerRef.current) { clearTimeout(tvPreviewTimerRef.current); tvPreviewTimerRef.current = null; }
    // Snapshot the current zap generation.  If the channel list is replaced
    // while the fade-out animation is running (the 120 ms window between the
    // 250 ms timeout firing and the animation callback), zapGenRef will have
    // been incremented and the guard below will skip the commit.
    const gen = zapGenRef.current;
    // Look up the currently-airing EPG programme for the preview channel so we
    // can show programme title and progress on the zap card.
    const epgProgs = epgMap?.get(channel.epgId) ?? [];
    const nowProg = epgProgs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
    setTvPreviewChannel(channel);
    setTvPreviewDir(dir);
    setTvPreviewNowProg(nowProg);
    tvPreviewOpacity.setValue(0);
    Animated.timing(tvPreviewOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    // 250 ms preview before committing (user request: switch as fast as
    // possible) — still long enough to coalesce rapid multi-presses into one
    // stream load instead of loading every intermediate channel.
    tvPreviewTimerRef.current = setTimeout(() => {
      tvPreviewTimerRef.current = null; // timer has fired — ref no longer holds a live handle
      Animated.timing(tvPreviewOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
        // Guard: abort if the channel list was replaced while the fade-out
        // animation was in flight (zapGenRef incremented by the channelList
        // useEffect).  Without this check, a category switch arriving in the
        // 120 ms fade-out window would still reach onCommit/switchChannel.
        if (zapGenRef.current !== gen) return;
        setTvPreviewChannel(null);
        setTvPreviewDir(null);
        setTvPreviewNowProg(null);
        onCommit();
      });
    }, 250);
  }, [tvPreviewOpacity, epgMap, nowTs]);

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
      setTimeout(() => requestTvFocus(tvPlayBtnRef.current), 80);
    }
  }, [controlsOpacity, scheduleHide]);

  // ── TV VOD: auto-show controls on entry ─────────────────────────────────
  // On phone the user taps the video surface to reveal controls.  On TV that
  // gesture doesn't fire, so the scrubber / play-pause / seek buttons stay
  // hidden until the user discovers they must press OK.  Instead, show the
  // controls automatically the moment the player screen mounts for VOD.
  // scheduleHide() is a no-op on TV so they stay visible indefinitely.
  useEffect(() => {
    if (!Platform.isTV || isLive || isWeb) return;
    // Small delay so the VideoView and overlay children have mounted and
    // focus on the play button (inside showVodControls) can actually fire.
    const t = setTimeout(() => showVodControls(), 300);
    return () => clearTimeout(t);
    // showVodControls is stable (wrapped in useCallback); isLive / isWeb
    // are the only values that decide whether to auto-show.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, isWeb]);

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
  // Live TV phone/tablet — horizontal: swipe LEFT → next channel,
  // swipe RIGHT → previous channel (like flipping through pages).
  // activeOffsetX(±30) lets short taps reach tapGesture; failOffsetY([-25,25])
  // yields to the vertical channel-change gesture below for primarily-vertical
  // swipes so the two gestures don't compete.
  const liveSwipeGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-30, 30])
    .failOffsetY([-25, 25])
    .onEnd((e) => {
      if (!isLive || Platform.isTV) return;
      if (Math.abs(e.translationX) < 60 || Math.abs(e.velocityX) < 200) return;
      if (e.translationX < 0) {
        handleNextChannel(); // swipe LEFT  → next channel
      } else {
        handlePrevChannel(); // swipe RIGHT → previous channel
      }
    });

  // Live TV phone/tablet — vertical: swipe UP → next channel, DOWN → prev channel.
  //
  // This is the touch equivalent of the Firestick D-pad LEFT/RIGHT zones and the
  // media channel-up/down keys.  All three input methods call the same
  // handleNextChannel / handlePrevChannel functions, which call switchChannel —
  // one code path for every input source.
  //
  // failOffsetX([-30,30]) — yields to liveSwipeGesture for horizontal intent so
  //   an angled swipe-right (e.g. iOS edge swipe) still triggers the back path.
  // 50 px translation + 200 px/s velocity — prevents accidental channel changes
  //   on small taps or slow drags that just happen to be slightly vertical.
  // navCooldownRef inside handleNext/PrevChannel — shared with the TV D-pad path,
  //   so swipe-spam and D-pad-spam are both rate-limited by the same 1 200 ms gate.
  const liveVerticalSwipeGesture = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-40, 40])
    .failOffsetX([-30, 30])
    .onEnd((e) => {
      if (!isLive || Platform.isTV) return;
      if (Math.abs(e.translationY) < 50 || Math.abs(e.velocityY) < 200) return;
      if (e.translationY < 0) {
        handleNextChannel(); // swipe UP   → next channel  (mirrors TV ch-up / D-pad right)
      } else {
        handlePrevChannel(); // swipe DOWN → prev channel  (mirrors TV ch-down / D-pad left)
      }
    });

  const combinedGesture = Gesture.Race(
    liveSwipeGesture,
    liveVerticalSwipeGesture,
    Gesture.Exclusive(doubleTapGesture, tapGesture),
  );

  const togglePlay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isCasting) {
      // Drive the remote cast device instead of the local player
      if (isPlaying) { pauseRemote(); setIsPlaying(false); }
      else           { playRemote();  setIsPlaying(true);  }
    } else if (USES_NATIVE_VLC) {
      setIsPlaying((playing) => !playing);
    } else {
      if (player.playing) { player.pause(); } else { player.play(); }
    }
    scheduleHide();
  }, [isCasting, isPlaying, player, scheduleHide, pauseRemote, playRemote]);

  /**
   * Timeshift HLS cannot seek through expo-video's currentTime/seekBy APIs.
   * Xtream catch-up streams must be reopened with a programme-relative start
   * offset instead. Returns true when this catch-up-specific path handled the
   * request, allowing normal VOD/cast seeking to keep its existing behavior.
   */
  const seekCatchupTo = useCallback((targetTime: number): boolean => {
    if (
      !isCatchup ||
      !catchupStreamId ||
      !catchupServerStart ||
      catchupStartTimestamp <= 0 ||
      credentials?.type !== 'xtream'
    ) {
      return false;
    }

    const durationSecs = durationRef.current > 0 ? durationRef.current : knownDurationSecs;
    const seekSecs = Math.floor(Math.max(
      0,
      durationSecs > 0 ? Math.min(durationSecs, targetTime) : targetTime,
    ));
    const remainingSecs = Math.max(60, knownDurationSecs - seekSecs);
    const newDurationMins = Math.ceil(remainingSecs / 60);
    const newStartTs = catchupStartTimestamp + seekSecs;
    const newServerStart = addSecondsToServerTime(catchupServerStart, seekSecs);
    const creds = {
      host: credentials.host!,
      username: credentials.username!,
      password: credentials.password!,
    };
    const newUrl = getXtreamCatchupUrls(
      creds,
      catchupStreamId,
      newServerStart,
      newDurationMins,
      newStartTs,
    )[catchupFormatRef.current];

    catchupSeekOffsetRef.current = seekSecs;
    catchupWallStartRef.current = Date.now() - seekSecs * 1000;
    currentTimeRef.current = seekSecs;
    setCurrentTime(seekSecs);
    setIsBuffering(true);
    setHasError(false);
    activeUrlRef.current = newUrl;
    if (USES_NATIVE_VLC) {
      setVlcSeekPosition(undefined);
      reloadNativeVlc(newUrl);
    } else {
      try {
        player.replace(newUrl);
        player.play();
      } catch {}
    }
    return true;
  }, [
    isCatchup,
    catchupStreamId,
    catchupServerStart,
    catchupStartTimestamp,
    credentials,
    knownDurationSecs,
    player,
    reloadNativeVlc,
  ]);

  const seek = useCallback((delta: number) => {
    const target = currentTimeRef.current + delta;
    // Timeshift HLS does not expose a seekable currentTime to expo-video.
    // Rebuild the catch-up URL at the requested programme offset instead.
    if (isCatchup && seekCatchupTo(target)) {
      scheduleHide();
      return;
    }
    if (isCasting) { seekRemote(target); }
    else if (USES_NATIVE_VLC && duration > 0) {
      setCurrentTime(target);
      currentTimeRef.current = target;
      setVlcSeekPosition(Math.max(0, Math.min(1, target / duration)));
    } else {
      player.seekBy(delta);
    }
    scheduleHide();
  }, [isCatchup, isCasting, player, scheduleHide, seekRemote, seekCatchupTo, duration]);

  // TV D-pad seeks are discrete, but the scrubber should visually travel to
  // each new position instead of jumping when the player reports the seek.
  const seekTvStep = useCallback((delta: number) => {
    const current = currentTimeRef.current;
    const durationSecs = durationRef.current;
    const next = Math.max(0, durationSecs > 0 ? Math.min(durationSecs, current + delta) : current + delta);
    setCurrentTime(next);
    seek(delta);
  }, [seek]);

  // TV media keys are handled by the single useTVRemote call above (search
  // "useTVRemote gates the subscription").  A second call here would create
  // a duplicate DeviceEventEmitter subscription, firing every handler twice.

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
  const tvScrubProgress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!Platform.isTV || isLive || isWeb) return;
    const target = Math.max(0, Math.min(100, progress));
    Animated.timing(tvScrubProgress, {
      toValue: target,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [isLive, isWeb, progress, tvScrubProgress]);

  return (
    <View style={[styles.container, usesPersistentNativeSurface && styles.nativeSurfaceControls]}>
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
          <Text style={styles.msgTitle}>Stream Unavailable</Text>
          {!!(activeTitle || params.title) && (
            <Text style={[styles.msgSub, { fontFamily: 'Inter_600SemiBold', marginBottom: 2 }]} numberOfLines={2}>
              {activeTitle || params.title}
            </Text>
          )}
          {!!errorMsg && (
            <Text style={[styles.msgSub, { fontSize: 12, opacity: 0.65 }]} numberOfLines={2}>
              {errorMsg}
            </Text>
          )}
          <Text style={styles.msgSub}>
            {isLive
              ? `This channel is currently unavailable. Retry, switch channel, or tap ${Platform.isTV ? 'Back' : '←'} to return.`
              : 'Unable to load stream. Check your connection and try again.'}
          </Text>

          {/* Primary: Retry */}
          <FocusablePressable
            ref={retryBtnRef}
            style={styles.actionBtn}
            onPress={() => {
              setHasError(false);
              setErrorMsg('');
              setIsBuffering(true);
              const currentEntry = channelIdx >= 0 && channelList[channelIdx];
              if (usesNativeMedia3Live) {
                const retryUrl = currentEntry ? currentEntry.url : params.url;
                setActiveUrl(retryUrl);
                if (usesPersistentNativeSurface) {
                  reloadNativeSurface();
                } else {
                  setVlcReloadKey((key) => key + 1);
                }
              } else if (USES_NATIVE_VLC) {
                setActiveUrl(currentEntry ? currentEntry.url : params.url);
                setVlcReloadKey((key) => key + 1);
              } else {
                try { player.replace(currentEntry ? currentEntry.url : params.url); player.play(); } catch {}
              }
              if (Platform.isTV) {
                setTimeout(() => {
                  if (isLive) requestTvFocus(tvCenterRef.current);
                  else requestTvFocus(tvVodIdleRef.current);
                }, 400);
              }
            }}
          >
            <Text style={styles.actionBtnText}>↺  Retry</Text>
          </FocusablePressable>

          {/* Live TV: let the user skip to an adjacent channel from the error screen */}
          {isLive && (prevChannel || nextChannel) && (
            <View style={styles.errorChannelRow}>
              {prevChannel ? (
                <FocusablePressable
                  style={styles.actionBtnSecondary}
                  onPress={() => {
                    const idx = (channelIdx - 1 + channelList.length) % channelList.length;
                    switchChannel(prevChannel, idx);
                    if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 400);
                  }}
                >
                  <Text style={styles.actionBtnSecondaryText}>← Previous</Text>
                </FocusablePressable>
              ) : <View style={{ flex: 1 }} />}
              {nextChannel ? (
                <FocusablePressable
                  style={styles.actionBtnSecondary}
                  onPress={() => {
                    const idx = (channelIdx + 1) % channelList.length;
                    switchChannel(nextChannel, idx);
                    if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 400);
                  }}
                >
                  <Text style={styles.actionBtnSecondaryText}>Next →</Text>
                </FocusablePressable>
              ) : <View style={{ flex: 1 }} />}
            </View>
          )}
        </View>
      ) : videoMounted && !usesPersistentNativeSurface ? (
        <PlaybackRenderer
          source={activeUrl}
          player={player}
          style={StyleSheet.absoluteFill}
          resizeMode={contentFit}
          paused={!isPlaying}
          reloadKey={vlcReloadKey}
          seekPosition={vlcSeekPosition}
          onPlaying={() => {
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            setIsPlaying(true);
            setIsBuffering(false);
            setHasError(false);
            setIsReconnecting(false);
            setIsResolvingUrl(false);
            setReconnectAttempt(0);
            reconnectAttemptRef.current = 0;
            // A healthy VLC start re-arms one stale URL refresh for any later
            // provider rotation, matching Expo's readyToPlay success path.
            didResolveStaleUrlRef.current = false;
            resolveSessionRef.current += 1;
            if (isLive) notifyPlayerReady();
          }}
          onBuffering={() => setIsBuffering(true)}
          onError={() => {
            if (USES_NATIVE_VLC) {
              handleNativeVlcError();
            } else {
              setIsBuffering(false);
              setErrorMsg('VLC could not open this stream.');
              setHasError(true);
            }
          }}
          onProgress={(time: number, reportedDuration: number) => {
            if (isCatchup) return;
            setCurrentTime(time);
            if (reportedDuration > 0 && isFinite(reportedDuration)) {
              setDuration(reportedDuration);
              // Expo's ready listener is intentionally disabled on Android.
              // Apply saved VOD history once VLC has reported a usable duration.
              if (USES_NATIVE_VLC && !didInitialSeekRef.current && startAtSecs > 0) {
                didInitialSeekRef.current = true;
                const resumeAt = Math.min(startAtSecs, reportedDuration);
                setCurrentTime(resumeAt);
                currentTimeRef.current = resumeAt;
                setVlcSeekPosition(Math.max(0, Math.min(1, resumeAt / reportedDuration)));
              }
            }
          }}
        />
      ) : null}

      {/* ── Channel-loading overlay ────────────────────────────────────────────
          Shown during initial load and every channel switch.  Covers the blank
          VideoView so the user never sees a frozen/empty player surface.
          pointerEvents="none" keeps Back and D-pad zones fully active. */}
      {isBuffering && !usesPersistentNativeSurface && !isReconnecting && !isResolvingUrl && !hasError && !isWeb && !(isLive && (hasZapped || Platform.isTV)) && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingContent}>
            {!!activeLogo && (
              <Image
                source={{ uri: activeLogo }}
                style={styles.loadingLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            )}
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={styles.loadingTitle} numberOfLines={1}>
              {activeTitle || 'Loading…'}
            </Text>
            <Text style={styles.loadingSubtitle}>Connecting to stream</Text>
          </View>
        </View>
      )}

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
              onScrubStart={() => {
                // Enable scrubbing mode only for the duration of the drag.
                // On Android, scrubbingModeEnabled suppresses playback when
                // left on permanently — so we scope it tightly to the gesture.
                try { if (player) (player as any).scrubbingModeOptions = { scrubbingModeEnabled: true }; } catch {}
              }}
              onScrubEnd={() => {
                // Always restore normal playback mode when the drag ends.
                try { if (player) (player as any).scrubbingModeOptions = { scrubbingModeEnabled: false }; } catch {}
              }}
              onSeek={(t) => {
                scheduleHide();

                if (!seekCatchupTo(t)) {
                  // Optimistic update so the scrubber stays at the dragged position
                  setCurrentTime(t);
                  currentTimeRef.current = t;
                  if (isCasting) {
                    seekRemote(t);
                  } else if (USES_NATIVE_VLC && duration > 0) {
                    setVlcSeekPosition(Math.max(0, Math.min(1, t / duration)));
                  } else {
                    player.currentTime = t;
                  }
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
                style={[styles.tvSeekBounce, { left: 0, bottom: insets.bottom + 48 }]}
                onFocus={() => {
                  holdTvScrubFocus();
                  seekTvStep(-10);
                  scheduleHide();
                  setTimeout(() => requestTvFocus(tvScrubAnchorRef.current), 70);
                }}
              />

              {/* Focusable progress bar — D-pad can reach it; LEFT/RIGHT wired below */}
              <FocusablePressable
                ref={tvScrubAnchorRef}
                focusable
                // FocusablePressable clears its own focus state while the
                // invisible bounce target owns native focus. Drive the visual
                // treatment from the latched state as well, so it stays steady
                // throughout LEFT/RIGHT scrubbing.
                style={(focused) => [
                  styles.tvScrubAnchor,
                  { bottom: insets.bottom + 48 },
                  (focused || tvScrubFocused) && styles.tvScrubAnchorFocused,
                ]}
                onPress={() => { /* OK on scrubber: no-op; LEFT/RIGHT seek via bounce targets */ }}
                onFocus={holdTvScrubFocus}
                onBlur={deferTvScrubFocusClear}
              >
                <View style={styles.tvScrubRailWrap}>
                  <View style={styles.tvScrubRail}>
                    <Animated.View
                      style={[
                        styles.tvScrubFill,
                        { width: tvScrubProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
                      ]}
                    />
                  </View>
                  {/* Round thumb — mirrors the phone scrubber's drag handle so
                      the seek position is visible; grows + glows when the bar
                      is selected with the D-pad. */}
                   <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.tvScrubThumb,
                      tvScrubFocused && styles.tvScrubThumbFocused,
                       { left: tvScrubProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
                    ]}
                  />
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
                style={[styles.tvSeekBounce, { right: 0, bottom: insets.bottom + 48 }]}
                onFocus={() => {
                  holdTvScrubFocus();
                  seekTvStep(+10);
                  scheduleHide();
                  setTimeout(() => requestTvFocus(tvScrubAnchorRef.current), 70);
                }}
              />
            </>
          )}
        </Animated.View>
      )}

      {/* Back button + Cast button + Audio + CC for Live — phone/tablet only.
          On TV these chips live inside the OSD info bar; no separate bar needed. */}
      {showControls && !isWeb && isLive && !Platform.isTV && (
        <Animated.View
          style={{ opacity: controlsOpacity, position: 'absolute', top: insets.top + 8, left: 0, right: 0, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 16 }}
          pointerEvents="box-none"
        >
          <FocusablePressable style={styles.backBtn} onPress={handleBackLive}>
            <Text style={styles.backIcon}>←</Text>
          </FocusablePressable>
          <CastButton />
          <View style={{ flex: 1 }} />
          {/* Channel browser button — opens the LiveChannelMenu overlay */}
          <FocusablePressable
            style={styles.trackPill}
            onPress={() => {
              showChannelMenuRef.current = true; // before OSD dismiss — see onMenu
              if (showInfoRef.current) dismissInfoBar();
              setShowChannelMenu(true);
            }}
          >
            <Text style={styles.trackPillText}>≡ Channels</Text>
          </FocusablePressable>
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
          {/* Single compact row: channel num + LIVE pill + logo + name + NOW + Audio/CC (TV) + back */}
          <View style={styles.infoTop}>
            {activeChannelNum != null && (
              <Text style={styles.infoChannelNum}>{activeChannelNum}</Text>
            )}
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
            {activeSubtitleTrack !== null && !Platform.isTV && (
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
            {!Platform.isTV && (
              <FocusablePressable onPress={handleBackLive} style={styles.backBtnSmall}>
                <Text style={styles.backIcon}>←</Text>
              </FocusablePressable>
            )}
          </View>

          {/* TV controls get their own row so long channel/program/audio
              labels cannot push the menu or Back button off-screen. */}
          {Platform.isTV && (
            <View style={styles.infoTvControls}>
              {/* Keep the chips inside the OSD so they're D-pad reachable. */}
              <FocusablePressable
                ref={tvLiveChannelControlRef}
                style={styles.infoOsdChip}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => {
                  showChannelMenuRef.current = true; // before OSD dismiss — see onMenu
                  if (showInfoRef.current) dismissInfoBar();
                  setShowChannelMenu(true);
                }}
              >
                <Text style={styles.infoOsdChipText}>≡ Channels</Text>
              </FocusablePressable>
              <FocusablePressable
                ref={tvLiveAudioControlRef}
                style={styles.infoOsdChip}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => setShowAudioPicker(true)}
              >
                <Text style={styles.infoOsdChipText} numberOfLines={1} ellipsizeMode="tail">
                  🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
                </Text>
              </FocusablePressable>
              <FocusablePressable
                ref={tvLiveCcControlRef}
                style={[styles.infoOsdChip, activeSubtitleTrack !== null && styles.infoOsdChipActive]}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => setShowSubPicker(true)}
              >
                <Text style={[styles.infoOsdChipText, activeSubtitleTrack !== null && styles.infoOsdChipTextActive]}>
                  CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
                </Text>
              </FocusablePressable>
              <FocusablePressable
                ref={tvLiveBackControlRef}
                onPress={handleBackLive}
                style={styles.backBtnSmall}
              >
                <Text style={styles.backIcon}>←</Text>
              </FocusablePressable>
            </View>
          )}

          {/* Programme progress bar — thin bar showing how far through the current show */}
          {currentProg && (
            <View style={styles.infoProgBarRow}>
              <View style={styles.infoProgBarBg}>
                <View style={[styles.infoProgBarFill, {
                  width: `${Math.min(100, Math.max(0,
                    (nowTs - currentProg.start.getTime()) /
                    (currentProg.end.getTime() - currentProg.start.getTime()) * 100,
                  ))}%` as any,
                }]} />
              </View>
            </View>
          )}

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

        </Animated.View>
      )}

      {/* Ambient Now & Next strip REMOVED — the full OSD info bar is now the
          single bottom overlay for the live player. The ambient strip's
          "mutually exclusive" render condition (!showInfo) overlapped with the
          OSD's 300 ms fade-out, so users saw two stacked bottom overlays. */}

      {/* ── TV / Fire TV D-pad zones ─────────────────────────────────────────
          The center zone is the only player focus target. LEFT/RIGHT are
          intentionally non-focusable so they cannot change channels; the
          shared remote handler below reserves channel zapping for UP/DOWN.
          ────────────────────────────────────────────────────────────────── */}
      {Platform.isTV && isLive && !hasError && !isWeb && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Left third — transparent layout layer only.
              Deliberately excluded from
              the TV focus graph so LEFT cannot zap a channel. */}
          <Pressable
            focusable={false}
            style={styles.tvZoneLeft}
            onPress={showInfo ? dismissInfoBar : () => showInfoBar()}
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('left');
              // Fire OS can still send focus to a `focusable={false}` Pressable.
              // LEFT must remain inert during fullscreen live playback, so
              // always return to the centre target instead of zapping.
              setTimeout(() => requestTvFocus(tvCenterRef.current), 50);
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
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('center');
            }}
            onPress={() => {
              if (Platform.isTV) {
                // Fire TV: OK opens the explicit controls overlay and moves
                // focus into its first action. Once controls own focus, OK is
                // handled by the selected FocusablePressable.
                showTvLiveControls();
              } else {
                // Phone/tablet: toggle info bar (touch path).
                if (showInfo) { dismissInfoBar(); } else { showInfoBar(); }
              }
            }}
          />
          {/* Right third — transparent layout layer only.
              Deliberately excluded from
              the TV focus graph so RIGHT cannot zap a channel. */}
          <Pressable
            focusable={false}
            style={styles.tvZoneRight}
            onPress={showInfo ? dismissInfoBar : () => showInfoBar()}
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('right');
              // Same protection for RIGHT. Fullscreen live zapping is reserved
              // for UP/DOWN and dedicated channel-up/channel-down media keys.
              setTimeout(() => requestTvFocus(tvCenterRef.current), 50);
            }}
          />
          {/* ── TV zone focus indicators ─────────────────────────────────────
              Visible only when D-pad focus is on a navigation zone so the user
              always knows where the remote cursor is while no overlay is shown.
              pointerEvents="none" so they never intercept touch/D-pad events. */}
          {/* Zone focus indicators intentionally NOT rendered: the translucent
              highlight bands (and centre dot) were permanently visible on real
              TV panels — the centre zone always holds focus during playback,
              so the "subtle" rgba band read as a stuck overlay on screen.
              tvZoneFocused state is still tracked for OK-button behaviour. */}
        </View>
      )}

      {/* ── TV channel-switch preview overlay ───────────────────────────────
          Fades in for ~1 s when D-pad left/right is pressed so the viewer
          knows which channel is coming before the stream switches.
          Positioned at the bottom-centre, similar to the live info bar.
          Only rendered on TV (Platform.isTV check is in the condition above). */}
      {Platform.isTV && isLive && !hasError && !isWeb && tvPreviewChannel && (
        <Animated.View
          style={[styles.tvChannelPreview, { bottom: insets.bottom + 20, opacity: tvPreviewOpacity }]}
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
          {/* Channel name + programme info column */}
          <View style={styles.tvPreviewInfo}>
            <View style={styles.tvPreviewChRow}>
              {tvPreviewChannel.num != null && (
                <Text style={styles.tvPreviewNum}>{tvPreviewChannel.num}</Text>
              )}
              <Text style={styles.tvPreviewTitle} numberOfLines={1}>{tvPreviewChannel.title}</Text>
            </View>
            {tvPreviewNowProg && (
              <>
                <Text style={styles.tvPreviewProgTitle} numberOfLines={1}>{tvPreviewNowProg.title}</Text>
                <View style={styles.tvPreviewProgBg}>
                  <View style={[styles.tvPreviewProgFill, {
                    width: `${Math.min(100, Math.max(0,
                      (nowTs - tvPreviewNowProg.start.getTime()) /
                      (tvPreviewNowProg.end.getTime() - tvPreviewNowProg.start.getTime()) * 100,
                    ))}%` as any,
                  }]} />
                </View>
              </>
            )}
          </View>
        </Animated.View>
      )}

      {/* Always-visible back button for live TV on phones.
          All swipe gestures (left/right/up/down) are bound to channel zapping,
          so users need a permanent tap target to exit the player without having
          to first tap to reveal the OSD.  Hidden when the OSD controls bar is
          already showing its own back button to avoid a visual duplicate. */}
      {isLive && !isWeb && !Platform.isTV && !showControls && (
        <TouchableOpacity
          style={[styles.liveExitBtn, { top: insets.top + 8 }]}
          onPress={handleBackLive}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
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
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstAudioChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowAudioPicker(false);
          // On TV: return to the centre zone (the chip may be unmounted if the
          // OSD was dismissed; centre is always safe).  On mobile: chip ref.
          if (Platform.isTV) {
            setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          } else {
            setTimeout(() => requestTvFocus(audioChipRef.current), 150);
          }
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => {
            setShowAudioPicker(false);
            if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          }}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
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
                      // TV: return to centre zone (the chip lives inside the
                      // OSD bar which may auto-dismiss; centre is always safe).
                      if (Platform.isTV) {
                        setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                      } else {
                        setTimeout(() => requestTvFocus(audioChipRef.current), 150);
                      }
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
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstSubChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowSubPicker(false);
          if (Platform.isTV) {
            setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          } else {
            setTimeout(() => requestTvFocus(ccChipRef.current), 150);
          }
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => {
            setShowSubPicker(false);
            if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          }}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
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
                  if (Platform.isTV) {
                    setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                  } else {
                    setTimeout(() => requestTvFocus(ccChipRef.current), 150);
                  }
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
                      if (Platform.isTV) {
                        setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                      } else {
                        setTimeout(() => requestTvFocus(ccChipRef.current), 150);
                      }
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
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstSpeedChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowSettings(false);
          setTimeout(() => requestTvFocus(settingsChipRef.current), 150);
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => setShowSettings(false)}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
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
                  StorageService.setPrefPlaybackSpeed(s).catch(() => {});
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
      {/* ── Live TV Channel Menu (TV + phone) ───────────────────────────────
          On TV: opened by the Menu/hamburger button on the Firestick remote.
          On phone: opened by the ≡ button in the Live TV OSD toolbar.
          Renders on top of all other overlays; BACK closes it. */}
      {showChannelMenu && isLive && !isWeb && (
        <LiveChannelMenu
          currentChannelId={activeChannelId}
          epgMap={epgMap}
          onSelectChannel={handleMenuSelectChannel}
          onClose={handleMenuClose}
          focusCallbackRef={channelMenuFocusRef}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  nativeSurfaceControls: { backgroundColor: 'transparent' },

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
  // 48px side margins keep the bar inside the TV-safe area — TVs crop up to
  // ~5% of the picture edge (overscan), which was hiding the bar entirely.
  tvScrubAnchor: {
    position: 'absolute',
    left: 48, right: 48,
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
  tvScrubRailWrap: {
    justifyContent: 'center',
    height: 20,
  },
  tvScrubThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.4)',
  },
  tvScrubThumbFocused: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    backgroundColor: '#00E5FF',
    borderColor: '#FFFFFF',
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
  /** Always-visible exit button on the live player (phone/tablet).
   *  Slightly translucent so it doesn't dominate the picture, but
   *  always present so users never have to tap just to find the back button. */
  liveExitBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    opacity: 0.75,
    zIndex: 10,
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
  infoTvControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
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
  actionBtnSecondary: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  actionBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  errorChannelRow: { flexDirection: 'row', gap: 12, marginTop: 4 },

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
  // (TV zone focus indicator styles removed — the translucent bands/dot were
  // permanently visible on real TV panels and read as a stuck overlay.)

  // ── TV channel-switch preview overlay ──
  tvChannelPreview: {
    position: 'absolute',
    left: 60,
    right: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  tvPreviewArrow: {
    fontSize: 32,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 36,
    flexShrink: 0,
  },
  tvPreviewLogo: {
    width: 56,
    height: 38,
    flexShrink: 0,
  },
  tvPreviewInfo: {
    flex: 1,
    gap: 4,
  },
  tvPreviewChRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  tvPreviewNum: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.50)',
    flexShrink: 0,
  },
  tvPreviewTitle: {
    flex: 1,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.2,
  },
  tvPreviewProgTitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
  },
  tvPreviewProgBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  tvPreviewProgFill: {
    height: 3,
    backgroundColor: '#00D4FF',
    borderRadius: 2,
  },

  // ── OSD info bar — channel number ──
  infoChannelNum: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: 'rgba(255,255,255,0.55)',
    marginRight: 4,
    flexShrink: 0,
  },

  // ── OSD info bar — Audio/CC chips (TV only, inside the info bar) ──
  infoOsdChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 180,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    flexShrink: 0,
  },
  infoOsdChipFocused: {
    backgroundColor: 'rgba(0,212,255,0.20)',
    borderColor: '#00D4FF',
  },
  infoOsdChipActive: {
    backgroundColor: 'rgba(0,212,255,0.18)',
    borderColor: '#00D4FF',
  },
  infoOsdChipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  infoOsdChipTextActive: {
    color: '#00D4FF',
  },

  // ── OSD info bar — programme progress bar ──
  infoProgBarRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  infoProgBarBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  infoProgBarFill: {
    height: 3,
    backgroundColor: '#00D4FF',
    borderRadius: 2,
  },

  // ── Channel-loading overlay (buffering while switching channels) ──────────
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  loadingLogo: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginBottom: 4,
  },
  loadingTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
    textAlign: 'center',
  },
  loadingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },

});
