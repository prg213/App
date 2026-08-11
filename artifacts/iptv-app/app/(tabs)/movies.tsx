import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FocusablePressable } from '@/components/FocusablePressable';
import { TrailerModal } from '@/components/TrailerModal';
import {
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TVTextInput } from '@/components/TVTextInput';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getTmdbTrailerCandidates, getTmdbPosterUrl } from '@/services/tmdb';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { MovieCard } from '@/components/MovieCard';
import { MovieCardSkeleton } from '@/components/SkeletonCard';
import { Toast } from '@/components/Toast';
import { getXtreamVodCategories, getXtreamVodStreams } from '@/services/xtreamApi';
import { StorageService } from '@/services/storage';
import { SwipeToDeleteCard } from '@/components/SwipeToDeleteCard';
import { fetchRemoteFavourites, pushRemoteMovies, mergeFavourites } from '@/services/favoritesSync';
import type { Movie, Category, FavoriteMovie, WatchHistoryEntry } from '@/types';
import { normaliseStr } from '@/utils/normalise';
import { buildMovieProgressMap } from '@/utils/progressMap';

const ALL_CAT_ID = '__all';
const FAVS_CAT_ID = '__favs';
const RECENT_CAT_ID = '__recent';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function MoviesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { credentials, deviceMac } = useAppContext();
  const { maxRating } = useParentalContext();
  const [selectedCat, setSelectedCat] = useState<string>(ALL_CAT_ID);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [favMovies, setFavMovies] = useState<FavoriteMovie[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const [favSyncState, setFavSyncState] = useState<'idle' | 'syncing' | 'synced'>('idle');
  // #23: queue a failed push so it retries next time this screen mounts
  const pendingFavPushRef = useRef<FavoriteMovie[] | null>(null);
  const isXtream = credentials?.type === 'xtream';
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerVideoIds, setTrailerVideoIds] = useState<string[] | 'loading' | null>(null);

  useEffect(() => {
    StorageService.getMovieFavorites().then(async (local) => {
      setFavMovies(local);
      setFavSyncState('syncing');
      const remote = await fetchRemoteFavourites(deviceMac);
      if (remote) {
        const merged = mergeFavourites(remote.movies, local);
        await StorageService.saveMovieFavorites(merged);
        setFavMovies(merged);
        // #21: push back any items added while offline
        if (merged.length > remote.movies.length) {
          pushRemoteMovies(deviceMac, merged).then((ok) => {
            if (!ok) pendingFavPushRef.current = merged;
          });
        }
      } else if (pendingFavPushRef.current) {
        // Retry previously-queued push now that we have connectivity
        const toRetry = pendingFavPushRef.current;
        pushRemoteMovies(deviceMac, toRetry).then((ok) => {
          if (ok) pendingFavPushRef.current = null;
        });
      }
      setFavSyncState('synced');
      setTimeout(() => setFavSyncState('idle'), 2000);
    }).catch(() => setFavSyncState('idle'));
  }, [deviceMac]);

  const favSet = useMemo(() => new Set(favMovies.map((f) => f.id)), [favMovies]);
  const isFavsSelected = selectedCat === FAVS_CAT_ID;
  const isAllSelected = selectedCat === ALL_CAT_ID;
  const isRecentSelected = selectedCat === RECENT_CAT_ID;

  // Map movie id → watch progress (0–1), using the most-recent history entry
  // (history is stored newest-first so the first match wins).
  const movieProgressMap = useMemo(() => buildMovieProgressMap(watchHistory), [watchHistory]);

  const { data: rawCategories = [] } = useQuery<Category[]>({
    queryKey: ['vod-categories', credentials],
    queryFn: () => getXtreamVodCategories(buildCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 10 * 60_000,
  });

  const categories: Category[] = useMemo(
    () => [
      { id: ALL_CAT_ID, name: '◈ All' },
      { id: FAVS_CAT_ID, name: '♥ Favourites' },
      { id: RECENT_CAT_ID, name: '🕒 Recently Watched' },
      ...rawCategories,
    ],
    [rawCategories],
  );

  // Pass undefined when All is selected so the API returns everything
  const queryCategory = isAllSelected || isFavsSelected || isRecentSelected ? undefined : selectedCat;

  const { data: fetchedMovies = [], isLoading, refetch, isRefetching, isError } = useQuery<Movie[]>({
    queryKey: ['vod-streams', queryCategory, credentials],
    queryFn: () => getXtreamVodStreams(buildCreds(credentials), queryCategory),
    enabled: !!credentials && isXtream && !isFavsSelected && !isRecentSelected,
    staleTime: 5 * 60_000,
  });

  // Silently refresh the list + reload history whenever the user navigates here.
  // Refresh callback also re-loads watch history so pull-to-refresh works for Recent
  const refreshWatchHistory = useCallback(() => {
    StorageService.getWatchHistory().then((h) =>
      setWatchHistory(h.filter((e) => e.type === 'movie')),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshWatchHistory();
      if (credentials && isXtream && !isFavsSelected && !isRecentSelected) {
        refetch();
      }
    }, [credentials, isXtream, isFavsSelected, isRecentSelected, refetch, refreshWatchHistory]),
  );

  // Persist sort order across sessions
  useEffect(() => {
    import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
      AS.getItem('@pref_movie_sort').then((v) => {
        if (v === 'name' || v === 'rating' || v === 'newest') setSortOrder(v as 'newest' | 'name' | 'rating');
      })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sort fetched movies newest first (highest stream_id = most recently added)
  const sortedMovies: Movie[] = useMemo(
    () => [...fetchedMovies].sort((a, b) => parseInt(b.id) - parseInt(a.id)),
    [fetchedMovies],
  );

  const movies: Movie[] = useMemo(() => {
    if (isFavsSelected) {
      return favMovies.map((f) => ({
        id: f.id,
        name: f.name,
        categoryId: f.categoryId,
        streamId: f.streamId,
        containerExtension: f.containerExtension,
        cover: f.cover,
        rating: f.rating,
        genre: f.genre,
        plot: f.plot,
        cast: f.cast,
        director: f.director,
        releaseDate: f.releaseDate,
        duration: f.duration,
      }));
    }
    if (isRecentSelected) {
      return [...watchHistory]
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((e) => ({
          id: e.id,
          name: e.title,
          cover: e.cover,
          categoryId: '',
          streamId: e.id,
          containerExtension: 'mp4',
        } as Movie));
    }
    return sortedMovies;
  }, [isFavsSelected, isRecentSelected, favMovies, watchHistory, sortedMovies]);

  const [sortOrder, setSortOrder] = useState<'newest' | 'name' | 'rating'>('newest');
  const [sortToast, setSortToast] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // D-pad / remote back: pop through filter state before the global handler
  // focuses the sidebar.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (search) { setSearch(''); return true; }
      if (selectedCat !== ALL_CAT_ID) { setSelectedCat(ALL_CAT_ID); return true; }
      return false; // nothing to pop — global handler will focus the sidebar
    });
    return () => sub.remove();
  }, [search, selectedCat]));
  const gridRef = useRef<FlatList<Movie>>(null);
  /** TV: view node of the last D-pad-focused movie card */
  const lastFocusedCardRef = useRef<View>(null);
  /** TV: stable map of item.id → card View node */
  const cardRefMap = useRef(new Map<string, View>());
  /** TV: first category item — used as initial focus target on first screen entry */
  const firstCatItemRef = useRef<View>(null);

  // TV: restore D-pad focus to the last focused card on return from detail.
  // On first entry (no prior card) focus the first category item so the
  // remote cursor has a deterministic starting point rather than relying on
  // the native Android TV focus heuristic (which can land anywhere).
  useFocusEffect(useCallback(() => {
    if (!Platform.isTV) return;
    const node = lastFocusedCardRef.current;
    if (node) {
      const t = setTimeout(() => (node as any)?.focus?.(), 200);
      return () => clearTimeout(t);
    }
    // No prior card — focus the first category item.
    const t = setTimeout(() => (firstCatItemRef.current as any)?.focus?.(), 200);
    return () => clearTimeout(t);
  }, []));

  // Scroll back to top and clear search whenever the category changes
  useEffect(() => {
    gridRef.current?.scrollToOffset({ offset: 0, animated: false });
    setShowScrollTop(false);
    setSearch('');
  }, [selectedCat]);
  const cycleSortOrder = useCallback(() => {
    setSortOrder((s) => {
      const next = s === 'newest' ? 'name' : s === 'name' ? 'rating' : 'newest';
      const label = next === 'newest' ? 'Newest first' : next === 'name' ? 'Name A–Z' : 'Top rated';
      setSortToast(label);
      import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
        AS.setItem('@pref_movie_sort', next)
      );
      return next;
    });
  }, []);

  // Debounce search so rapid keystrokes don't thrash the filter useMemo
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 180);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    let list = movies;
    if (debouncedSearch.trim()) list = list.filter((m) => normaliseStr(m.name).includes(normaliseStr(debouncedSearch)));
    if (maxRating !== 'all') list = list.filter((m) => !isContentBlocked(m.rating, maxRating));

    // Apply sort (skip for favourites/recent which have their own order)
    if (!isFavsSelected && !isRecentSelected) {
      if (sortOrder === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
      else if (sortOrder === 'rating') list = [...list].sort((a, b) => parseFloat(b.rating ?? '0') - parseFloat(a.rating ?? '0'));
      // 'newest' is already the default order from sortedMovies
    }
    return list;
  }, [movies, debouncedSearch, maxRating, sortOrder, isFavsSelected, isRecentSelected]);

  // #158: Pre-warm TMDB poster cache for the first 20 visible items that have
  // no provider cover image. Fire-and-forget so the cache fills before the card
  // renders and needs to fall back to TMDB.
  useEffect(() => {
    const needsPosters = filtered.filter((m) => !m.cover).slice(0, 20);
    for (const movie of needsPosters) {
      getTmdbPosterUrl(movie.name, 'movie').catch(() => {});
    }
  }, [filtered]);

  const handleToggleFav = useCallback(async (item: Movie) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleMovieFavorite({
      id: item.id,
      name: item.name,
      cover: item.cover,
      rating: item.rating,
      genre: item.genre,
      streamId: item.streamId,
      containerExtension: item.containerExtension,
      categoryId: item.categoryId,
      plot: item.plot,
      cast: item.cast,
      director: item.director,
      releaseDate: item.releaseDate,
      duration: item.duration,
    });
    const wasAdded = updated.some((f) => f.id === item.id);
    setFavMovies(updated);
    setSortToast(wasAdded ? `♥ Added to Favourites` : `Removed from Favourites`);
    setFavSyncState('syncing');
    // #22/#23: show indicator + queue for retry if server rejects
    pushRemoteMovies(deviceMac, updated).then((ok) => {
      if (!ok) pendingFavPushRef.current = updated;
      setFavSyncState('synced');
      setTimeout(() => setFavSyncState('idle'), 2000);
    });
  }, [deviceMac]);

  const handleRefresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isFavsSelected && credentials?.deviceMac) {
      // Re-sync remote favourites when the user pull-to-refreshes in Favs mode
      fetchRemoteFavourites(credentials.deviceMac).then(async (remote) => {
        if (remote?.movies?.length) {
          const local = await StorageService.getMovieFavorites();
          const merged = mergeFavourites(remote.movies, local);
          await StorageService.saveMovieFavorites(merged);
          setFavMovies(merged);
        }
      }).catch(() => {});
    } else {
      queryClient.invalidateQueries({ queryKey: ['vod-categories'] });
      queryClient.invalidateQueries({ queryKey: ['vod-streams'] });
    }
  };

  if (!isXtream) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Text style={{ fontSize: 36, color: colors.mutedForeground }}>🎬</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Requires Xtream Codes</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>M3U connections don't support VOD</Text>
        </View>
      </View>
    );
  }

  return (
    <>
    {sortToast !== null && (
      <Toast message={sortToast} visible duration={1800} onHide={() => setSortToast(null)} />
    )}
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Left category panel */}
      <View style={[styles.catPanel, { backgroundColor: '#0E0E1A', borderRightColor: colors.border, paddingTop: insets.top + 8 }]}>
        <Text style={[styles.catTitle, { color: colors.mutedForeground }]}>CATEGORIES</Text>
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          renderItem={({ item, index }) => {
            const active = selectedCat === item.id;
            return (
              <FocusablePressable
                ref={index === 0 ? firstCatItemRef : undefined}
                style={[
                  styles.catItem,
                  active && { backgroundColor: 'rgba(59,130,246,0.15)' },
                ]}
                onPress={() => setSelectedCat(item.id)}
              >
                {active && <View style={styles.catPip} />}
                <Text
                  style={[
                    styles.catLabel,
                    { color: active ? '#F2F2F2' : colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
              </FocusablePressable>
            );
          }}
        />
      </View>

      {/* Right content */}
      <View style={[styles.content, { paddingRight: insets.right }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 6 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.screenTitle, { color: colors.foreground }]}>Movies</Text>
            {isFavsSelected && favSyncState !== 'idle' && (
              <Text style={{ fontSize: 12, fontFamily: 'Inter_500Medium', color: favSyncState === 'synced' ? '#22C55E' : colors.mutedForeground }}>
                {favSyncState === 'synced' ? '✓ Saved' : '⟳'}
              </Text>
            )}
          </View>
          <TVTextInput
            focusable
            style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Search movies..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={(t) => { setSearch(t); gridRef.current?.scrollToOffset({ offset: 0, animated: false }); }}
            clearButtonMode="while-editing"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search.trim() && !isFavsSelected && !isRecentSelected && (
            <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
              {filtered.length} result{filtered.length === 1 ? '' : 's'}
            </Text>
          )}
          {!isFavsSelected && !isRecentSelected && (
            <FocusablePressable
              style={[styles.refreshBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={cycleSortOrder}
            >
              <Text style={[styles.refreshIcon, { color: colors.primary, fontSize: 11 }]}>
                {sortOrder === 'newest' ? 'NEW' : sortOrder === 'name' ? 'A-Z' : '★'}
              </Text>
            </FocusablePressable>
          )}
          {isRecentSelected && (
            <FocusablePressable
              style={[styles.refreshBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={() => {
                StorageService.clearHistory().then(() => queryClient.invalidateQueries({ queryKey: ['watch-history'] }));
              }}
            >
              <Text style={[styles.refreshIcon, { color: '#EF4444', fontSize: 10 }]}>🗑</Text>
            </FocusablePressable>
          )}
          <FocusablePressable
            style={[styles.refreshBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            onPress={handleRefresh}
          >
            <Text style={[styles.refreshIcon, { color: isRefetching ? colors.primary : colors.mutedForeground }]}>↻</Text>
          </FocusablePressable>
        </View>

        {isLoading && !isFavsSelected ? (
          <FlatList
            data={Array.from({ length: 16 })}
            numColumns={4}
            keyExtractor={(_, i) => String(i)}
            renderItem={() => <MovieCardSkeleton />}
            contentContainerStyle={styles.grid}
            scrollEnabled={false}
          />
        ) : isError ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36, color: colors.mutedForeground }}>⚠️</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load movies</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Check your connection or provider settings, then pull down to retry.
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36, color: colors.mutedForeground }}>
              {isFavsSelected ? '♡' : isRecentSelected ? '🕒' : search.trim() ? '🔍' : '🎬'}
            </Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {isFavsSelected ? 'No favourite movies yet'
                : isRecentSelected ? 'No recently watched movies'
                : search.trim() ? `No results for "${search.trim()}"`
                : 'No movies found'}
            </Text>
            {isFavsSelected && (
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Tap ♡ on any movie poster to save it here.
              </Text>
            )}
            {isRecentSelected && (
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Movies you watch will appear here automatically.
              </Text>
            )}
            {search.trim() && !isFavsSelected && !isRecentSelected && (
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Try a different search term or browse by category.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            ref={gridRef}
            data={filtered}
            numColumns={4}
            keyExtractor={(item) => item.id}
            columnWrapperStyle={{ justifyContent: 'flex-start' }}
            onScroll={(e) => setShowScrollTop(e.nativeEvent.contentOffset.y > 300)}
            scrollEventThrottle={200}
            removeClippedSubviews={false}
            renderItem={({ item }) => {
              const card = (
              <MovieCard
                ref={(node: View | null) => {
                  if (node) cardRefMap.current.set(item.id, node);
                  else cardRefMap.current.delete(item.id);
                }}
                onFocus={() => {
                  const node = cardRefMap.current.get(item.id);
                  if (node) lastFocusedCardRef.current = node;
                }}
                id={item.id}
                name={item.name}
                cover={item.cover}
                rating={item.rating}
                genre={item.genre}
                year={item.releaseDate ? item.releaseDate.slice(0, 4) : undefined}
                query={search}
                isFav={favSet.has(item.id)}
                compact={isFavsSelected}
                progress={isRecentSelected ? movieProgressMap.get(item.id) : undefined}
                cardStyle={isRecentSelected ? { flex: 1, maxWidth: '100%' } : undefined}
                onFavPress={() => handleToggleFav(item)}
                onLongPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  const isFav = favSet.has(item.id);
                  Alert.alert(item.name, undefined, [
                    { text: isFav ? '♥ Remove Favourite' : '♡ Add to Favourites', onPress: () => handleToggleFav(item) },
                    ...(isFav ? [{ text: '⬆ Move to Top', onPress: async () => { const updated = await StorageService.moveMovieToTop(item.id); if (updated) setFavMovies(updated); } }] : []),
                    { text: '🎬 Open Details', onPress: () => router.push({ pathname: '/movie/[id]', params: { id: item.id, title: item.name, cover: item.cover ?? '', genre: item.genre ?? '', rating: item.rating ?? '', plot: item.plot ?? '', cast: item.cast ?? '', director: item.director ?? '', releaseDate: item.releaseDate ?? '', duration: item.duration ?? '', ext: item.containerExtension } }) },
                    ...(isRecentSelected ? [{ text: '🗑 Remove from History', style: 'destructive' as const, onPress: () => { StorageService.removeFromHistory(item.id).then(refreshWatchHistory); } }] : []),
                    { text: 'Cancel', style: 'cancel' },
                  ]);
                }}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const histEntry = isRecentSelected ? watchHistory.find((e) => e.id === item.id) : undefined;
                  router.push({ pathname: '/movie/[id]', params: { id: item.id, title: item.name, cover: item.cover ?? '', genre: item.genre ?? '', rating: item.rating ?? '', plot: item.plot ?? '', cast: item.cast ?? '', director: item.director ?? '', releaseDate: item.releaseDate ?? '', duration: item.duration ?? '', ext: item.containerExtension, ...(histEntry?.position ? { resumePosition: String(Math.floor(histEntry.position)) } : {}) } });
                }}
                onTrailerPress={async () => {
                  setTrailerLoading(true);
                  try {
                    const raw = item.trailerUrl;
                    const ytId = raw
                      ? raw.startsWith('http')
                        ? (raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ?? null)
                        : (raw.length === 11 ? raw : null)
                      : null;
                    const resolved = ytId ?? (await getTmdbTrailerCandidates(item.name, 'movie'))[0] ?? null;
                    if (resolved) {
                      setTrailerVideoIds([resolved]);
                    } else {
                      Alert.alert('No Trailer', 'No trailer found for this title.');
                    }
                  } finally {
                    setTrailerLoading(false);
                  }
                }}
              />
              );
              if (isRecentSelected) {
                return (
                  <SwipeToDeleteCard
                    key={item.id}
                    containerStyle={{ flex: 1, maxWidth: '25%' }}
                    onDelete={() => StorageService.removeFromHistory(item.id).then(refreshWatchHistory)}
                  >
                    {card}
                  </SwipeToDeleteCard>
                );
              }
              return card;
            }}
            contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 8 }]}
            refreshControl={!isFavsSelected ? (
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => { refetch(); if (isRecentSelected) refreshWatchHistory(); }}
                tintColor={colors.primary}
              />
            ) : undefined}
            showsVerticalScrollIndicator={false}
            initialNumToRender={16}
            maxToRenderPerBatch={16}
          />
        )}
      </View>
    </View>
    {showScrollTop && (
      <FocusablePressable
        style={[styles.scrollTopFab, { backgroundColor: colors.primary }]}
        onPress={() => gridRef.current?.scrollToOffset({ offset: 0, animated: true })}
      >
        <Text style={styles.scrollTopIcon}>↑</Text>
      </FocusablePressable>
    )}
    <TrailerModal videoIds={trailerVideoIds} onClose={() => setTrailerVideoIds(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  catPanel: { width: 170, borderRightWidth: StyleSheet.hairlineWidth },
  catTitle: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, paddingHorizontal: 14, paddingBottom: 8 },
  catItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, position: 'relative' },
  catPip: { position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, backgroundColor: '#3B82F6', borderRadius: 99 },
  catLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  content: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  screenTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, marginRight: 4 },
  searchInput: { flex: 1, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, fontFamily: 'Inter_400Regular', textAlignVertical: 'center', height: 38 },
  refreshBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  refreshIcon: { fontSize: 17, fontWeight: '600' },
  resultCount: { fontSize: 11, marginHorizontal: 4, flexShrink: 1 },
  grid: { paddingHorizontal: 8, paddingTop: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 },
  scrollTopFab: { position: 'absolute', bottom: 24, right: 16, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 6 },
  scrollTopIcon: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
});
