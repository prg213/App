import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '@/context/AppContext';
import { getXtreamXmltvUrl } from '@/services/xtreamApi';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { EpgProgram } from '@/types';

type ChannelEntry = { url: string; title: string; epgId: string };

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

function fmtTime(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
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
    })
    .onUpdate((e) => {
      if (durationRef.current <= 0) return;
      setScrubFrac(clamp(e.x / Math.max(trackW.current, 1)));
    })
    .onEnd((e) => {
      const frac = clamp(e.x / Math.max(trackW.current, 1));
      setScrubbing(false);
      onSeekRef.current(frac * durationRef.current);
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
    type: 'live' | 'vod' | 'series';
    epgId?: string;
    channelsJson?: string;
    channelIndex?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isLive = params.type === 'live';

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
  const [activeEpgId, setActiveEpgId] = useState(params.epgId ?? '');

  const prevChannel = channelList.length > 0 && channelIdx > 0 ? channelList[channelIdx - 1] : null;
  const nextChannel = channelList.length > 0 && channelIdx < channelList.length - 1 ? channelList[channelIdx + 1] : null;

  // ── Player state ─────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now());

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
  const player = useVideoPlayer(isWeb ? null : params.url, (p) => {
    p.loop = isLive;
    p.scrubbingModeOptions = { isEnabled: true };
    p.play();
  });

  useEffect(() => {
    if (isWeb || !player) return;
    const subs = [
      player.addListener('playingChange', ({ isPlaying: playing }) => setIsPlaying(playing)),
      player.addListener('statusChange', ({ status, error }: { status: string; error?: unknown }) => {
        if (status === 'readyToPlay') setIsBuffering(false);
        if (status === 'error' || error) {
          const msg = (error as any)?.message ?? (error as any)?.localizedDescription ?? String(error ?? '');
          setErrorMsg(msg);
          setHasError(true);
        }
      }),
      player.addListener('timeUpdate', ({ currentTime: t }: { currentTime: number }) => {
        setCurrentTime(t);
        const d = player.duration;
        if (d && isFinite(d) && d > 0) setDuration(d);
      }),
    ];
    // Also poll duration — some streams only expose it after buffering
    const durationPoll = setInterval(() => {
      const d = player.duration;
      if (d && isFinite(d) && d > 0) setDuration(d);
    }, 500);
    return () => { subs.forEach((s) => s.remove()); clearInterval(durationPoll); };
  }, [player, isWeb]);

  // ── Channel navigation ───────────────────────────────────────────────────
  // Track last-watched URL globally so the channel list can restore it on back
  useEffect(() => {
    setLastWatchedUrl(params.url);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchChannel = useCallback((entry: ChannelEntry, newIdx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setChannelIdx(newIdx);
    setActiveTitle(entry.title);
    setActiveEpgId(entry.epgId);
    setIsBuffering(true);
    setHasError(false);
    setErrorMsg('');
    setLastWatchedUrl(entry.url);
    try {
      player.replace(entry.url);
      player.play();
    } catch {}
  }, [player, setLastWatchedUrl]);

  const handlePrevChannel = useCallback(() => {
    if (!prevChannel) return;
    switchChannel(prevChannel, channelIdx - 1);
  }, [prevChannel, channelIdx, switchChannel]);

  const handleNextChannel = useCallback(() => {
    if (!nextChannel) return;
    switchChannel(nextChannel, channelIdx + 1);
  }, [nextChannel, channelIdx, switchChannel]);

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
    scheduleInfoHide();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (infoTimer.current) clearTimeout(infoTimer.current);
    };
  }, [scheduleInfoHide]);

  const showInfoBar = useCallback(() => {
    setShowInfo(true);
    Animated.timing(infoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    scheduleInfoHide();
  }, [infoOpacity, scheduleInfoHide]);

  const handleTap = useCallback(() => {
    showInfoBar();
    if (!showControls) {
      setShowControls(true);
      Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    scheduleHide();
  }, [showControls, controlsOpacity, scheduleHide, showInfoBar]);

  const togglePlay = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (player.playing) { player.pause(); } else { player.play(); }
    scheduleHide();
  }, [player, scheduleHide]);

  const seek = useCallback((delta: number) => {
    player.seekBy(delta);
    scheduleHide();
  }, [player, scheduleHide]);

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
          <Text style={styles.msgSub}>Unable to load stream. Check your connection or try another channel.</Text>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => {
              setHasError(false);
              setIsBuffering(true);
              const currentEntry = channelIdx >= 0 && channelList[channelIdx];
              player.replace(currentEntry ? currentEntry.url : params.url);
              player.play();
            }}
          >
            <Text style={styles.actionBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          allowsFullscreen={false}
          allowsPictureInPicture
          nativeControls={false}
        />
      )}

      {/* Buffering spinner */}
      {isBuffering && !hasError && !isWeb && (
        <View style={styles.bufferWrap} pointerEvents="none">
          <View style={styles.bufferCircle}>
            <Text style={styles.bufferIcon}>▶</Text>
          </View>
        </View>
      )}

      {/* Tap catcher */}
      {!isWeb && !hasError && (
        <TouchableWithoutFeedback onPress={handleTap}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
      )}

      {/* ── Controls overlay (VOD: play/seek/back) ── */}
      {showControls && !isWeb && !isLive && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: controlsOpacity }]} pointerEvents="box-none">
          {/* Back button — absolute top-left */}
          <TouchableOpacity
            style={[styles.backBtn, { position: 'absolute', top: insets.top + 8, left: 16 }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>

          {/* Seek + play/pause buttons — absolute centre */}
          <View style={styles.centerAbs} pointerEvents="box-none">
            <Pressable
              focusable
              style={({ focused }) => [styles.seekBtn, focused && styles.focusRing]}
              onPress={() => seek(-30)}
            >
              <Text style={styles.seekIcon}>⏮</Text>
              <Text style={styles.seekLabel}>-30s</Text>
            </Pressable>
            <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.8}>
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <Pressable
              focusable
              style={({ focused }) => [styles.seekBtn, focused && styles.focusRing]}
              onPress={() => seek(+30)}
            >
              <Text style={styles.seekIcon}>⏭</Text>
              <Text style={styles.seekLabel}>+30s</Text>
            </Pressable>
          </View>

          {/* Scrubber + times — absolute bottom */}
          <VodScrubber
            currentTime={currentTime}
            duration={duration}
            insetBottom={insets.bottom}
            onSeek={(t) => { player.currentTime = t; scheduleHide(); }}
          />
        </Animated.View>
      )}

      {/* Back button overlay for Live (always visible when controls shown) */}
      {showControls && !isWeb && isLive && (
        <Animated.View style={{ opacity: controlsOpacity, position: 'absolute', top: insets.top + 8, left: 16 }} pointerEvents="box-none">
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* ── Live TV info bar (NOW/NEXT + prev/next channel) ── */}
      {isLive && !isWeb && !hasError && showInfo && (
        <Animated.View
          style={[styles.infoBar, { paddingBottom: insets.bottom + 8, opacity: infoOpacity }]}
          pointerEvents="box-none"
        >
          {/* Single compact row: LIVE pill + channel name + NOW prog + time + back */}
          <View style={styles.infoTop}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
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
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtnSmall} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
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
                <TouchableOpacity style={styles.chNavBtn} onPress={handlePrevChannel} activeOpacity={0.8}>
                  <Text style={styles.chNavArrow}>‹</Text>
                  <Text style={styles.chNavLabel} numberOfLines={1}>{prevChannel.title}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.chNavPlaceholder} />
              )}

              {nextChannel ? (
                <TouchableOpacity style={[styles.chNavBtn, styles.chNavBtnRight]} onPress={handleNextChannel} activeOpacity={0.8}>
                  <Text style={styles.chNavLabel} numberOfLines={1}>{nextChannel.title}</Text>
                  <Text style={styles.chNavArrow}>›</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.chNavPlaceholder} />
              )}
            </View>
          )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  overlay: {
    ...StyleSheet.absoluteFillObject,
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

  // Buffering
  bufferWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: 16 },
  bufferCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  bufferIcon: { fontSize: 24, color: '#fff' },
  bufferText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },

  // Error / web message
  msgView: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  msgIcon: { fontSize: 40, color: '#fff' },
  msgTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  msgSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },
  actionBtn: { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12 },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
