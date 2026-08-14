import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  DeviceEventEmitter,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext } from '@/context/ParentalContext';
import {
  getXtreamVodStreams,
  getXtreamSeries,
} from '@/services/xtreamApi';
import { StorageService } from '@/services/storage';
import { buildMovieProgressMap, buildSeriesProgressMap } from '@/utils/progressMap';
import { RecentChannelsRail } from '@/components/RecentChannelsRail';
import type { Channel, Movie, Series, WatchHistoryEntry } from '@/types';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

const BANNER_W = 220;
const BANNER_H = 130;
const LATEST_N = 30;

// ─── Movie banner card ────────────────────────────────────────────────────────

const MovieBanner = React.memo(function MovieBanner({
  movie,
  colors,
  onPress,
}: {
  movie: Movie;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    // bannerOuter: dimensions + borderRadius for the focus ring — NO overflow:hidden.
    // bannerClip: absoluteFill inner view owns overflow:hidden + borderRadius so the
    // image is clipped correctly.  Keeping both on the same element triggers a Fire OS
    // bug where adding borderWidth on focus collapses the clip rect and hides the image.
    <FocusablePressable
      style={styles.bannerOuter}
      focusedStyle={styles.bannerFocused}
      onPress={onPress}
    >
      <View style={styles.bannerClip}>
        {movie.cover ? (
          <Image source={{ uri: movie.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.bannerPlaceholder, { backgroundColor: colors.secondary }]}>
            <Text style={{ fontSize: 32 }}>🎬</Text>
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.bannerGrad}
        />
        <View style={styles.bannerInfo}>
          {movie.rating ? (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>★ {parseFloat(movie.rating).toFixed(1)}</Text>
            </View>
          ) : null}
          <Text style={styles.bannerTitle} numberOfLines={2}>{movie.name}</Text>
          {movie.genre ? (
            <Text style={styles.bannerMeta} numberOfLines={1}>{movie.genre}</Text>
          ) : null}
        </View>
      </View>
    </FocusablePressable>
  );
});

// ─── Series banner card ───────────────────────────────────────────────────────

const SeriesBanner = React.memo(function SeriesBanner({
  series,
  colors,
  onPress,
}: {
  series: Series;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <FocusablePressable
      style={styles.bannerOuter}
      focusedStyle={styles.bannerFocused}
      onPress={onPress}
    >
      <View style={styles.bannerClip}>
        {series.cover ? (
          <Image source={{ uri: series.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.bannerPlaceholder, { backgroundColor: colors.secondary }]}>
            <Text style={{ fontSize: 32 }}>📺</Text>
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.85)']}
          style={styles.bannerGrad}
        />
        <View style={styles.bannerInfo}>
          {series.rating ? (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>★ {parseFloat(series.rating).toFixed(1)}</Text>
            </View>
          ) : null}
          <Text style={styles.bannerTitle} numberOfLines={2}>{series.name}</Text>
          {series.genre ? (
            <Text style={styles.bannerMeta} numberOfLines={1}>{series.genre}</Text>
          ) : null}
        </View>
      </View>
    </FocusablePressable>
  );
});

// ─── Section row ─────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  isLoading,
  children,
  colors,
}: {
  title: string;
  subtitle?: string;
  isLoading: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionPip} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
        </View>
        {subtitle ? (
          <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
        ) : null}
      </View>
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        children
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { blockedChannels } = useParentalContext();
  const isXtream = credentials?.type === 'xtream';

  // #229: blocked-channel set for the RecentChannelsRail
  const blockedIdSet = useMemo(() => new Set(blockedChannels), [blockedChannels]);

  // ── TV: first-content ref ─────────────────────────────────────────────────
  // On Fire TV / Android TV, the D-pad remote needs an explicit focus target
  // when the Home tab loads.  This ref is attached to the hero banner (or the
  // top-most visible card for M3U users).  useFocusEffect calls .focus() every
  // time the Home tab becomes the active screen.
  const firstItemRef = useRef<View>(null);

  // ── Watch history (for Continue Watching rail) ─────────────────────────────
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);

  // #228: when the user clears history from Settings while Home is mounted,
  // clear the Continue Watching rail immediately without waiting for next focus.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('history:cleared', () => {
      setWatchHistory([]);
    });
    return () => sub.remove();
  }, []);

  // ── Latest movies ─────────────────────────────────────────────────────────
  const { data: allMovies = [], isLoading: moviesLoading, refetch: refetchMovies } = useQuery<Movie[]>({
    queryKey: ['vod-streams', null, credentials],
    queryFn: () => getXtreamVodStreams(buildCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 0,
  });

  // ── Latest series ─────────────────────────────────────────────────────────
  const { data: allSeries = [], isLoading: seriesLoading, refetch: refetchSeries } = useQuery<Series[]>({
    queryKey: ['series-list', null, credentials],
    queryFn: () => getXtreamSeries(buildCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 0,
  });

  // Refetch whenever the Home tab comes into focus — tab components stay
  // mounted so React Query's refetchOnMount never fires on re-navigation.
  // Also reload watch history here so progress bars reflect the latest
  // position after the user returns from the player.
  useFocusEffect(useCallback(() => {
    StorageService.getWatchHistory().then(setWatchHistory);
    if (!credentials || !isXtream) return;
    refetchMovies();
    refetchSeries();
  }, [credentials, isXtream, refetchMovies, refetchSeries]));

  // ── TV: focus the first content item whenever Home becomes active ──────────
  // 200 ms gives React Query time to serve cached data and render the hero
  // before we call .focus().  If the ref is still null (e.g. no movies cached
  // yet and no M3U channels) the optional-chain is a safe no-op.
  useFocusEffect(useCallback(() => {
    if (!Platform.isTV) return;
    const t = setTimeout(() => (firstItemRef.current as any)?.focus?.(), 200);
    return () => clearTimeout(t);
  }, []));

  // ── Progress maps for Continue Watching rail ─────────────────────────────
  // Filter by type before building each map so a movie and a series that happen
  // to share the same numeric ID cannot overwrite each other's progress value.
  const movieProgressMap = useMemo(
    () => buildMovieProgressMap(watchHistory.filter((e) => e.type === 'movie')),
    [watchHistory],
  );
  const seriesProgressMap = useMemo(
    () => buildSeriesProgressMap(watchHistory.filter((e) => e.type === 'series')),
    [watchHistory],
  );

  // ── Continue Watching — items with recorded progress (newest first) ────────
  const continueWatchingItems = useMemo<WatchHistoryEntry[]>(() => {
    // Keep only entries with meaningful progress (position > 0, duration > 0)
    // and deduplicate by the display key (parentId for series, id for movies).
    const seen = new Set<string>();
    const result: WatchHistoryEntry[] = [];
    for (const e of watchHistory) {
      if (!e.position || !e.duration || e.position <= 0) continue;
      const key = e.type === 'series' ? (e.parentId ?? e.id) : e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(e);
      if (result.length >= 20) break;
    }
    return result;
  }, [watchHistory]);

  const latestMovies = useMemo(
    () =>
      allMovies
        .filter((m) => !!m.cover)
        .sort((a, b) => parseInt(b.id) - parseInt(a.id))
        .slice(0, LATEST_N),
    [allMovies],
  );

  const latestSeries = useMemo(
    () =>
      allSeries
        .filter((s) => !!s.cover)
        .sort((a, b) => parseInt(b.id) - parseInt(a.id))
        .slice(0, LATEST_N),
    [allSeries],
  );

  // Featured hero — first movie with cover
  const hero = latestMovies[0] ?? null;

  const handleMoviePress = useCallback((movie: Movie) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/movie/[id]',
      params: {
        id: movie.id,
        title: movie.name,
        cover: movie.cover ?? '',
        genre: movie.genre ?? '',
        rating: movie.rating ?? '',
        plot: movie.plot ?? '',
        cast: movie.cast ?? '',
        director: movie.director ?? '',
        releaseDate: movie.releaseDate ?? '',
        duration: movie.duration ?? '',
        ext: movie.containerExtension ?? 'mp4',
      },
    });
  }, [router]);

  const handleSeriesPress = useCallback((s: Series) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/series/[id]',
      params: {
        id: s.id,
        title: s.name,
        cover: s.cover ?? '',
        rating: s.rating ?? '',
        genre: s.genre ?? '',
        plot: s.plot ?? '',
        cast: s.cast ?? '',
        director: s.director ?? '',
      },
    });
  }, [router]);

  // #229 / #350: navigate straight to the player when tapping a recent live channel.
  // Pass the full visible rail list as channelsJson so the Firestick remote's
  // left/right arrows (prev/next channel) work when launched from the Home tab.
  const handleRecentChannelWatch = useCallback(
    (ch: Channel, channels: Channel[], index: number, _cardRef: React.RefObject<View | null>) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const chList = channels.map((c) => ({
        url: c.streamUrl,
        title: c.name,
        epgId: c.epgId ?? c.id,
        logo: c.logo ?? '',
        channelId: c.id,
      }));
      router.push({
        pathname: '/player',
        params: {
          url: ch.streamUrl,
          title: ch.name,
          type: 'live',
          logo: ch.logo ?? '',
          epgId: ch.epgId ?? ch.id,
          channelId: ch.id,
          // Pass groupTitle so the player knows which Live TV category to land
          // on when the user presses Back (navigates to the Live TV tab,
          // category pre-selected to where this channel lives).
          groupTitle: ch.groupTitle ?? '',
          // #350: full list enables prev/next channel navigation on Firestick.
          channelsJson: chList.length > 0 ? JSON.stringify(chList) : '[]',
          channelIndex: String(index),
          // Tell the player Back handler to do the Live TV category handoff
          // even though channelsJson is also present (#350).
          fromHome: 'true',
        },
      });
    },
    [router],
  );

  // Stable empty map — Home doesn't load EPG data; the rail still shows channel
  // names and logos without programme titles.
  const emptyNowPlayingMap = useMemo(() => new Map<string, string>(), []);

  // Navigate to the correct detail page from a history entry
  const handleHistoryItemPress = useCallback((entry: WatchHistoryEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (entry.type === 'movie') {
      router.push({
        pathname: '/movie/[id]',
        params: { id: entry.id, title: entry.title, cover: entry.cover ?? '' },
      });
    } else {
      router.push({
        pathname: '/series/[id]',
        params: { id: entry.parentId ?? entry.id, title: entry.parentTitle ?? entry.title, cover: entry.cover ?? '' },
      });
    }
  }, [router]);

  const renderContinueWatching = useCallback(({ item }: { item: WatchHistoryEntry }) => {
    const progress = item.type === 'series'
      ? seriesProgressMap.get(item.parentId ?? item.id)
      : movieProgressMap.get(item.id);
    const pct = progress != null ? Math.max(2, Math.min(100, progress * 100)) : 0;
    return (
      <FocusablePressable
        style={styles.bannerOuter}
        focusedStyle={styles.bannerFocused}
        onPress={() => handleHistoryItemPress(item)}
      >
        {/* Inner clip view separates overflow:hidden from the focus borderWidth
            to avoid the Fire OS bug where combining them on one element makes
            absolute-positioned image children vanish when focused. */}
        <View style={styles.bannerClip}>
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.bannerPlaceholder, { backgroundColor: colors.secondary }]}>
              <Text style={{ fontSize: 32 }}>{item.type === 'series' ? '📺' : '🎬'}</Text>
            </View>
          )}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={styles.bannerGrad} />
          <View style={styles.bannerInfo}>
            <Text style={styles.bannerTitle} numberOfLines={2}>
              {item.type === 'series' ? (item.parentTitle ?? item.title) : item.title}
            </Text>
          </View>
          {/* Progress bar */}
          {pct > 0 && (
            <View style={styles.progressRail}>
              <View style={[styles.progressFill, { width: `${pct}%` as any }]} />
            </View>
          )}
        </View>
      </FocusablePressable>
    );
  }, [colors, handleHistoryItemPress, movieProgressMap, seriesProgressMap]);

  const renderMovie = useCallback(({ item }: { item: Movie }) => (
    <MovieBanner movie={item} colors={colors} onPress={() => handleMoviePress(item)} />
  ), [colors, handleMoviePress]);

  const renderSeries = useCallback(({ item }: { item: Series }) => (
    <SeriesBanner series={item} colors={colors} onPress={() => handleSeriesPress(item)} />
  ), [colors, handleSeriesPress]);

  if (!isXtream) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* #229: show recently-watched live channels even for M3U/non-Xtream users */}
        <RecentChannelsRail
          blockedIds={blockedIdSet}
          nowPlayingMap={emptyNowPlayingMap}
          onWatchFullscreen={handleRecentChannelWatch}
          topInset={insets.top}
        />
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🏠</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Home</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Connect with Xtream Codes to see{'\n'}latest movies and TV shows here.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Hero banner ── */}
      {hero && (
        <FocusablePressable
          ref={firstItemRef}
          style={[styles.hero, { marginTop: insets.top }]}
          focusedStyle={styles.heroFocused}
          onPress={() => handleMoviePress(hero)}
        >
          {hero.cover && (
            <Image source={{ uri: hero.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          )}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.92)']}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroContent}>
            <View style={styles.heroMeta}>
              {hero.genre ? (
                <View style={[styles.genrePill, { borderColor: 'rgba(255,255,255,0.3)' }]}>
                  <Text style={styles.genrePillText}>{hero.genre.split('/')[0].trim()}</Text>
                </View>
              ) : null}
              {hero.rating ? (
                <View style={styles.ratingBadge}>
                  <Text style={styles.ratingText}>★ {parseFloat(hero.rating).toFixed(1)}</Text>
                </View>
              ) : null}
              {hero.releaseDate ? (
                <Text style={styles.heroYear}>{hero.releaseDate.slice(0, 4)}</Text>
              ) : null}
            </View>
            <Text style={styles.heroTitle} numberOfLines={2}>{hero.name}</Text>
            {hero.plot ? (
              <Text style={styles.heroPlt} numberOfLines={2}>{hero.plot}</Text>
            ) : null}
            <View style={styles.heroBtn}>
              <Text style={styles.heroBtnText}>▶  Watch Now</Text>
            </View>
          </View>
        </FocusablePressable>
      )}

      {/* ── Recently Watched Channels ── */}
      {/* #229: live-channel jump-back rail; hides itself when list is empty */}
      <RecentChannelsRail
        blockedIds={blockedIdSet}
        nowPlayingMap={emptyNowPlayingMap}
        onWatchFullscreen={handleRecentChannelWatch}
      />

      {/* ── Continue Watching ── */}
      {continueWatchingItems.length > 0 && (
        <Section
          title="Continue Watching"
          subtitle={`${continueWatchingItems.length} ${continueWatchingItems.length === 1 ? 'title' : 'titles'}`}
          isLoading={false}
          colors={colors}
        >
          <FlatList
            data={continueWatchingItems}
            keyExtractor={(e) => e.id}
            renderItem={renderContinueWatching}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.bannerList}
            getItemLayout={(_, i) => ({ length: BANNER_W + 10, offset: (BANNER_W + 10) * i, index: i })}
            initialNumToRender={6}
            maxToRenderPerBatch={8}
            removeClippedSubviews={false}
          />
        </Section>
      )}

      {/* ── Latest Movies ── */}
      <Section
        title="Latest Movies"
        subtitle={latestMovies.length > 0 ? `${latestMovies.length} titles` : undefined}
        isLoading={moviesLoading}
        colors={colors}
      >
        <FlatList
          data={latestMovies}
          keyExtractor={(m) => m.id}
          renderItem={renderMovie}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bannerList}
          getItemLayout={(_, i) => ({ length: BANNER_W + 10, offset: (BANNER_W + 10) * i, index: i })}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          removeClippedSubviews={false}
        />
      </Section>

      {/* ── Latest TV Shows ── */}
      <Section
        title="Latest TV Shows"
        subtitle={latestSeries.length > 0 ? `${latestSeries.length} shows` : undefined}
        isLoading={seriesLoading}
        colors={colors}
      >
        <FlatList
          data={latestSeries}
          keyExtractor={(s) => s.id}
          renderItem={renderSeries}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.bannerList}
          getItemLayout={(_, i) => ({ length: BANNER_W + 10, offset: (BANNER_W + 10) * i, index: i })}
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          removeClippedSubviews={false}
        />
      </Section>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Hero ──
  hero: {
    width: '100%',
    height: 220,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 0,
  },
  heroContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 18,
    gap: 6,
  },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  genrePill: {
    borderWidth: 1,
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  genrePillText: { fontSize: 10, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium' },
  heroYear: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular' },
  heroTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff', lineHeight: 26 },
  heroPlt: { fontSize: 11, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_400Regular', lineHeight: 16 },
  heroBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  heroBtnText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // ── Sections ──
  section: { marginTop: 24 },
  sectionHeader: { paddingHorizontal: 16, marginBottom: 12, gap: 2 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionPip: { width: 3, height: 16, backgroundColor: '#3B82F6', borderRadius: 99 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  sectionSub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginLeft: 11 },
  loadingRow: { height: BANNER_H, justifyContent: 'center', alignItems: 'center' },

  bannerList: { paddingHorizontal: 16, gap: 10 },

  // ── TV focus ──
  heroFocused: { borderWidth: 3, borderColor: '#00E5FF' },
  // bannerFocused goes on the OUTER Pressable (no overflow:hidden there).
  // Fire OS bug: overflow:hidden + borderRadius + borderWidth on the same
  // ReactViewGroup collapses the clip rect when borderWidth is added, making
  // absolute-positioned image children invisible on focus.
  bannerFocused: { borderWidth: 3, borderColor: '#00E5FF' },

  // ── Banner card ──
  // Outer Pressable: owns the dimensions and borderRadius for the focus ring.
  // Must NOT have overflow:hidden — adding borderWidth on focus would trigger
  // the Fire OS clip-collapse bug described above.
  bannerOuter: {
    width: BANNER_W,
    height: BANNER_H,
    borderRadius: 10,
  },
  // Inner View: absoluteFill inside bannerOuter; owns overflow:hidden + borderRadius
  // to clip the poster image to rounded corners without conflicting with the border.
  bannerClip: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1A1A28',
  },
  bannerPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  bannerGrad: {
    position: 'absolute',
    left: 0, right: 0,
    bottom: 0,
    height: BANNER_H * 0.65,
  },
  bannerInfo: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    gap: 3,
  },
  ratingBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(251,191,36,0.2)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.4)',
    marginBottom: 2,
  },
  ratingText: { fontSize: 9, color: '#FCD34D', fontFamily: 'Inter_600SemiBold' },
  bannerTitle: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff', lineHeight: 16 },
  bannerMeta: { fontSize: 10, color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular' },

  // ── Continue Watching progress bar ──
  progressRail: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#3B82F6',
    borderRadius: 2,
  },

  // ── Empty state ──
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
