import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { TrailerModal } from '@/components/TrailerModal';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Alert, BackHandler, DeviceEventEmitter } from 'react-native';
import { getTmdbTrailerCandidates } from '@/services/tmdb';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { StorageService } from '@/services/storage';
import {
  getXtreamLiveStreams,
  getXtreamVodStreams,
  getXtreamSeries,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel, Movie, Series, WatchHistoryEntry } from '@/types';
import { normaliseStr } from '@/utils/normalise';

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

// ─── Highlighted text ─────────────────────────────────────────────────────────

function HighlightedText({
  text, query, style, highlightStyle,
}: { text: string; query: string; style: any; highlightStyle: any }) {
  if (!query) return <Text style={style} numberOfLines={1}>{text}</Text>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: { t: string; m: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) { parts.push({ t: text.slice(i), m: false }); break; }
    if (idx > i) parts.push({ t: text.slice(i, idx), m: false });
    parts.push({ t: text.slice(idx, idx + q.length), m: true });
    i = idx + q.length;
  }
  return (
    <Text style={style} numberOfLines={1}>
      {parts.map((p, j) => p.m ? <Text key={j} style={highlightStyle}>{p.t}</Text> : p.t)}
    </Text>
  );
}

// ─── Result rows ─────────────────────────────────────────────────────────────

const ChannelResultRow = React.memo(function ChannelResultRow({
  channel,
  query,
  colors,
  onPress,
}: {
  channel: Channel;
  query: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <FocusablePressable
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
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
        <HighlightedText
          text={channel.name}
          query={query}
          style={[styles.rowTitle, { color: colors.foreground }]}
          highlightStyle={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}
        />
        {channel.groupTitle ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {channel.groupTitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.typePill}>
        <Text style={styles.typePillText}>LIVE</Text>
      </View>
    </FocusablePressable>
  );
});

const MediaResultRow = React.memo(function MediaResultRow({
  cover,
  title,
  sub,
  kind,
  query,
  colors,
  onPress,
  onTrailer,
  progress,
}: {
  cover?: string;
  title: string;
  sub?: string;
  kind: 'movie' | 'series';
  query: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  // #106/#123: optional trailer shortcut shown on movie and series rows
  onTrailer?: () => void;
  /** 0–1 resume progress shown as a bar at the bottom of the cover thumbnail */
  progress?: number;
}) {
  const isOnline = useIsOnline(); // #129
  return (
    <FocusablePressable
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
    >
      <View style={[styles.cover, { backgroundColor: colors.secondary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 20 }}>{kind === 'movie' ? '🎬' : '📺'}</Text>
        )}
        {/* #214: resume progress bar */}
        {progress != null && progress > 0 && (
          <View style={styles.coverProgressRail}>
            <View style={[styles.coverProgressFill, { width: `${Math.max(2, Math.min(100, progress * 100))}%` as any }]} />
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <HighlightedText
          text={title}
          query={query}
          style={[styles.rowTitle, { color: colors.foreground }]}
          highlightStyle={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}
        />
        {sub ? (
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {/* #106/#123/#129: trailer shortcut — greyed out when offline.
          focusable={false} on TV: nested focusable inside the row causes a
          D-pad trap; long-press on the row already exposes the Trailer option
          via the Alert action menu as the TV-safe equivalent. */}
      {onTrailer && (
        <FocusablePressable
          style={[styles.trailerPill, !isOnline && styles.trailerPillOffline]}
          focusable={false}
          onPress={(e) => { (e as any).stopPropagation?.(); onTrailer(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.trailerPillText, !isOnline && styles.trailerPillTextOffline]}>
            {isOnline ? '▶ Trailer' : '✕ Offline'}
          </Text>
        </FocusablePressable>
      )}
      <View style={[styles.typePill, kind === 'series' && styles.typePillSeries]}>
        <Text style={[styles.typePillText, kind === 'series' && { color: '#8B5CF6' }]}>
          {kind === 'movie' ? 'MOVIE' : 'SERIES'}
        </Text>
      </View>
    </FocusablePressable>
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

type SearchType = 'all' | 'live' | 'movies' | 'series';

const SEARCH_TYPES: { id: SearchType; label: string; icon: string }[] = [
  { id: 'all',     label: 'All',     icon: '🔍' },
  { id: 'live',    label: 'Live TV', icon: '📡' },
  { id: 'movies',  label: 'Movies',  icon: '🎬' },
  { id: 'series',  label: 'Series',  icon: '📺' },
];

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { blockedChannels: blockedChannelIds, blockedCategoryIds, maxRating } = useParentalContext();

  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('all');

  // D-pad / remote back: clear the search query before handing off to the
  // global handler which focuses the sidebar.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (query) { setQuery(''); return true; }
      return false;
    });
    return () => sub.remove();
  }, [query]));
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerVideoIds, setTrailerVideoIds] = useState<string[] | 'loading' | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([]);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ListItem>>(null);

  // Restore the last-used search filter and query from storage on mount
  useEffect(() => {
    StorageService.getPrefSearchType().then((saved) => setSearchType(saved));
    StorageService.getPrefSearchQuery().then((saved) => { if (saved) setQuery(saved); });
    StorageService.getRecentSearches().then(setRecentSearches);
  }, []);

  // #218: Refresh watch history every time the Search tab comes into focus so
  // progress bars reflect the latest watch position after returning from the player.
  useFocusEffect(
    useCallback(() => {
      StorageService.getWatchHistory().then(setWatchHistory);
    }, [])
  );

  // Refresh recent searches instantly when the user clears them from Settings
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('search-history:cleared', () => {
      setRecentSearches([]);
    });
    return () => sub.remove();
  }, []);

  const handleSubmitSearch = () => {
    const q = query.trim();
    if (!q) return;
    StorageService.addRecentSearch(q).then(() =>
      StorageService.getRecentSearches().then(setRecentSearches)
    );
  };

  const handleRemoveRecentSearch = (q: string) => {
    StorageService.removeRecentSearch(q).then(() =>
      setRecentSearches((prev) => prev.filter((s) => s !== q))
    );
  };

  const handleClearAllRecentSearches = () => {
    StorageService.clearRecentSearches().then(() => setRecentSearches([]));
  };

  // #122: Clear the in-memory query when the user logs out or switches accounts.
  // credentials becomes null on logout; reset the query so the old search isn't
  // visible if a different account logs in within the same session.
  const prevCredentialsRef = useRef(credentials);
  useEffect(() => {
    const prev = prevCredentialsRef.current;
    prevCredentialsRef.current = credentials;
    // Detect logout (had credentials, now null) or account switch (host/username changed)
    if (prev && !credentials) {
      setQuery('');
    } else if (
      prev && credentials &&
      (prev.host !== credentials.host || prev.username !== credentials.username)
    ) {
      setQuery('');
    }
  }, [credentials]);

  // #108: Persist query with a 1 s debounce so fast typing doesn't thrash storage
  useEffect(() => {
    const t = setTimeout(() => StorageService.setPrefSearchQuery(query), 1000);
    return () => clearTimeout(t);
  }, [query]);

  const handleSearchTypeChange = (type: SearchType) => {
    setSearchType(type);
    StorageService.setPrefSearchType(type);
    // Scroll results back to the top so the user starts from the beginning
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  // Debounce query by 200 ms so filtering doesn't recalculate on every keystroke
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const hasQuery = debouncedQuery.trim().length > 0;

  const showLive    = searchType === 'all' || searchType === 'live';
  const showMovies  = searchType === 'all' || searchType === 'movies';
  const showSeries  = searchType === 'all' || searchType === 'series';

  // ── Data queries ─────────────────────────────────────────────────────────

  const { data: allChannels = [], isLoading: chLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels-search', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream' && creds) {
        return getXtreamLiveStreams(creds);
      }
      if (credentials.type === 'm3u' && credentials.m3uUrl) {
        return (await fetchAndParseM3U(credentials.m3uUrl)).channels;
      }
      return [];
    },
    enabled: !!credentials && showLive,
    staleTime: 5 * 60_000,
  });

  const { data: allMovies = [], isLoading: movLoading } = useQuery<Movie[]>({
    queryKey: ['vod-streams', undefined, credentials],
    queryFn: () => getXtreamVodStreams(creds!),
    enabled: !!credentials && isXtream && showMovies,
    staleTime: 5 * 60_000,
  });

  const { data: allSeries = [], isLoading: serLoading } = useQuery<Series[]>({
    queryKey: ['series-list', undefined, credentials],
    queryFn: () => getXtreamSeries(creds!),
    enabled: !!credentials && isXtream && showSeries,
    staleTime: 5 * 60_000,
  });

  const isLoading = (showLive && chLoading) || (showMovies && movLoading) || (showSeries && serLoading);

  // #214: Build a map of id → progress (0–1) from watch history for both movies and series.
  // Series episodes are stored with the episode stream ID in `e.id` and the parent series ID
  // in `e.parentId`, so we index by `e.parentId ?? e.id` to match series cards by series ID.
  // History is ordered newest-first, so we only write each key once to keep the freshest value.
  const progressMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of watchHistory) {
      const key = e.parentId ?? e.id;
      if (!map.has(key) && e.position && e.duration && e.duration > 0) {
        map.set(key, e.position / e.duration);
      }
    }
    return map;
  }, [watchHistory]);

  // ── Filtered results ──────────────────────────────────────────────────────

  const blockedSet = useMemo(() => new Set(blockedChannelIds), [blockedChannelIds]);
  const blockedCatSet = useMemo(() => new Set(blockedCategoryIds), [blockedCategoryIds]);

  const { channels, movies, series } = useMemo(() => {
    if (!hasQuery) return { channels: [], movies: [], series: [] };

    const q = normaliseStr(debouncedQuery.trim());

    const channels = showLive
      ? allChannels
          .filter((ch) => !blockedSet.has(ch.id) && !blockedCatSet.has(ch.groupTitle) && normaliseStr(ch.name).includes(q))
          .slice(0, 50)
      : [];

    const movies = showMovies
      ? allMovies
          .filter((m) => !isContentBlocked(m.rating, maxRating) && normaliseStr(m.name).includes(q))
          .slice(0, 50)
      : [];

    const series = showSeries
      ? allSeries
          .filter((s) => !isContentBlocked(s.rating, maxRating) && normaliseStr(s.name).includes(q))
          .slice(0, 50)
      : [];

    return { channels, movies, series };
  }, [hasQuery, debouncedQuery, showLive, showMovies, showSeries, allChannels, allMovies, allSeries, blockedSet, blockedCatSet, maxRating]);

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
    // #138: pass the full channel list and correct index so the player can
    // re-resolve a stale stream URL instead of showing the error screen.
    const chList = allChannels.map((c) => ({
      url: c.streamUrl,
      title: c.name,
      epgId: c.epgId ?? c.id,
      logo: c.logo ?? '',
      channelId: c.id,
    }));
    const idx = allChannels.findIndex((c) => c.id === ch.id);
    router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        channelId: ch.id,
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
        // Launched from Search — no mini-player on this tab, so pause and
        // go back cleanly rather than leaving audio running in the background.
        stopOnBack: 'true',
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
            query={query}
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
            query={query}
            colors={colors}
            onPress={() => handleMoviePress(item.item)}
            progress={progressMap.get(item.item.id)}
            onTrailer={async () => {
              setTrailerLoading(true);
              try {
                const raw = item.item.trailerUrl;
                const ytId = raw
                  ? raw.startsWith('http')
                    ? (raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ?? null)
                    : (raw.length === 11 ? raw : null)
                  : null;
                const resolved = ytId ?? (await getTmdbTrailerCandidates(item.item.name, 'movie'))[0] ?? null;
                if (resolved) { setTrailerVideoIds([resolved]); }
              } finally { setTrailerLoading(false); }
            }}
          />
        );

      case 'series':
        return (
          <MediaResultRow
            kind="series"
            cover={item.item.cover}
            title={item.item.name}
            sub={item.item.genre}
            query={query}
            colors={colors}
            onPress={() => handleSeriesPress(item.item)}
            progress={progressMap.get(item.item.id)}
            onTrailer={async () => {
              setTrailerLoading(true);
              try {
                const raw = item.item.trailerUrl;
                const ytId = raw
                  ? raw.startsWith('http')
                    ? (raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ?? null)
                    : (raw.length === 11 ? raw : null)
                  : null;
                const resolved = ytId ?? (await getTmdbTrailerCandidates(item.item.name, 'tv'))[0] ?? null;
                if (resolved) { setTrailerVideoIds([resolved]); }
              } finally { setTrailerLoading(false); }
            }}
          />
        );

      case 'no_results':
        return (
          <View style={styles.center}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No results for "{query.trim()}"
            </Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Try a different name or check your spelling.
            </Text>
          </View>
        );

      case 'placeholder':
        return (
          <View style={styles.placeholderWrap}>
            {recentSearches.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text style={[styles.recentHeading, { color: colors.mutedForeground }]}>RECENT SEARCHES</Text>
                  <FocusablePressable onPress={handleClearAllRecentSearches} hitSlop={8}>
                    <Text style={[styles.recentClearAll, { color: colors.mutedForeground }]}>Clear all</Text>
                  </FocusablePressable>
                </View>
                {recentSearches.map((s) => (
                  // Outer View holds the row style; the search area and ✕ button
                  // are separate sibling FocusablePressables so D-pad can reach
                  // the ✕ independently without being blocked by the outer wrapper.
                  <View
                    key={s}
                    style={[styles.recentRow, { borderBottomColor: colors.border }]}
                  >
                    <FocusablePressable
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                      onPress={() => {
                        setQuery(s);
                        // Also save it (bumps to top) then let the results render
                        StorageService.addRecentSearch(s).then(() =>
                          StorageService.getRecentSearches().then(setRecentSearches)
                        );
                      }}
                    >
                      <Text style={[styles.recentIcon, { color: colors.mutedForeground }]}>🕐</Text>
                      <Text style={[styles.recentText, { color: colors.foreground }]} numberOfLines={1}>{s}</Text>
                    </FocusablePressable>
                    <FocusablePressable onPress={() => handleRemoveRecentSearch(s)} hitSlop={8}>
                      <Text style={[styles.recentRemove, { color: colors.mutedForeground }]}>✕</Text>
                    </FocusablePressable>
                  </View>
                ))}
              </View>
            )}
            <View style={styles.center}>
              {isLoading ? (
                <>
                  <ActivityIndicator color={colors.primary} size="large" />
                  <Text style={[styles.emptySub, { color: colors.mutedForeground, marginTop: 12 }]}>
                    Loading content…
                  </Text>
                </>
              ) : !credentials ? (
                <>
                  <Text style={{ fontSize: 48, marginBottom: 16 }}>📡</Text>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No account linked
                  </Text>
                  <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                    Add your IPTV credentials in Settings to start searching live channels, movies and series.
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
            placeholder={
              searchType === 'live' ? 'Search live channels…'
              : searchType === 'movies' ? 'Search movies…'
              : searchType === 'series' ? 'Search series…'
              : 'Channels, movies, series…'
            }
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            onSubmitEditing={handleSubmitSearch}
          />
          {query.length > 0 && (
            <FocusablePressable onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={[styles.clearBtn, { color: colors.mutedForeground }]}>✕</Text>
            </FocusablePressable>
          )}
        </View>
        {/* Type filter pills */}
        <View style={styles.pillRow}>
          {SEARCH_TYPES.map((t, index) => {
            const active = searchType === t.id;
            return (
              <FocusablePressable
                key={t.id}
                hasTVPreferredFocus={Platform.isTV && index === 0}
                style={[
                  styles.pill,
                  { borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? 'rgba(59,130,246,0.15)' : colors.secondary },
                ]}
                onPress={() => handleSearchTypeChange(t.id)}
              >
                <Text style={styles.pillIcon}>{t.icon}</Text>
                <Text style={[styles.pillLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
                  {t.label}
                </Text>
              </FocusablePressable>
            );
          })}
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
        ref={listRef}
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
      <TrailerModal videoIds={trailerVideoIds} onClose={() => setTrailerVideoIds(null)} />
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
    paddingVertical: 9,
    gap: 6,
  },
  searchIcon: { fontSize: 14 },
  input: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    padding: 0,
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
  trailerPill: {
    backgroundColor: 'rgba(139,92,246,0.15)',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginRight: 4,
    flexShrink: 0,
  },
  trailerPillText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: '#8B5CF6',
    letterSpacing: 0.3,
  },
  trailerPillOffline: {
    backgroundColor: 'rgba(75,85,99,0.18)',
  },
  trailerPillTextOffline: {
    color: '#6B7280',
  },

  // ── Cover progress bar (#214) ──
  coverProgressRail: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  coverProgressFill: {
    height: '100%' as any,
    backgroundColor: '#3B82F6',
    borderRadius: 1.5,
  },

  // ── Recent searches ──
  placeholderWrap: { flex: 1 },
  recentSection: { paddingTop: 12 },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  recentHeading: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5 },
  recentClearAll: { fontSize: 11, fontFamily: 'Inter_400Regular', opacity: 0.7 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  recentIcon: { fontSize: 14 },
  recentText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  recentRemove: { fontSize: 12, fontFamily: 'Inter_400Regular', opacity: 0.5 },

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

  // ── Type filter pills ──
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillIcon: { fontSize: 12 },
  pillLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },

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
