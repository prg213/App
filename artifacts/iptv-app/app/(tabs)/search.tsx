import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import {
  getXtreamLiveStreams,
  getXtreamVodStreams,
  getXtreamSeries,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel, Movie, Series } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ListItem =
  | { kind: 'header'; label: string; count: number }
  | { kind: 'channel'; item: Channel }
  | { kind: 'movie';   item: Movie }
  | { kind: 'series';  item: Series }
  | { kind: 'no_results' }
  | { kind: 'placeholder' };

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

// ─── Result rows ─────────────────────────────────────────────────────────────

const ChannelResultRow = React.memo(function ChannelResultRow({
  channel,
  colors,
  onPress,
}: {
  channel: Channel;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.logo, { backgroundColor: colors.secondary }]}>
        {channel.logo ? (
          <Image source={{ uri: channel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Text style={[styles.initials, { color: colors.primary }]}>
            {channel.name.slice(0, 2).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {channel.name}
        </Text>
        {channel.groupTitle ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {channel.groupTitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.typePill}>
        <Text style={styles.typePillText}>LIVE</Text>
      </View>
    </TouchableOpacity>
  );
});

const MediaResultRow = React.memo(function MediaResultRow({
  cover,
  title,
  sub,
  kind,
  colors,
  onPress,
}: {
  cover?: string;
  title: string;
  sub?: string;
  kind: 'movie' | 'series';
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.cover, { backgroundColor: colors.secondary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 20 }}>{kind === 'movie' ? '🎬' : '📺'}</Text>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <View style={[styles.typePill, kind === 'series' && styles.typePillSeries]}>
        <Text style={[styles.typePillText, kind === 'series' && { color: '#8B5CF6' }]}>
          {kind === 'movie' ? 'MOVIE' : 'SERIES'}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label, count, colors }: { label: string; count: number; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.sectionHeader, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.countBadge, { backgroundColor: colors.secondary }]}>
        <Text style={[styles.countText, { color: colors.foreground }]}>{count}</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { blockedChannelIds, maxRating } = useParentalContext();

  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const hasQuery = query.trim().length > 0;

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: allChannels = [], isLoading: chLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels-search', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream' && creds) {
        return getXtreamLiveStreams(creds); // no categoryId = all channels
      }
      if (credentials.type === 'm3u' && credentials.m3uUrl) {
        return (await fetchAndParseM3U(credentials.m3uUrl)).channels;
      }
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const { data: allMovies = [], isLoading: movLoading } = useQuery<Movie[]>({
    queryKey: ['vod-streams', undefined, credentials],
    queryFn: () => getXtreamVodStreams(creds!),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const { data: allSeries = [], isLoading: serLoading } = useQuery<Series[]>({
    queryKey: ['series-list', undefined, credentials],
    queryFn: () => getXtreamSeries(creds!),
    enabled: !!credentials && isXtream,
    staleTime: 5 * 60_000,
  });

  const isLoading = chLoading || movLoading || serLoading;

  // ── Filtered results ──────────────────────────────────────────────────────

  const blockedSet = useMemo(() => new Set(blockedChannelIds), [blockedChannelIds]);

  const { channels, movies, series } = useMemo(() => {
    if (!hasQuery) return { channels: [], movies: [], series: [] };

    const q = query.trim().toLowerCase();

    const channels = allChannels
      .filter((ch) => !blockedSet.has(ch.id) && ch.name.toLowerCase().includes(q))
      .slice(0, 50);

    const movies = allMovies
      .filter((m) => !isContentBlocked(m.rating, maxRating) && m.name.toLowerCase().includes(q))
      .slice(0, 50);

    const series = allSeries
      .filter((s) => !isContentBlocked(s.rating, maxRating) && s.name.toLowerCase().includes(q))
      .slice(0, 50);

    return { channels, movies, series };
  }, [hasQuery, query, allChannels, allMovies, allSeries, blockedSet, maxRating]);

  // ── Build flat list data ──────────────────────────────────────────────────

  const listData = useMemo<ListItem[]>(() => {
    if (!hasQuery) return [{ kind: 'placeholder' }];

    const data: ListItem[] = [];

    if (channels.length > 0) {
      data.push({ kind: 'header', label: 'LIVE TV', count: channels.length });
      channels.forEach((item) => data.push({ kind: 'channel', item }));
    }
    if (movies.length > 0) {
      data.push({ kind: 'header', label: 'MOVIES', count: movies.length });
      movies.forEach((item) => data.push({ kind: 'movie', item }));
    }
    if (series.length > 0) {
      data.push({ kind: 'header', label: 'SERIES', count: series.length });
      series.forEach((item) => data.push({ kind: 'series', item }));
    }
    if (data.length === 0) {
      data.push({ kind: 'no_results' });
    }

    return data;
  }, [hasQuery, channels, movies, series]);

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleChannelPress = (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        channelsJson: JSON.stringify([]),
        channelIndex: '0',
      },
    });
  };

  const handleMoviePress = (m: Movie) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/movie/[id]',
      params: {
        id: m.id,
        title: m.name,
        cover: m.cover ?? '',
        genre: m.genre ?? '',
        rating: m.rating ?? '',
        plot: m.plot ?? '',
        cast: m.cast ?? '',
        director: m.director ?? '',
        releaseDate: m.releaseDate ?? '',
        duration: m.duration ?? '',
        ext: m.containerExtension,
      },
    });
  };

  const handleSeriesPress = (s: Series) => {
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
  };

  // ── Render each list item ─────────────────────────────────────────────────

  const renderItem = ({ item }: { item: ListItem }) => {
    switch (item.kind) {
      case 'header':
        return <SectionHeader label={item.label} count={item.count} colors={colors} />;

      case 'channel':
        return (
          <ChannelResultRow
            channel={item.item}
            colors={colors}
            onPress={() => handleChannelPress(item.item)}
          />
        );

      case 'movie':
        return (
          <MediaResultRow
            kind="movie"
            cover={item.item.cover}
            title={item.item.name}
            sub={[item.item.genre, item.item.releaseDate?.slice(0, 4)].filter(Boolean).join(' · ')}
            colors={colors}
            onPress={() => handleMoviePress(item.item)}
          />
        );

      case 'series':
        return (
          <MediaResultRow
            kind="series"
            cover={item.item.cover}
            title={item.item.name}
            sub={item.item.genre}
            colors={colors}
            onPress={() => handleSeriesPress(item.item)}
          />
        );

      case 'no_results':
        return (
          <View style={styles.center}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No results found</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Try a different name or check your spelling.
            </Text>
          </View>
        );

      case 'placeholder':
        return (
          <View style={styles.center}>
            {isLoading ? (
              <>
                <ActivityIndicator color={colors.primary} size="large" />
                <Text style={[styles.emptySub, { color: colors.mutedForeground, marginTop: 12 }]}>
                  Loading content…
                </Text>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 48, marginBottom: 16 }}>🔍</Text>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  Search everything
                </Text>
                <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                  Find live channels, movies and series in one place.
                </Text>
                {isXtream && allChannels.length + allMovies.length + allSeries.length > 0 && (
                  <View style={[styles.statRow, { marginTop: 24 }]}>
                    <StatChip icon="📡" label={`${allChannels.length} channels`} colors={colors} />
                    <StatChip icon="🎬" label={`${allMovies.length} movies`} colors={colors} />
                    <StatChip icon="📺" label={`${allSeries.length} series`} colors={colors} />
                  </View>
                )}
              </>
            )}
          </View>
        );

      default:
        return null;
    }
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Search bar */}
      <View
        style={[
          styles.searchBar,
          {
            paddingTop: insets.top + 12,
            borderBottomColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Search</Text>
        <View style={[styles.inputWrap, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.searchIcon, { color: colors.mutedForeground }]}>🔍</Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.foreground }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Channels, movies, series…"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearBtn, { color: colors.mutedForeground }]}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
        {/* Live result count */}
        {hasQuery && !isLoading && (
          <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>
            {channels.length + movies.length + series.length} result
            {channels.length + movies.length + series.length !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      {/* Results */}
      <FlatList
        data={listData}
        keyExtractor={(item, i) => {
          if (item.kind === 'header') return `hdr-${item.label}`;
          if (item.kind === 'channel') return `ch-${item.item.id}`;
          if (item.kind === 'movie') return `mov-${item.item.id}`;
          if (item.kind === 'series') return `ser-${item.item.id}`;
          return `special-${i}`;
        }}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          hasQuery ? undefined : { flex: 1 },
          { paddingBottom: insets.bottom + 16 },
        ]}
        removeClippedSubviews={false}
      />
    </View>
  );
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({ icon, label, colors }: { icon: string; label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.statChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <Text style={{ fontSize: 13 }}>{icon}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  searchBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  screenTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  searchIcon: { fontSize: 14 },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 0,
  },
  clearBtn: {
    fontSize: 13,
    paddingHorizontal: 2,
  },
  resultCount: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },

  // ── Section header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    flex: 1,
  },
  countBadge: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Result row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 60,
  },
  logo: {
    width: 44,
    height: 32,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  cover: {
    width: 40,
    height: 56,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  initials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  rowTitle: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  rowSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  typePill: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    flexShrink: 0,
  },
  typePillSeries: {
    backgroundColor: 'rgba(139,92,246,0.12)',
  },
  typePillText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#EF4444', // overridden per kind via inline style
    letterSpacing: 0.5,
  },

  // ── Empty / placeholder ──
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },

  // ── Stat chips ──
  statRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  statLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
});
