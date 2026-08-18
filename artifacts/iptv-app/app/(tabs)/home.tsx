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
  useWindowDimensions,
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
import { sidebarNav } from '@/lib/sidebarNav';
import { tvRowNav } from '@/lib/tvRowNav';
import { useBackHandler } from '@/hooks/useBackHandler';
import type { Channel, Movie, Series, WatchHistoryEntry } from '@/types';
import { requestTvFocus } from '@/lib/tvFocus';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

const BANNER_W = 220;
const BANNER_H = 130;
// Tablet breakpoint (>=768dp shortest-side style width check at render time):
// larger posters so a 10" screen isn't showing phone-sized cards.
const TABLET_BP = 768;
const BANNER_W_TAB = 280;
const BANNER_H_TAB = 165;
const LATEST_N = 30;

// ─── Movie banner card ────────────────────────────────────────────────────────

const MovieBanner = React.memo(React.forwardRef(function MovieBanner({
  movie,
  colors,
  onPress,
  nextFocusLeft,
  cardStyle,
  onCardFocus,
}: {
  movie: Movie;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  nextFocusLeft?: number | null;
  cardStyle?: any;
  onCardFocus?: () => void;
}, ref: React.Ref<View>) {
  return (
    // bannerOuter: dimensions + borderRadius for the focus ring — NO overflow:hidden.
    // bannerClip: absoluteFill inner view owns overflow:hidden + borderRadius so the
    // image is clipped correctly.  Keeping both on the same element triggers a Fire OS
    // bug where adding borderWidth on focus collapses the clip rect and hides the image.
    <FocusablePressable
      ref={ref}
      style={cardStyle ?? styles.bannerOuter}
      focusedStyle={styles.bannerFocused}
      nextFocusLeft={nextFocusLeft}
      onFocus={onCardFocus}
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
}));

// ─── Series banner card ───────────────────────────────────────────────────────

const SeriesBanner = React.memo(React.forwardRef(function SeriesBanner({
  series,
  colors,
  onPress,
  nextFocusLeft,
  cardStyle,
  onCardFocus,
}: {
  series: Series;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  nextFocusLeft?: number | null;
  cardStyle?: any;
  onCardFocus?: () => void;
}, ref: React.Ref<View>) {
  return (
    <FocusablePressable
      ref={ref}
      style={cardStyle ?? styles.bannerOuter}
      focusedStyle={styles.bannerFocused}
      nextFocusLeft={nextFocusLeft}
      onFocus={onCardFocus}
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
}));

// ─── Section row ─────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  isLoading,
  children,
  colors,
  tv = false,
}: {
  title: string;
  subtitle?: string;
  isLoading: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  /** TV dashboard mode: section flexes to its share of the screen, compact
      one-line header, and the rail fills the remaining row height. */
  tv?: boolean;
}) {
  if (tv) {
    return (
      <View style={styles.tvSection}>
        <View style={styles.tvSectionHeader}>
          <View style={styles.sectionPip} />
          <Text style={[styles.tvSectionTitle, { color: colors.foreground }]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.tvSectionSub, { color: colors.mutedForeground }]}>{subtitle}</Text>
          ) : null}
        </View>
        {isLoading ? (
          <View style={styles.tvLoadingRow}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={styles.tvSectionBody}>{children}</View>
        )}
      </View>
    );
  }
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
  // when the Home tab loads.  This ref is attached to the first Latest Movies
  // card.  useFocusEffect calls .focus() every time the Home tab becomes the
  // active screen.
  const firstItemRef = useRef<View>(null);

  // ── TV carousels: keep the focused card in view ───────────────────────────
  // Fire OS's native focus engine doesn't reliably scroll a virtualized
  // horizontal FlatList as D-pad focus moves; drive it ourselves on card
  // focus so rows glide like a proper TV carousel (focused card kept near
  // the left third of the row).
  const cwListRef     = useRef<FlatList<WatchHistoryEntry>>(null);
  const movieListRef  = useRef<FlatList<Movie>>(null);
  const seriesListRef = useRef<FlatList<Series>>(null);
  useEffect(() => {
    if (Platform.isTV) tvRowNav.setOrder(['recent', 'cw', 'movies', 'series']);
  }, []);

  // Responsive breakpoint: tablets (wide touch screens) get larger posters.
  const { width: winW } = useWindowDimensions();
  const isTablet = !Platform.isTV && winW >= TABLET_BP;
  const cardW = isTablet ? BANNER_W_TAB : BANNER_W;
  const tabletCardStyle = useMemo(
    () => (isTablet ? { width: BANNER_W_TAB, height: BANNER_H_TAB, borderRadius: 12 } : undefined),
    [isTablet],
  );

  const scrollRowToIndex = useCallback((listRef: React.RefObject<FlatList<any> | null>, index: number) => {
    if (!Platform.isTV) return;
    try {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
    } catch {}
  }, []);

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
    const t = setTimeout(() => requestTvFocus(firstItemRef.current), 200);
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

  // TV: BACK anywhere on the Home tab returns the D-pad cursor to the nav menu
  // (user request — BACK from any rail should land on the sidebar, not pop
  // navigation history or do nothing).
  useBackHandler(() => {
    if (!Platform.isTV) return false;
    sidebarNav.focus();
    return true;
  });

  const renderContinueWatching = useCallback(({ item, index }: { item: WatchHistoryEntry; index: number }) => {
    const progress = item.type === 'series'
      ? seriesProgressMap.get(item.parentId ?? item.id)
      : movieProgressMap.get(item.id);
    const pct = progress != null ? Math.max(2, Math.min(100, progress * 100)) : 0;
    return (
      <FocusablePressable
        ref={Platform.isTV ? ((el: any) => tvRowNav.register('cw', index, el)) as any : undefined}
        style={Platform.isTV ? styles.tvBannerOuter : [styles.bannerOuter, tabletCardStyle]}
        focusedStyle={styles.bannerFocused}
        // TV: LEFT on the first card jumps to the sidebar nav menu
        nextFocusLeft={Platform.isTV && index === 0 ? sidebarNav.handle : undefined}
        onFocus={() => {
          tvRowNav.focused('cw', index);
          scrollRowToIndex(cwListRef, index);
        }}
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
  }, [colors, handleHistoryItemPress, movieProgressMap, seriesProgressMap, scrollRowToIndex, tabletCardStyle]);

  const renderMovie = useCallback(({ item, index }: { item: Movie; index: number }) => (
    // First movie card carries the TV focus ref now that the hero banner is
    // gone — the D-pad needs an initial focus target when Home becomes active.
    <MovieBanner
      ref={(el: View | null) => {
        if (Platform.isTV) tvRowNav.register('movies', index, el);
        if (index === 0) (firstItemRef as React.MutableRefObject<View | null>).current = el;
      }}
      movie={item}
      colors={colors}
      cardStyle={Platform.isTV ? styles.tvBannerOuter : tabletCardStyle && [styles.bannerOuter, tabletCardStyle]}
      nextFocusLeft={Platform.isTV && index === 0 ? sidebarNav.handle : undefined}
      onCardFocus={() => {
        tvRowNav.focused('movies', index);
        scrollRowToIndex(movieListRef, index);
      }}
      onPress={() => handleMoviePress(item)}
    />
  ), [colors, handleMoviePress, scrollRowToIndex, tabletCardStyle]);

  const renderSeries = useCallback(({ item, index }: { item: Series; index: number }) => (
    <SeriesBanner
      ref={Platform.isTV ? ((el: View | null) => tvRowNav.register('series', index, el)) : undefined}
      series={item}
      colors={colors}
      cardStyle={Platform.isTV ? styles.tvBannerOuter : tabletCardStyle && [styles.bannerOuter, tabletCardStyle]}
      nextFocusLeft={Platform.isTV && index === 0 ? sidebarNav.handle : undefined}
      onCardFocus={() => {
        tvRowNav.focused('series', index);
        scrollRowToIndex(seriesListRef, index);
      }}
      onPress={() => handleSeriesPress(item)}
    />
  ), [colors, handleSeriesPress, scrollRowToIndex, tabletCardStyle]);

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

  // ── TV: fixed dashboard — every section shares the 16:9 viewport, no page
  // scrolling.  Each flexible section gets an equal share of the leftover
  // height after the (intrinsically sized) Recently Watched rail; cards fill
  // their row via height:100% + a fixed aspect ratio, so nothing is squashed —
  // rows simply divide the screen and the rails scroll horizontally only.
  if (Platform.isTV) {
    return (
      <View style={[styles.root, styles.tvRoot, { backgroundColor: colors.background }]}>
        <RecentChannelsRail
          blockedIds={blockedIdSet}
          nowPlayingMap={emptyNowPlayingMap}
          onWatchFullscreen={handleRecentChannelWatch}
        />

        {continueWatchingItems.length > 0 && (
          <Section title="Continue Watching" isLoading={false} colors={colors} tv>
            <FlatList
              ref={cwListRef}
              onScrollToIndexFailed={(info) => {
                try { cwListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true }); } catch {}
              }}
              data={continueWatchingItems}
              keyExtractor={(e) => e.id}
              renderItem={renderContinueWatching}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.tvRail}
              contentContainerStyle={styles.tvBannerList}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              removeClippedSubviews={false}
            />
          </Section>
        )}

        <Section title="Latest Movies" isLoading={moviesLoading} colors={colors} tv>
          <FlatList
            ref={movieListRef}
            onScrollToIndexFailed={(info) => {
              try { movieListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true }); } catch {}
            }}
            data={latestMovies}
            keyExtractor={(m) => m.id}
            renderItem={renderMovie}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tvRail}
            contentContainerStyle={styles.tvBannerList}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            removeClippedSubviews={false}
          />
        </Section>

        <Section title="Latest TV Shows" isLoading={seriesLoading} colors={colors} tv>
          <FlatList
            ref={seriesListRef}
            onScrollToIndexFailed={(info) => {
              try { seriesListRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true }); } catch {}
            }}
            data={latestSeries}
            keyExtractor={(s) => s.id}
            renderItem={renderSeries}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tvRail}
            contentContainerStyle={styles.tvBannerList}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            removeClippedSubviews={false}
          />
        </Section>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero "featured movie" banner removed per user request — Home now
          starts directly with the Recently Watched rail. The TV D-pad focus
          ref moved to the first Latest Movies card. */}

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
            getItemLayout={(_, i) => ({ length: cardW + 10, offset: (cardW + 10) * i, index: i })}
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
          getItemLayout={(_, i) => ({ length: cardW + 10, offset: (cardW + 10) * i, index: i })}
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
          getItemLayout={(_, i) => ({ length: cardW + 10, offset: (cardW + 10) * i, index: i })}
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

  // ── TV fixed dashboard ──
  tvRoot: {
    paddingTop: 4,
    paddingBottom: 8,
  },
  tvSection: {
    flex: 1,
    minHeight: 0,
    marginTop: 4,
  },
  tvSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    marginBottom: 3,
  },
  tvSectionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  tvSectionSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  tvSectionBody: { flex: 1, minHeight: 0 },
  tvLoadingRow: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tvRail: { flex: 1 },
  // 6dp vertical padding (3dp top + 3dp bottom) gives the 3px focus ring
  // clearance so it is not flush against the FlatList clip boundary.
  // At 720p (~640dp usable) with all 4 sections the body is ~154dp before
  // this inset and ~148dp after — well above the ~80dp legibility floor.
  tvBannerList: { paddingHorizontal: 14, paddingVertical: 3, gap: 8, alignItems: 'stretch' },
  // Card fills its row's height (minus the 3dp inset on each side);
  // width follows from the banner aspect ratio.
  tvBannerOuter: {
    height: '100%',
    aspectRatio: BANNER_W / BANNER_H,
    borderRadius: 10,
  },

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
