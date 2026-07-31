import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { MovieCard } from '@/components/MovieCard';
import { MovieCardSkeleton } from '@/components/SkeletonCard';
import { ContinueWatchingRail } from '@/components/ContinueWatchingRail';
import { getXtreamVodCategories, getXtreamVodStreams } from '@/services/xtreamApi';
import { StorageService } from '@/services/storage';
import { fetchRemoteFavourites, pushRemoteMovies, mergeFavourites } from '@/services/favoritesSync';
import type { Movie, Category, FavoriteMovie } from '@/types';

const ALL_CAT_ID = '__all';
const FAVS_CAT_ID = '__favs';

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
  const [favMovies, setFavMovies] = useState<FavoriteMovie[]>([]);
  const isXtream = credentials?.type === 'xtream';

  useEffect(() => {
    StorageService.getMovieFavorites().then(async (local) => {
      setFavMovies(local);
      const remote = await fetchRemoteFavourites(deviceMac);
      if (remote) {
        const merged = mergeFavourites(remote.movies, local);
        await StorageService.saveMovieFavorites(merged);
        setFavMovies(merged);
      }
    });
  }, [deviceMac]);

  const favSet = useMemo(() => new Set(favMovies.map((f) => f.id)), [favMovies]);
  const isFavsSelected = selectedCat === FAVS_CAT_ID;
  const isAllSelected = selectedCat === ALL_CAT_ID;

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
      ...rawCategories,
    ],
    [rawCategories],
  );

  // Pass undefined when All is selected so the API returns everything
  const queryCategory = isAllSelected || isFavsSelected ? undefined : selectedCat;

  const { data: fetchedMovies = [], isLoading, refetch, isRefetching } = useQuery<Movie[]>({
    queryKey: ['vod-streams', queryCategory, credentials],
    queryFn: () => getXtreamVodStreams(buildCreds(credentials), queryCategory),
    enabled: !!credentials && isXtream && !isFavsSelected,
    staleTime: 5 * 60_000,
  });

  // Silently refresh the list whenever the user navigates to this tab so newly
  // added provider content appears without requiring a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      if (credentials && isXtream && !isFavsSelected) {
        refetch();
      }
    }, [credentials, isXtream, isFavsSelected, refetch]),
  );

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
    return sortedMovies;
  }, [isFavsSelected, favMovies, sortedMovies]);

  const filtered = useMemo(() => {
    let list = movies;
    if (search.trim()) list = list.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()));
    // Hide content above the parental rating ceiling
    if (maxRating !== 'all') list = list.filter((m) => !isContentBlocked(m.rating, maxRating));
    return list;
  }, [movies, search, maxRating]);

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
    setFavMovies(updated);
    // Sync only movies to the server — other categories remain untouched.
    pushRemoteMovies(deviceMac, updated);
  }, [deviceMac]);

  const handleRefresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['vod-categories'] });
    queryClient.invalidateQueries({ queryKey: ['vod-streams'] });
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
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Left category panel */}
      <View style={[styles.catPanel, { backgroundColor: '#0E0E1A', borderRightColor: colors.border, paddingTop: insets.top + 8 }]}>
        <Text style={[styles.catTitle, { color: colors.mutedForeground }]}>CATEGORIES</Text>
        <FlatList
          data={categories}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const active = selectedCat === item.id;
            return (
              <TouchableOpacity
                style={[styles.catItem, active && { backgroundColor: 'rgba(59,130,246,0.15)' }]}
                onPress={() => setSelectedCat(item.id)}
                activeOpacity={0.7}
              >
                {active && <View style={styles.catPip} />}
                <Text style={[styles.catLabel, { color: active ? '#F2F2F2' : colors.mutedForeground }]} numberOfLines={1}>
                  {item.name}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Right content */}
      <View style={[styles.content, { paddingRight: insets.right }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 6 }]}>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>Movies</Text>
          <TextInput
            style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Search movies..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          <TouchableOpacity
            style={[styles.refreshBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            onPress={handleRefresh}
            activeOpacity={0.7}
          >
            <Text style={[styles.refreshIcon, { color: isRefetching ? colors.primary : colors.mutedForeground }]}>↻</Text>
          </TouchableOpacity>
        </View>

        {/* Continue Watching rail */}
        <ContinueWatchingRail type="movie" />

        {isLoading && !isFavsSelected ? (
          <FlatList
            data={Array.from({ length: 16 })}
            numColumns={4}
            keyExtractor={(_, i) => String(i)}
            renderItem={() => <MovieCardSkeleton />}
            contentContainerStyle={styles.grid}
            scrollEnabled={false}
          />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={{ fontSize: 36, color: colors.mutedForeground }}>{isFavsSelected ? '♡' : '🎬'}</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {isFavsSelected ? 'No favourite movies yet' : 'No movies found'}
            </Text>
            {isFavsSelected && (
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Tap ♡ on any movie poster to save it here.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            numColumns={4}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <MovieCard
                id={item.id}
                name={item.name}
                cover={item.cover}
                rating={item.rating}
                genre={item.genre}
                isFav={favSet.has(item.id)}
                compact={isFavsSelected}
                onFavPress={() => handleToggleFav(item)}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/movie/[id]', params: { id: item.id, title: item.name, cover: item.cover ?? '', genre: item.genre ?? '', rating: item.rating ?? '', plot: item.plot ?? '', cast: item.cast ?? '', director: item.director ?? '', releaseDate: item.releaseDate ?? '', duration: item.duration ?? '', ext: item.containerExtension } });
                }}
              />
            )}
            contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + 8 }]}
            refreshControl={!isFavsSelected ? <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} /> : undefined}
            showsVerticalScrollIndicator={false}
            initialNumToRender={16}
            maxToRenderPerBatch={16}
          />
        )}
      </View>
    </View>
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
  searchInput: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, fontSize: 13, fontFamily: 'Inter_400Regular' },
  refreshBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  refreshIcon: { fontSize: 17, fontWeight: '600' },
  grid: { paddingHorizontal: 8, paddingTop: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 },
});
