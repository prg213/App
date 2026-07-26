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
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

export default function PlayerScreen() {
  const params = useLocalSearchParams<{
    url: string;
    title: string;
    type: 'live' | 'vod' | 'series';
    logo?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';

  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isLive = params.type === 'live';

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!isLoading) {
        Animated.timing(controlsOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => setShowControls(false));
      }
    }, 3500);
  }, [isLoading, controlsOpacity]);

  useEffect(() => {
    scheduleHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [scheduleHide]);

  const handleTap = useCallback(() => {
    if (!showControls) {
      setShowControls(true);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    scheduleHide();
  }, [showControls, controlsOpacity, scheduleHide]);

  const togglePlay = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) {
      await videoRef.current?.pauseAsync();
    } else {
      await videoRef.current?.playAsync();
    }
    scheduleHide();
  }, [isPlaying, scheduleHide]);

  const handleStatus = useCallback((status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsLoading(false);
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis);
      setDuration(status.durationMillis ?? 0);
      if (status.error) setHasError(true);
    }
  }, []);

  const seek = useCallback(async (delta: number) => {
    const newPos = Math.max(0, Math.min(position + delta, duration));
    await videoRef.current?.setPositionAsync(newPos);
    scheduleHide();
  }, [position, duration, scheduleHide]);

  function formatTime(ms: number) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const ss = String(s % 60).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    if (h > 0) return `${h}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  }

  const progress = duration > 0 ? (position / duration) * 100 : 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden />

      {/* Video */}
      <TouchableWithoutFeedback onPress={handleTap}>
        <View style={StyleSheet.absoluteFill}>
          {isWeb ? (
            /* Web browser can't play IPTV streams due to CORS — guide user to native app */
            <View style={styles.errorView}>
              <Text style={styles.errorIcon}>📱</Text>
              <Text style={styles.errorTitle}>Open in Expo Go</Text>
              <Text style={styles.errorSub}>
                Browsers can't play IPTV streams due to security restrictions.{'\n'}
                Scan the QR code in the Replit preview with the Expo Go app on your phone to watch live.
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => Linking.openURL('https://expo.dev/go')}
              >
                <Text style={styles.retryText}>Get Expo Go →</Text>
              </TouchableOpacity>
            </View>
          ) : hasError ? (
            <View style={styles.errorView}>
              <Text style={styles.errorIcon}>⚠</Text>
              <Text style={styles.errorTitle}>Stream Error</Text>
              <Text style={styles.errorSub}>Unable to load stream. Check your connection or try a different channel.</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => {
                  setHasError(false);
                  setIsLoading(true);
                  videoRef.current?.replayAsync();
                }}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Video
              ref={videoRef}
              source={{ uri: params.url }}
              style={StyleSheet.absoluteFill}
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              isLooping={isLive}
              onPlaybackStatusUpdate={handleStatus}
              onError={() => setHasError(true)}
              useNativeControls={false}
            />
          )}

          {/* Loading Indicator */}
          {isLoading && !hasError && !isWeb && (
            <View style={styles.loadingOverlay}>
              <View style={styles.loadingSpinner}>
                <Text style={styles.loadingIcon}>▶</Text>
              </View>
              <Text style={styles.loadingText}>Loading stream...</Text>
            </View>
          )}
        </View>
      </TouchableWithoutFeedback>

      {/* Controls Overlay */}
      {showControls && (
        <Animated.View
          style={[styles.overlay, { opacity: controlsOpacity }]}
          pointerEvents={showControls ? 'box-none' : 'none'}
        >
          {/* Top bar */}
          <View style={[styles.topBar, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8) }]}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
              <Text style={styles.backIcon}>←</Text>
            </TouchableOpacity>
            <View style={styles.titleWrap}>
              <Text style={styles.playerTitle} numberOfLines={1}>
                {params.title}
              </Text>
              {isLive && (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              )}
            </View>
          </View>

          {/* Center controls */}
          <View style={styles.centerControls}>
            {!isLive && (
              <TouchableOpacity style={styles.seekBtn} onPress={() => seek(-10000)} activeOpacity={0.7}>
                <Text style={styles.seekIcon}>«</Text>
                <Text style={styles.seekLabel}>10s</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.playBtn} onPress={togglePlay} activeOpacity={0.8}>
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>

            {!isLive && (
              <TouchableOpacity style={styles.seekBtn} onPress={() => seek(10000)} activeOpacity={0.7}>
                <Text style={styles.seekIcon}>»</Text>
                <Text style={styles.seekLabel}>10s</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Bottom bar */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 8) }]}>
            {!isLive && duration > 0 && (
              <>
                <View style={styles.timeRow}>
                  <Text style={styles.timeText}>{formatTime(position)}</Text>
                  <Text style={styles.timeText}>{formatTime(duration)}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progress}%` }]} />
                </View>
              </>
            )}
            {isLive && (
              <View style={styles.liveRow}>
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </View>
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
  },
  backIcon: {
    fontSize: 20,
    color: '#fff',
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  centerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 28,
    color: '#fff',
  },
  seekBtn: {
    alignItems: 'center',
    gap: 4,
  },
  seekIcon: {
    fontSize: 22,
    color: '#fff',
  },
  seekLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_500Medium',
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.8)',
    fontFamily: 'Inter_500Medium',
  },
  progressTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 4,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingSpinner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(59,130,246,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingIcon: {
    fontSize: 24,
    color: '#3B82F6',
  },
  loadingText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_400Regular',
  },
  errorView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  errorIcon: { fontSize: 40, color: '#EF4444' },
  errorTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  errorSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
  },
  retryText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
