import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import { StorageService } from '@/services/storage';
import { getXtreamLiveCategories, getXtreamLiveStreams, getXtreamXmltvUrl } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { Channel, Category, EpgProgram, FavoriteChannel } from '@/types';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

// Compact channel row for landscape
function ChannelRow({
  channel,
  isFav,
  nowPlaying,
  onPress,
  onLongPress,
  colors,
}: {
  channel: Channel;
  isFav: boolean;
  nowPlaying?: string;
  onPress: () => void;
  onLongPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[styles.chRow, { borderBottomColor: colors.border }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.6}
    >
      <View style={[styles.chLogo, { backgroundColor: colors.secondary }]}>
        {channel.logo ? (
          <Image source={{ uri: channel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Text style={[styles.chInitials, { color: colors.primary }]}>
            {channel.name.slice(0, 2).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={[styles.chGroup, { color: nowPlaying ? colors.primary : colors.mutedForeground }]} numberOfLines={1}>
          {nowPlaying ?? channel.groupTitle}
        </Text>
      </View>
      <View style={styles.chRight}>
        <View style={[styles.livePill, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveLabel}>LIVE</Text>
        </View>
        {isFav && <Text style={{ color: colors.primary, fontSize: 10 }}>★</Text>}
      </View>
    </TouchableOpacity>
  );
}

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { credentials } = useAppContext();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  React.useEffect(() => { StorageService.getFavorites().then(setFavorites); }, []);

  // Reuse cached EPG from the guide screen (same query key, staleTime 30 min)
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
    enabled: !!xmltvUrl,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  // Map channelId → current programme title for O(1) lookup per row
  const nowPlayingMap = useMemo(() => {
    if (!epgMap) return new Map<string, string>();
    const nowTs = Date.now();
    const map = new Map<string, string>();
    for (const [channelId, programs] of epgMap.entries()) {
      const current = programs.find(
        (p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime(),
      );
      if (current) map.set(channelId, current.title);
    }
    return map;
  }, [epgMap]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['live-categories', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') return getXtreamLiveCategories(buildCreds(credentials));
      if (credentials.m3uUrl) return (await fetchAndParseM3U(credentials.m3uUrl)).categories;
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const { data: channels = [], isLoading, refetch, isRefetching } = useQuery<Channel[]>({
    queryKey: ['live-channels', selectedCat, credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') return getXtreamLiveStreams(buildCreds(credentials), selectedCat ?? undefined);
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

  const handleRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['live-categories'] });
    queryClient.invalidateQueries({ queryKey: ['live-channels'] });
  }, [queryClient]);

  const handlePlay = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/player', params: { url: ch.streamUrl, title: ch.name, type: 'live', logo: ch.logo ?? '' } });
  }, [router]);

  const handleLongPress = useCallback(async (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleFavorite({ id: ch.id, name: ch.name, logo: ch.logo, groupTitle: ch.groupTitle, streamUrl: ch.streamUrl });
    setFavorites(updated);
  }, []);

  const allCategories: Category[] = [{ id: '__fav', name: '★ Favourites' }, ...categories];

  const displayChannels = selectedCat === '__fav'
    ? channels.filter((c) => favSet.has(c.id))
    : filtered;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Left category panel */}
      <View style={[styles.catPanel, { backgroundColor: '#0E0E1A', borderRightColor: colors.border, paddingTop: insets.top + 8 }]}>
        <Text style={[styles.catTitle, { color: colors.mutedForeground }]}>CATEGORIES</Text>
        <FlatList
          data={[{ id: null, name: 'All' } as any, ...allCategories]}
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

      {/* Right content panel */}
      <View style={[styles.content, { paddingRight: insets.right }]}>
        {/* Search bar */}
        <View style={[styles.searchBar, { borderBottomColor: colors.border, paddingTop: insets.top + 6 }]}>
          <TextInput
            style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
            placeholder="Search channels..."
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

        {/* Channel list */}
        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading channels…</Text>
          </View>
        ) : displayChannels.length === 0 ? (
          <View style={styles.empty}>
            <Text style={[{ fontSize: 36, color: colors.mutedForeground }]}>📡</Text>
            <Text style={[styles.emptyText, { color: colors.foreground }]}>No channels found</Text>
          </View>
        ) : (
          <FlatList
            data={displayChannels}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ChannelRow
                channel={item}
                isFav={favSet.has(item.id)}
                nowPlaying={nowPlayingMap.get(item.epgId ?? item.id)}
                onPress={() => handlePlay(item)}
                onLongPress={() => handleLongPress(item)}
                colors={colors}
              />
            )}
            refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
            showsVerticalScrollIndicator={false}
            initialNumToRender={25}
            maxToRenderPerBatch={25}
            getItemLayout={(_, i) => ({ length: 58, offset: 58 * i, index: i })}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
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
  catItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 0, position: 'relative' },
  catPip: { position: 'absolute', left: 0, top: '20%', bottom: '20%', width: 3, backgroundColor: '#3B82F6', borderRadius: 99 },
  catLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  content: { flex: 1 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  searchInput: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, fontSize: 13, fontFamily: 'Inter_400Regular' },
  refreshBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  refreshIcon: { fontSize: 17, fontWeight: '600' },
  chRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  chLogo: { width: 44, height: 32, borderRadius: 5, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  chInitials: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chGroup: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  chRight: { alignItems: 'flex-end', gap: 3 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99 },
  liveDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#EF4444' },
  liveLabel: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 0.5 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
});
