import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ThumbnailWithFallback } from '@/components/ThumbnailWithFallback';
import { TrailerModal } from '@/components/TrailerModal';
import { getTmdbTrailerCandidates, getTmdbPosterUrl } from '@/services/tmdb';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { PinPad } from '@/components/PinPad';
import { StorageService } from '@/services/storage';
import { getXtreamVodInfo, getXtreamVodUrl } from '@/services/xtreamApi';

function fmtSecs(secs: number) {
  const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function StarRow({ value }: { value: number }) {
  const n = Math.round(Math.min(5, Math.max(0, value)));
  return (
    <View style={{ flexDirection: 'row', gap: 2, marginTop: 8 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Text key={i} style={{ fontSize: 14, color: i < n ? '#F59E0B' : '#444' }}>
          {i < n ? '★' : '☆'}
        </Text>
      ))}
    </View>
  );
}

function MetaRow({
  label, value, badge, expandable,
}: {
  label: string; value: string; badge?: boolean; expandable?: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > 90;
  return (
    <View style={mStyles.row}>
      <Text style={[mStyles.label, { color: 'rgba(255,255,255,0.5)' }]}>{label}:</Text>
      <View style={{ flex: 1 }}>
        {badge ? (
          <View style={[mStyles.badge, { backgroundColor: colors.secondary }]}>
            <Text style={[mStyles.badgeText, { color: colors.foreground }]}>{value}</Text>
          </View>
        ) : (
          <>
            <Text
              style={[mStyles.value, { color: colors.foreground }]}
              numberOfLines={expandable && !expanded && isLong ? 2 : undefined}
            >
              {value}
            </Text>
            {expandable && isLong && (
              <Pressable onPress={() => setExpanded(!expanded)} hitSlop={{ top: 6, bottom: 6 }}>
                <Text style={mStyles.readMore}>{expanded ? 'Show less' : 'Read more'}</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const mStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: 10, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  label: { width: 88, fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18, flexShrink: 0 },
  value: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  readMore: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#F59E0B', marginTop: 3 },
});

export default function MovieDetailScreen() {
  const colors = useColors();
  const isOnline = useIsOnline(); // #140
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { maxRating, verifyPin } = useParentalContext();
  const [isFav, setIsFav] = useState(false);
  const [savedPosition, setSavedPosition] = useState<number | null>(null);
  const [showPinGate, setShowPinGate] = useState(false);
  const [trailerIds, setTrailerIds] = useState<string[] | 'loading' | null>(null);
  const [pendingStartAt, setPendingStartAt] = useState<number | undefined>(undefined);

  const params = useLocalSearchParams<{
    id: string; title: string; cover: string; genre: string; rating: string;
    plot: string; cast: string; director: string; releaseDate: string;
    duration: string; ext: string;
  }>();

  const isXtream =
    credentials?.type === 'xtream' &&
    !!credentials.host && !!credentials.username && !!credentials.password;

  useFocusEffect(
    useCallback(() => {
      StorageService.getMovieFavorites().then((favs) => {
        setIsFav(favs.some((f) => f.id === params.id));
      });
      StorageService.getWatchHistory().then((h) => {
        const entry = h.find((e) => e.id === params.id);
        setSavedPosition(entry?.position && entry.position > 5 ? entry.position : null);
      });
    }, [params.id]),
  );

  // needsInfo: true when metadata (plot/cast) isn't already in route params
  const needsInfo = isXtream && (!params.plot || !params.cast);
  // Always fetch VOD info for Xtream content — even when metadata is pre-populated —
  // so we can use the provider-supplied trailer URL when available.
  const { data: vodInfo, isLoading: infoLoading } = useQuery({
    queryKey: ['vod-info', params.id, credentials],
    queryFn: () => getXtreamVodInfo(
      { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
      params.id,
    ),
    enabled: isXtream,
    staleTime: 15 * 60_000,
  });

  const cover       = params.cover       || vodInfo?.cover       || '';
  const plot        = params.plot        || vodInfo?.plot        || '';
  const cast        = params.cast        || vodInfo?.cast        || '';
  const director    = params.director    || vodInfo?.director    || '';
  const genre       = params.genre       || vodInfo?.genre       || '';
  const rating      = params.rating      || vodInfo?.rating      || '';
  const releaseDate = params.releaseDate || vodInfo?.releaseDate || '';
  const duration    = params.duration    || vodInfo?.duration    || '';
  const ext         = params.ext         || vodInfo?.containerExtension || 'mp4';

  // Fetch TMDB poster — used as the blurred fallback inside ThumbnailWithFallback when
  // the provider cover is absent or fails to load at render time.
  const { data: tmdbPoster } = useQuery({
    queryKey: ['tmdb-poster', params.title, 'movie'],
    queryFn: () => getTmdbPosterUrl(params.title, 'movie'),
    enabled: isXtream || !cover,
    staleTime: 30 * 60_000,
  });
  // Background blur uses the best available image; poster rendering is handled by ThumbnailWithFallback.
  const displayCover = cover || tmdbPoster || '';

  // #172: Prefetch the cover into the native image cache so the blurred
  // background and poster stay sharp after the app returns from background.
  useEffect(() => {
    if (displayCover) Image.prefetch(displayCover).catch(() => {});
  }, [displayCover]);

  const handleToggleFav = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleMovieFavorite({
      id: params.id, name: params.title, cover: cover || undefined,
      rating: rating || undefined, genre: genre || undefined,
      streamId: params.id, containerExtension: ext, categoryId: '',
      plot: plot || undefined, cast: cast || undefined,
      director: director || undefined, releaseDate: releaseDate || undefined,
      duration: duration || undefined,
    });
    setIsFav(updated.some((f) => f.id === params.id));
  };

  const doPlay = useCallback((startAt?: number) => {
    if (!isXtream) return;
    const url = getXtreamVodUrl(
      { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
      params.id, ext,
    );
    if (!url) return;
    router.push({
      pathname: '/player',
      params: { url, title: params.title, type: 'vod', logo: cover, contentId: params.id,
        ...(startAt !== undefined ? { startAt: String(startAt) } : {}) },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cover, ext, params.id, params.title, router]);

  const handlePlay = (startAt?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isContentBlocked(params.rating, maxRating)) {
      setPendingStartAt(startAt);
      setShowPinGate(true);
      return;
    }
    doPlay(startAt);
  };

  const ratingNum = rating ? parseFloat(rating) : 0;
  const genreDisplay = genre ? genre.split(',').slice(0, 2).map((g) => g.trim()).join(' / ') : '';

  return (
    <View style={[styles.root, { backgroundColor: '#0A0A0F' }]}>
      {/* Faint blurred background from cover */}
      {displayCover ? (
        <Image source={{ uri: displayCover }} style={styles.bgImage} blurRadius={10} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,15,0.87)' }]} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: 'rgba(255,255,255,0.07)' }]}>
        <Pressable
          focusable
          style={({ focused }) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={() => router.back()}
        >
          <Text style={styles.headerBtnIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{params.title}</Text>
        <Pressable
          focusable
          style={({ focused }) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={handleToggleFav}
        >
          <Text style={[styles.headerBtnIcon, { color: isFav ? '#EF4444' : '#fff', fontSize: 20 }]}>
            {isFav ? '♥' : '♡'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      >
        {/* ── Two-column section ── */}
        <View style={styles.topSection}>
          {/* Left: poster + stars */}
          <View style={styles.posterCol}>
            <ThumbnailWithFallback
              uri={cover || undefined}
              fallbackUri={tmdbPoster || undefined}
              style={styles.poster}
            />
            {ratingNum > 0 && <StarRow value={ratingNum / 2} />}
          </View>

          {/* Right: metadata */}
          <View style={styles.metaCol}>
            {director ? <MetaRow label="Directed By" value={director} /> : null}
            {releaseDate ? <MetaRow label="Release Date" value={releaseDate} /> : null}
            {duration ? <MetaRow label="Duration" value={duration} badge /> : null}
            {genreDisplay ? <MetaRow label="Genre" value={genreDisplay} /> : null}
            {cast ? <MetaRow label="Cast" value={cast} expandable /> : null}
            {plot ? <MetaRow label="Plot" value={plot} expandable /> : null}
            {!plot && infoLoading && needsInfo ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter_400Regular' }}>
                  Loading details…
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Action buttons ── */}
        <View style={styles.actionRow}>
          {savedPosition ? (
            <>
              <Pressable
                focusable
                style={({ focused }) => [styles.playBtn, { flex: 1 }, focused && styles.focusRing]}
                onPress={() => handlePlay(savedPosition)}
              >
                <Text style={styles.playBtnText}>▶  Resume · {fmtSecs(savedPosition)}</Text>
              </Pressable>
              <Pressable
                focusable
                style={({ focused }) => [styles.outlineBtn, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.2)' }]}
                onPress={() => handlePlay()}
              >
                <Text style={styles.outlineBtnText}>From Start</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              focusable
              style={({ focused }) => [styles.playBtn, focused && styles.focusRing]}
              onPress={() => handlePlay()}
            >
              <Text style={styles.playBtnText}>▶  Play</Text>
            </Pressable>
          )}
          <Pressable
            focusable
            style={({ focused }) => [styles.outlineBtn, { borderColor: 'rgba(255,255,255,0.15)' }, !isOnline && styles.offlineBtn, focused && styles.focusRing]}
            onPress={async () => {
              if (!isOnline) {
                Alert.alert('No Internet', 'No internet connection — trailer unavailable.', [{ text: 'OK' }]);
                return;
              }
              setTrailerIds('loading');
              const ids = await getTmdbTrailerCandidates(params.title, 'movie');
              const raw = vodInfo?.trailerUrl;
              const provId = raw ? (raw.startsWith('http')
                ? (raw.match(/[?&]v=([^&#]+)/)?.[1] ?? raw.match(/youtu\.be\/([^?&#]+)/)?.[1] ?? null)
                : raw) : null;
              const all = provId && !ids.includes(provId) ? [...ids, provId] : ids;
              setTrailerIds(all.length > 0 ? all : null);
            }}
          >
            <Text style={[styles.outlineBtnText, !isOnline && { opacity: 0.45 }]}>
              {isOnline ? '▶  Watch Trailer' : '✕  No Connection'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={showPinGate}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setShowPinGate(false)}
      >
        <PinPad
          mode="verify"
          title="Age-Restricted Content"
          subtitle="Enter your PIN to play this title"
          verify={verifyPin}
          onSuccess={() => { setShowPinGate(false); doPlay(pendingStartAt); }}
          onCancel={() => setShowPinGate(false)}
        />
      </Modal>
      <TrailerModal videoIds={trailerIds} onClose={() => setTrailerIds(null)} />
    </View>
  );
}

const POSTER_W = 120;
const POSTER_H = 172;

const styles = StyleSheet.create({
  root: { flex: 1 },
  bgImage: { position: 'absolute', width: '100%', height: '100%', opacity: 0.18 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent', flexShrink: 0,
  },
  headerBtnIcon: { fontSize: 18, color: '#fff' },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff',
    marginHorizontal: 8,
  },
  focusRing: { borderColor: '#00E5FF' },
  offlineBtn: { opacity: 0.45 },

  // Two-column
  topSection: {
    flexDirection: 'row', gap: 14,
    paddingHorizontal: 14, paddingTop: 16, paddingBottom: 8,
  },
  posterCol: { width: POSTER_W, flexShrink: 0, alignItems: 'center' },
  poster: {
    width: POSTER_W, height: POSTER_H,
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  metaCol: { flex: 1 },

  // Actions
  actionRow: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 14, paddingTop: 16,
  },
  playBtn: {
    flex: 1, backgroundColor: '#3B82F6',
    borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  playBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  outlineBtn: {
    paddingHorizontal: 14, paddingVertical: 13,
    borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#fff' },
});
