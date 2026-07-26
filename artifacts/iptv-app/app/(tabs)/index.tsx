import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { ChannelCard } from '@/components/ChannelCard';
import { ChannelCardSkeleton } from '@/components/SkeletonCard';
import { StorageService } from '@/services/storage';
import {
  getXtreamLiveCategories,
  getXtreamLiveStreams,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel, Category, FavoriteChannel } from '@/types';

function buildXtreamCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = React.useState<FavoriteChannel[]>([]);

  React.useEffect(() => {
    StorageService.getFavorites().then(setFavorites);
  }, []);

  // Load categories
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['live-categories', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') {
        return getXtreamLiveCategories(buildXtreamCreds(credentials));
      }
      if (credentials.m3uUrl) {
        const { categories: cats } = await fetchAndParseM3U(credentials.m3uUrl);
        return cats;
      }
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  // Load channels
  const {
    data: channels = [],
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<Channel[]>({
    queryKey: ['live-channels', selectedCat, credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') {
        return getXtreamLiveStreams(buildXtreamCreds(credentials), selectedCat ?? undefined);
      }
      if (credentials.m3uUrl) {
        const { channels: all } = await fetchAndParseM3U(credentials.m3uUrl);
        return selectedCat ? all.filter((c) => c.groupTitle === selectedCat) : all;
      }
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, search]);

  const favSet = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const handlePlay = useCallback(
    (ch: Channel) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push({
        pathname: '/player',
        params: {
          url: ch.streamUrl,
          title: ch.name,
          type: 'live',
          logo: ch.logo ?? '',
        },
      });
    },
    [router],
  );

  const handleLongPress = useCallback(
    async (ch: Channel) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const fav: FavoriteChannel = {
        id: ch.id,
        name: ch.name,
        logo: ch.logo,
        groupTitle: ch.groupTitle,
        streamUrl: ch.streamUrl,
      };
      const updated = await StorageService.toggleFavorite(fav);
      setFavorites(updated);
    },
    [],
  );

  const webTopPad = Platform.OS === 'web' ? 67 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + webTopPad, borderBottomColor: colors.border }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>Live TV</Text>
          <View style={[styles.liveBadge, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>LIVE</Text>
          </View>
        </View>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Search channels..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Categories */}
      <CategoryPills
        categories={categories}
        selected={selectedCat}
        onSelect={setSelectedCat}
      />

      {/* Content */}
      {isLoading ? (
        <FlatList
          data={Array.from({ length: 12 })}
          keyExtractor={(_, i) => String(i)}
          renderItem={() => <ChannelCardSkeleton />}
          scrollEnabled={false}
        />
      ) : filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>📡</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No channels found</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {search ? 'Try a different search' : 'No channels in this category'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChannelCard
              channel={item}
              isFavorite={favSet.has(item.id)}
              onPress={() => handlePlay(item)}
              onLongPress={() => handleLongPress(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={{
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
          }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={10}
          getItemLayout={(_, index) => ({
            length: 68,
            offset: 68 * index,
            index,
          })}
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
    gap: 10,
    paddingTop: 8,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EF4444',
  },
  liveLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
  searchInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 80,
  },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
