import React, { useCallback, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
import {
  getXtreamVodStreams,
  getXtreamSeries,
} from '@/services/xtreamApi';
import type { Movie, Series } from '@/types';

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
    <Pressable
      focusable
      style={({ focused }) => [styles.banner, focused && styles.bannerFocused]}
      onPress={onPress}
    >
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
    </Pressable>
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
    <Pressable
      focusable
      style={({ focused }) => [styles.banner, focused && styles.bannerFocused]}
      onPress={onPress}
    >
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
    </Pressable>
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
  const isXtream = credentials?.type === 'xtream';

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
  useFocusEffect(useCallback(() => {
    if (!credentials || !isXtream) return;
    refetchMovies();
    refetchSeries();
  }, [credentials, isXtream, refetchMovies, refetchSeries]));

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

  const renderMovie = useCallback(({ item }: { item: Movie }) => (
    <MovieBanner movie={item} colors={colors} onPress={() => handleMoviePress(item)} />
  ), [colors, handleMoviePress]);

  const renderSeries = useCallback(({ item }: { item: Series }) => (
    <SeriesBanner series={item} colors={colors} onPress={() => handleSeriesPress(item)} />
  ), [colors, handleSeriesPress]);

  if (!isXtream) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
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
        <Pressable
          focusable
          style={({ focused }) => [styles.hero, { marginTop: insets.top }, focused && styles.heroFocused]}
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
        </Pressable>
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
  bannerFocused: { borderWidth: 3, borderColor: '#00E5FF' },

  // ── Banner card ──
  banner: {
    width: BANNER_W,
    height: BANNER_H,
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

  // ── Empty state ──
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
