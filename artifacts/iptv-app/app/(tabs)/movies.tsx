import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { CategoryPills } from '@/components/CategoryPills';
import { MovieCard } from '@/components/MovieCard';
import { MovieCardSkeleton } from '@/components/SkeletonCard';
import {
  getXtreamVodCategories,
  getXtreamVodStreams,
} from '@/services/xtreamApi';
import type { Movie, Category } from '@/types';

function buildXtreamCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function MoviesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const isXtream = credentials?.type === 'xtream';

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['vod-categories', credentials],
    queryFn: () => getXtreamVodCategories(buildXtreamCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 10 * 60_000,
  });

  const { data: movies = [], isLoading, refetch, isRefetching } = useQuery<Movie[]>({
    queryKey: ['vod-streams', selectedCat, credentials],
    queryFn: () =>
      getXtreamVodStreams(buildXtreamCreds(credentials), selectedCat ?? undefined),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return movies;
    const q = search.toLowerCase();
    return movies.filter((m) => m.name.toLowerCase().includes(q));
  }, [movies, search]);

  if (!isXtream) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Movies</Text>
        </View>
        <View style={styles.empty}>
          <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>🎬</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Movies require Xtream Codes</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Your current connection type (M3U) does not support on-demand content.
          </Text>
        </View>
      </View>
    );
  }

  const renderItem = ({ item, index }: { item: Movie; index: number }) => (
    <MovieCard
      id={item.id}
      name={item.name}
      cover={item.cover}
      rating={item.rating}
      genre={item.genre}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({
          pathname: '/movie/[id]',
          params: {
            id: item.id,
            title: item.name,
            cover: item.cover ?? '',
            genre: item.genre ?? '',
            rating: item.rating ?? '',
            plot: item.plot ?? '',
            cast: item.cast ?? '',
            director: item.director ?? '',
            releaseDate: item.releaseDate ?? '',
            duration: item.duration ?? '',
            ext: item.containerExtension,
          },
        });
      }}
    />
  );

  const skeletons = Array.from({ length: 12 });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Movies</Text>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Search movies..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <CategoryPills
        categories={categories}
        selected={selectedCat}
        onSelect={setSelectedCat}
      />

      {isLoading ? (
        <FlatList
          data={skeletons}
          numColumns={2}
          keyExtractor={(_, i) => String(i)}
          renderItem={() => <MovieCardSkeleton />}
          contentContainerStyle={styles.grid}
          scrollEnabled={false}
        />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>🎬</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No movies found</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {search ? 'Try a different search' : 'No movies in this category'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          numColumns={2}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 84 : 80) },
          ]}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    paddingTop: 8,
  },
  searchInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  grid: {
    paddingHorizontal: 11,
    paddingTop: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
