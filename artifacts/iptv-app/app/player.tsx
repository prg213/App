import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useAppContext } from '@/context/AppContext';
import { getXtreamXmltvUrl } from '@/services/xtreamApi';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { EpgProgram } from '@/types';

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

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: 'live' | 'vod' | 'series';
    epgId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isLive = params.type === 'live';

  const { credentials } = useAppContext();
  const isXtream = credentials?.type === 'xtream';
  const xmltvUrl = isXtream ? getXtreamXmltvUrl(buildCreds(credentials)) : null;

  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update "now" every minute for EPG accuracy
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── EPG: reuse cached query from Live TV screen ──────────────────────────
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
    enabled: !!xmltvUrl && isLive,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  const currentProg = React.useMemo(() => {
    if (!epgMap || !params.epgId) return null;
    const progs = epgMap.get(params.epgId) ?? [];
    return progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
  }, [epgMap, params.epgId, nowTs]);

  // ── Video player ─────────────────────────────────────────────────────────
  const player = useVideoPlayer(isWeb ? null : params.url, (p) => {
    p.loop = isLive;
    p.play();
  });

  useEffect(() => {
    if (isWeb || !player) return;
    const subs = [
      player.addListener('playingChange', ({ isPlaying: playing }) => setIsPlaying(playing)),
      player.addListener('statusChange', ({ status, error }: { status: string; error?: unknown }) => {
        if (status === 'readyToPlay') setIsBuffering(false);
        if (status === 'error' || error) setHasError(true);
      }),
      player.addListener('timeUpdate', ({ currentTime: t }: { currentTime: number }) => {
        setCurrentTime(t);
        if (player.duration) setDuration(player.duration);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, isWeb]);

  // ── Controls visibility ──────────────────────────────────────────────────
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true })
        .start(() => setShowControls(false));
    }, 3500);
  }, [controlsOpacity]);

  useEffect(() => {
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  const handleTap = useCallback(() => {
    if (!showControls) {
      setShowControls(true);
      Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    scheduleHide();
  }, [showControls, controlsOpacity, scheduleHide]);

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

      {/* Video + tap handler */}
      <TouchableWithoutFeedback onPress={handleTap}>
        <View style={StyleSheet.absoluteFill}>
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
                  player.replace(params.url);
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

          {/* Buffering spinner — no overlay, just centred */}
          {isBuffering && !hasError && !isWeb && (
            <View style={styles.bufferWrap} pointerEvents="none">
              <View style={styles.bufferCircle}>
                <Text style={styles.bufferIcon}>▶</Text>
              </View>
              <Text style={styles.bufferText}>Loading stream…</Text>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* ── Tap-to-reveal controls (no dim background) ── */}
      {showControls && !isWeb && (
        <Animated.View style={[styles.overlay, { opacity: controlsOpacity }]} pointerEvents="box-none">
          {/* Back button — top left */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
          </View>

          {/* Play / seek controls — centre */}
          <View style={styles.center}>
            {!isLive && (
              <TouchableOpacity style={styles.seekBtn} onPress={() => seek(-10)} activeOpacity={0.7}>
                <Text style={styles.seekIcon}>«</Text>
                <Text style={styles.seekLabel}>10s</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.8}>
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            {!isLive && (
              <TouchableOpacity style={styles.seekBtn} onPress={() => seek(10)} activeOpacity={0.7}>
                <Text style={styles.seekIcon}>»</Text>
                <Text style={styles.seekLabel}>10s</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* VOD progress bar */}
          {!isLive && duration > 0 && (
            <View style={[styles.vodBar, { paddingBottom: insets.bottom + 70 }]}>
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{fmtSecs(currentTime)}</Text>
                <Text style={styles.timeText}>{fmtSecs(duration)}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${progress}%` as any }]} />
              </View>
            </View>
          )}
        </Animated.View>
      )}

      {/* ── Always-visible bottom info bar (Live TV only) ── */}
      {isLive && !isWeb && !hasError && (
        <View style={[styles.infoBar, { paddingBottom: insets.bottom + 6 }]}>
          <View style={styles.infoBarInner}>
            {/* LIVE pill */}
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              {/* Channel name */}
              <Text style={styles.infoChannel} numberOfLines={1}>{params.title}</Text>

              {/* Current programme */}
              {currentProg ? (
                <Text style={styles.infoProg} numberOfLines={1}>
                  {currentProg.title}
                  {'  '}
                  <Text style={styles.infoProgTime}>
                    {fmtTime(currentProg.start)} – {fmtTime(currentProg.end)}
                  </Text>
                </Text>
              ) : null}
            </View>

            {/* Back button always accessible */}
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtnSmall} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
          </View>
        </View>
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

  // Controls overlay — transparent background so video shows through cleanly
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    // No backgroundColor — overlay is invisible until tapped
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
  seekBtn: { alignItems: 'center', gap: 4 },
  seekIcon: { fontSize: 22, color: '#fff' },
  seekLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium' },

  vodBar: { paddingHorizontal: 16, gap: 6 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium' },
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 2 },

  // ── Always-visible live info bar ──
  infoBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  infoBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.5)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  liveDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#EF4444' },
  liveText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 1 },

  infoChannel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  infoProg: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.85)' },
  infoProgTime: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)' },

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
