import React, { useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { getXtreamLiveStreams, getXtreamVodStreams, getXtreamSeries } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel, Movie, Series } from '@/types';

type TabId = 'all' | 'live' | 'movies' | 'series';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('all');
  const isXtream = credentials?.type === 'xtream';

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['search-channels', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') return getXtreamLiveStreams(buildCreds(credentials));
      if (credentials.m3uUrl) return (await fetchAndParseM3U(credentials.m3uUrl)).channels;
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const { data: movies = [] } = useQuery<Movie[]>({
    queryKey: ['search-movies', credentials],
    queryFn: () => getXtreamVodStreams(buildCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const { data: series = [] } = useQuery<Series[]>({
    queryKey: ['search-series', credentials],
    queryFn: () => getXtreamSeries(buildCreds(credentials)),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const q = query.toLowerCase().trim();
  const filteredChannels = useMemo(() => q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : [], [channels, q]);
  const filteredMovies = useMemo(() => q ? movies.filter((m) => m.name.toLowerCase().includes(q)) : [], [movies, q]);
  const filteredSeries = useMemo(() => q ? series.filter((s) => s.name.toLowerCase().includes(q)) : [], [series, q]);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'live', label: 'Live TV' },
    ...(isXtream ? [{ id: 'movies' as TabId, label: 'Movies' }, { id: 'series' as TabId, label: 'Series' }] : []),
  ];

  const showChannels = tab === 'all' || tab === 'live';
  const showMovies = (tab === 'all' || tab === 'movies') && isXtream;
  const showSeries = (tab === 'all' || tab === 'series') && isXtream;
  const noResults = q && filteredChannels.length === 0 && filteredMovies.length === 0 && filteredSeries.length === 0;

  function ResultRow({ title, subtitle, cover, badge, onPress }: { title: string; subtitle?: string; cover?: string; badge?: string; onPress: () => void }) {
    return (
      <TouchableOpacity style={[styles.resultRow, { borderBottomColor: colors.border }]} onPress={onPress} activeOpacity={0.6}>
        <View style={[styles.resultThumb, { backgroundColor: colors.secondary }]}>
          {cover ? <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>▶</Text>}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.resultTitle, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
          {subtitle && <Text style={[styles.resultSub, { color: colors.mutedForeground }]} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {badge && <View style={[styles.badge, { backgroundColor: colors.secondary, borderColor: colors.border }]}><Text style={[styles.badgeText, { color: colors.mutedForeground }]}>{badge}</Text></View>}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 6, paddingRight: insets.right + 12 }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Search</Text>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          placeholder="Search channels, movies, series..."
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {/* Filter tabs */}
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tabPill, { backgroundColor: tab === t.id ? colors.primary : colors.secondary, borderColor: tab === t.id ? colors.primary : colors.border }]}
              onPress={() => setTab(t.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, { color: tab === t.id ? '#fff' : colors.mutedForeground }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Results in two columns */}
      {!q ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, color: colors.mutedForeground }}>🔍</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Search your content</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>Type to search across all channels, movies, and series</Text>
        </View>
      ) : noResults ? (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No results for "{query}"</Text>
        </View>
      ) : (
        <ScrollView
          horizontal={false}
          contentContainerStyle={[styles.results, { paddingBottom: insets.bottom + 8, paddingRight: insets.right }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.cols}>
            {/* Left col */}
            <View style={styles.col}>
              {showChannels && filteredChannels.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>LIVE TV ({filteredChannels.length})</Text>
                  {filteredChannels.slice(0, 40).map((ch) => (
                    <ResultRow key={ch.id} title={ch.name} subtitle={ch.groupTitle} cover={ch.logo} badge="LIVE" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/player', params: { url: ch.streamUrl, title: ch.name, type: 'live', logo: ch.logo ?? '' } }); }} />
                  ))}
                </>
              )}
              {showSeries && filteredSeries.length > 0 && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TV SERIES ({filteredSeries.length})</Text>
                  {filteredSeries.slice(0, 40).map((s) => (
                    <ResultRow key={s.id} title={s.name} subtitle={s.genre?.split(',')[0]} cover={s.cover} badge="SERIES" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/series/[id]', params: { id: s.id, title: s.name, cover: s.cover ?? '', rating: s.rating ?? '', genre: s.genre ?? '', plot: s.plot ?? '', cast: s.cast ?? '', director: s.director ?? '' } }); }} />
                  ))}
                </>
              )}
            </View>
            {/* Right col */}
            {showMovies && filteredMovies.length > 0 && (
              <View style={styles.col}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>MOVIES ({filteredMovies.length})</Text>
                {filteredMovies.slice(0, 40).map((m) => (
                  <ResultRow key={m.id} title={m.name} subtitle={m.genre?.split(',')[0]} cover={m.cover} badge="VOD" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/movie/[id]', params: { id: m.id, title: m.name, cover: m.cover ?? '', genre: m.genre ?? '', rating: m.rating ?? '', plot: m.plot ?? '', cast: m.cast ?? '', director: m.director ?? '', releaseDate: m.releaseDate ?? '', duration: m.duration ?? '', ext: m.containerExtension } }); }} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, flexWrap: 'nowrap' },
  screenTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, flexShrink: 0 },
  searchInput: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, fontSize: 13, fontFamily: 'Inter_400Regular', minWidth: 150 },
  tabs: { flexDirection: 'row', gap: 6, flexShrink: 0 },
  tabPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, borderWidth: 1 },
  tabText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  results: { paddingHorizontal: 12, paddingTop: 8 },
  cols: { flexDirection: 'row', gap: 16 },
  col: { flex: 1 },
  sectionLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, paddingVertical: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  resultThumb: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  resultTitle: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  resultSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: 60 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center' },
});
