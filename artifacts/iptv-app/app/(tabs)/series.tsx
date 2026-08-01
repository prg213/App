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
import { SeriesCard } from '@/components/SeriesCard';
import { MovieCardSkeleton } from '@/components/SkeletonCard';
import { ContinueWatchingRail } from '@/components/ContinueWatchingRail';
import { getXtreamSeriesCategories, getXtreamSeries } from '@/services/xtreamApi';
import { StorageService } from '@/services/storage';
import { fetchRemoteFavourites, pushRemoteSeries, mergeFavourites } from '@/services/favoritesSync';
import type { Series, Category, FavoriteSeries } from '@/types';

const ALL_CAT_ID = '__all';
const FAVS_CAT_ID = '__favs';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function SeriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { credentials, deviceMac } = useAppContext();
  const { maxRating } = useParentalContext();
  const [selectedCat, setSelectedCat] = useState<string>(ALL_CAT_ID);
  const [search, setSearch] = useState('');
  const [favSeries, setFavSeries] = useState<FavoriteSeries[]>([]);
  const isXtream = credentials?.type === 'xtream';

  useEffect(() => {
    StorageService.getSeriesFavorites().then(async (local) => {
      setFavSeries(local);
      const remote = await fetchRemoteFavourites(deviceMac);
      if (remote) {
        const merged = mergeFavourites(remote.series, local);
        await StorageService.saveSeriesFavorites(merged);
        setFavSeries(merged);
      }
    });
  }, [deviceMac]);

  const favSet = useMemo(() => new Set(favSeries.map((f) => f.id)), [favSeries]);
  const isFavsSelected = selectedCat === FAVS_CAT_ID;
  const isAllSelected = selectedCat === ALL_CAT_ID;

  const { data: rawCategories = [] } = useQuery<Category[]>({
    queryKey: ['series-categories', credentials],
    queryFn: () => getXtreamSeriesCategories(buildCreds(credentials)),
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

  const { data: fetchedSeries = [], isLoading, refetch, isRefetching } = useQuery<Series[]>({
    queryKey: ['series-list', queryCategory, credentials],
    queryFn: () => getXtreamSeries(buildCreds(credentials), queryCategory),
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

  // Sort fetched series newest first (highest series_id = most recently added)
  const sortedSeries: Series[] = useMemo(
    () => [...fetchedSeries].sort((a, b) => parseInt(b.id) - parseInt(a.id)),
    [fetchedSeries],
  );

  const seriesList: Series[] = useMemo(() => {
    if (isFavsSelected) {
      return favSeries.map((f) => ({
        id: f.id,
        name: f.name,
        cover: f.cover,
        rating: f.rating,
        genre: f.genre,
        categoryId: f.categoryId,
        plot: f.plot,
        cast: f.cast,
        director: f.director,
      }));
    }
    return sortedSeries;
  }, [isFavsSelected, favSeries, sortedSeries]);

  const filtered = useMemo(() => {
    let list = seriesList;
    if (search.trim()) list = list.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
    // Hide content above the parental rating ceiling
    if (maxRating !== 'all') list = list.filter((s) => !isContentBlocked(s.rating, maxRating));
    return list;
  }, [seriesList, search, maxRating]);

  const handleToggleFav = useCallback(async (item: Series) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleSeriesFavorite({
      id: item.id,
      name: item.name,
      cover: item.cover,
      rating: item.rating,
      genre: item.genre,
      categoryId: item.categoryId,
      plot: item.plot,
      cast: item.cast,
      director: item.director,
    });
    setFavSeries(updated);
    // Sync only series to the server — other categories remain untouched.
    pushRemoteSeries(deviceMac, updated);
  }, [deviceMac]);

  const handleRefresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['series-categories'] });
    queryClient.invalidateQueries({ queryKey: ['series-list'] });
  };

  if (!isXtream) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Text style={{ fontSize: 36, color: colors.mutedForeground }}>📺</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Requires Xtream Codes</Text>
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
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 6 }]}>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>TV Series</Text>
          <TextInput
            style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Search series..."
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
        <ContinueWatchingRail type="series" />

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
            <Text style={{ fontSize: 36, color: colors.mutedForeground }}>{isFavsSelected ? '♡' : '📺'}</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {isFavsSelected ? 'No favourite series yet' : 'No series found'}
            </Text>
            {isFavsSelected && (
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Tap ♡ on any series poster to save it here.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            numColumns={4}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <SeriesCard
                id={item.id}
                name={item.name}
                cover={item.cover}
                rating={item.rating}
                genre={item.genre}
                query={search}
                isFav={favSet.has(item.id)}
                compact={isFavsSelected}
                onFavPress={() => handleToggleFav(item)}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/series/[id]', params: { id: item.id, title: item.name, cover: item.cover ?? '', rating: item.rating ?? '', genre: item.genre ?? '', plot: item.plot ?? '', cast: item.cast ?? '', director: item.director ?? '' } });
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
