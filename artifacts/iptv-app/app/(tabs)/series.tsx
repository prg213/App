import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { CategoryPills } from '@/components/CategoryPills';
import { SeriesCard } from '@/components/SeriesCard';
import { MovieCardSkeleton } from '@/components/SkeletonCard';
import {
  getXtreamSeriesCategories,
  getXtreamSeries,
} from '@/services/xtreamApi';
import type { Series, Category } from '@/types';

function buildXtreamCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function SeriesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const queryClient = useQueryClient();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const handleRefresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['series-categories'] });
    queryClient.invalidateQueries({ queryKey: ['series-list'] });
  };

  const isXtream = credentials?.type === 'xtream';

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['series-categories', credentials],
    queryFn: () => getXtreamSeriesCategories(buildXtreamCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 10 * 60_000,
  });

  const { data: series = [], isLoading, refetch, isRefetching } = useQuery<Series[]>({
    queryKey: ['series-list', selectedCat, credentials],
    queryFn: () =>
      getXtreamSeries(buildXtreamCreds(credentials), selectedCat ?? undefined),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return series;
    const q = search.toLowerCase();
    return series.filter((s) => s.name.toLowerCase().includes(q));
  }, [series, search]);

  if (!isXtream) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>TV Series</Text>
        </View>
        <View style={styles.empty}>
          <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>📺</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Series require Xtream Codes</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Your current connection type (M3U) does not support on-demand content.
          </Text>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }: { item: Series }) => (
    <SeriesCard
      id={item.id}
      name={item.name}
      cover={item.cover}
      rating={item.rating}
      genre={item.genre}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({
          pathname: '/series/[id]',
          params: {
            id: item.id,
            title: item.name,
            cover: item.cover ?? '',
            rating: item.rating ?? '',
            genre: item.genre ?? '',
            plot: item.plot ?? '',
            cast: item.cast ?? '',
            director: item.director ?? '',
          },
        });
      }}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>TV Series</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={[styles.refreshBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.refreshIcon, { color: isRefetching ? colors.primary : colors.mutedForeground }]}>↻</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Search series..."
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
          data={Array.from({ length: 12 })}
          numColumns={2}
          keyExtractor={(_, i) => String(i)}
          renderItem={() => <MovieCardSkeleton />}
          contentContainerStyle={styles.grid}
          scrollEnabled={false}
        />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>📺</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No series found</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {search ? 'Try a different search' : 'No series in this category'}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  refreshBtn: {
    marginLeft: 'auto',
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshIcon: {
    fontSize: 18,
    fontWeight: '600',
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
