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
import * as Haptics from 'expo-haptics';

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: 'live' | 'vod' | 'series';
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const isLive = params.type === 'live';

  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const player = useVideoPlayer(isWeb ? null : params.url, (p) => {
    p.loop = isLive;
    p.play();
  });

  // Subscribe to player events via addListener
  useEffect(() => {
    if (isWeb || !player) return;

    const subs = [
      player.addListener('playingChange', ({ isPlaying: playing }) => {
        setIsPlaying(playing);
      }),
      player.addListener('statusChange', ({ status, error }: { status: string; error?: unknown }) => {
        if (status === 'readyToPlay') setIsBuffering(false);
        if (status === 'error' || error) setHasError(true);
      }),
      player.addListener('timeUpdate', ({ currentTime: t }: { currentTime: number }) => {
        setCurrentTime(t);
        // duration is a property on the player
        if (player.duration) setDuration(player.duration);
      }),
    ];

    return () => subs.forEach((s) => s.remove());
  }, [player, isWeb]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setShowControls(false));
    }, 3500);
  }, [controlsOpacity]);

  useEffect(() => {
    scheduleHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [scheduleHide]);

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

  function fmt(secs: number) {
    const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
    const ss = String(s % 60).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

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

          {isBuffering && !hasError && !isWeb && (
            <View style={styles.bufferWrap} pointerEvents="none">
              <View style={styles.bufferCircle}><Text style={styles.bufferIcon}>▶</Text></View>
              <Text style={styles.bufferText}>Loading stream…</Text>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* Controls */}
      {showControls && !isWeb && (
        <Animated.View style={[styles.overlay, { opacity: controlsOpacity }]} pointerEvents="box-none">
          {/* Top */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={styles.title} numberOfLines={1}>{params.title}</Text>
              {isLive && <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}
            </View>
          </View>

          {/* Center */}
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

          {/* Bottom */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
            {!isLive && duration > 0 && (
              <>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{fmt(currentTime)}</Text>
                  <Text style={styles.timeText}>{fmt(duration)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${progress}%` as any }]} />
                </View>
              </>
            )}
            {isLive && (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
            )}
          </View>
        </Animated.View>
      )}

      {isWeb && (
        <TouchableOpacity style={[styles.backBtn, { position: 'absolute', top: insets.top + 8, left: 16 }]} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between', backgroundColor: 'rgba(0,0,0,0.45)' },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  backIcon: { fontSize: 20, color: '#fff' },
  titleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(239,68,68,0.25)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  liveText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 0.5 },
  center: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32 },
  playBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  playIcon: { fontSize: 28, color: '#fff' },
  seekBtn: { alignItems: 'center', gap: 4 },
  seekIcon: { fontSize: 22, color: '#fff' },
  seekLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium' },
  bottomBar: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium' },
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 2 },
  bufferWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: 16 },
  bufferCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(59,130,246,0.25)', justifyContent: 'center', alignItems: 'center' },
  bufferIcon: { fontSize: 24, color: '#3B82F6' },
  bufferText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },
  msgView: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  msgIcon: { fontSize: 40, color: '#fff' },
  msgTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  msgSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },
  actionBtn: { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12 },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
