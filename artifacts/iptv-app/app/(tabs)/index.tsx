import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { StorageService } from '@/services/storage';
import {
  getXtreamLiveCategories,
  getXtreamLiveStreams,
  getXtreamXmltvUrl,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { Channel, Category, EpgProgram, FavoriteChannel } from '@/types';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

function fmtTime(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Category Row ─────────────────────────────────────────────────────────────

const CategoryRow = React.memo(function CategoryRow({
  cat,
  isSelected,
  colors,
  onPress,
}: {
  cat: Category;
  isSelected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.catRow,
        isSelected
          ? { backgroundColor: '#3B82F6' }
          : { borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[styles.catRowText, { color: isSelected ? '#fff' : colors.foreground }]}
        numberOfLines={2}
      >
        {cat.name}
      </Text>
    </TouchableOpacity>
  );
});

// ─── Channel Row ─────────────────────────────────────────────────────────────

const ChannelRow = React.memo(function ChannelRow({
  channel,
  isSelected,
  isFav,
  nowPlaying,
  colors,
  onPress,
  onLongPress,
}: {
  channel: Channel;
  isSelected: boolean;
  isFav: boolean;
  nowPlaying?: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.chRow,
        isSelected && { backgroundColor: 'rgba(59,130,246,0.15)' },
        { borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      {isSelected && <View style={styles.selectedPip} />}
      {channel.num != null && (
        <Text style={[styles.chNum, { color: isSelected ? '#3B82F6' : colors.mutedForeground }]}>
          {channel.num}
        </Text>
      )}
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
        <Text
          style={[styles.chName, { color: isSelected ? '#F2F2F2' : colors.foreground }]}
          numberOfLines={1}
        >
          {channel.name}
        </Text>
        {nowPlaying ? (
          <Text
            style={[styles.chSub, { color: isSelected ? '#93C5FD' : colors.mutedForeground }]}
            numberOfLines={1}
          >
            {nowPlaying}
          </Text>
        ) : null}
      </View>
      {isFav && <Text style={{ color: '#3B82F6', fontSize: 10, flexShrink: 0 }}>★</Text>}
    </TouchableOpacity>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const isWeb = Platform.OS === 'web';

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const [selectedCatId, setSelectedCatId] = useState<string>('__all');
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    StorageService.getFavorites().then(setFavorites);
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Video player ─────────────────────────────────────────────────────────
  // Always pass null as the initial source so the player instance is stable
  // and never reinitialises when selectedChannel changes (e.g. back to categories).
  // All stream loading is done via replaceAsync in the effect below.
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (isWeb || !selectedChannel?.streamUrl) return;
    setIsBuffering(true);
    setHasError(false);
    const load = async () => {
      try {
        // replaceAsync is on the prototype — avoids blocking the main thread (iOS warning fix)
        await (player as any).replaceAsync(selectedChannel.streamUrl);
        player.play();
      } catch {
        setHasError(true);
        setIsBuffering(false);
      }
    };
    load();
  }, [selectedChannel?.streamUrl]);

  useEffect(() => {
    if (isWeb || !player) return;
    const subs = [
      player.addListener('statusChange', ({ status, error }: any) => {
        if (status === 'readyToPlay') setIsBuffering(false);
        if (status === 'error' || error) { setHasError(true); setIsBuffering(false); }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  // Stop + reset only when the user picks a different tab from the sidebar.
  // Browsing back to categories within Live TV is just a state change — no focus
  // loss occurs — so the channel keeps playing while they browse.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (!isWeb && player) {
          try { player.pause(); } catch {}
        }
        setSelectedChannel(null);
      };
    }, [player])
  );

  // ── Data queries ──────────────────────────────────────────────────────────

  const { data: rawCategories = [] } = useQuery<Category[]>({
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

  const allCategories: Category[] = useMemo(
    () => [{ id: '__all', name: 'All Channels' }, ...rawCategories],
    [rawCategories],
  );

  const currentCat = useMemo(
    () => allCategories.find((c) => c.id === selectedCatId) ?? allCategories[0],
    [allCategories, selectedCatId],
  );

  const { data: channels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels', selectedCatId, credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') {
        const catId = selectedCatId === '__all' ? undefined : selectedCatId;
        return getXtreamLiveStreams(buildCreds(credentials), catId);
      }
      if (credentials.m3uUrl) {
        const { channels: all } = await fetchAndParseM3U(credentials.m3uUrl);
        return selectedCatId === '__all' ? all : all.filter((c) => c.groupTitle === selectedCatId);
      }
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
    enabled: !!xmltvUrl,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  // ── Derived data ──────────────────────────────────────────────────────────

  const favSet = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const nowPlayingMap = useMemo(() => {
    if (!epgMap) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const [id, progs] of epgMap.entries()) {
      const cur = progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime());
      if (cur) map.set(id, cur.title);
    }
    return map;
  }, [epgMap, nowTs]);

  // All programmes for the selected channel (current + upcoming)
  const channelEpg = useMemo(() => {
    if (!selectedChannel || !epgMap) return [];
    const progs = epgMap.get(selectedChannel.epgId ?? selectedChannel.id) ?? [];
    // Return current onwards (up to 12 entries)
    const nowIdx = progs.findIndex((p) => p.end.getTime() > nowTs);
    return nowIdx >= 0 ? progs.slice(nowIdx, nowIdx + 12) : progs.slice(0, 12);
  }, [selectedChannel, epgMap, nowTs]);

  const currentProg = useMemo(
    () => channelEpg.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null,
    [channelEpg, nowTs],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectCat = useCallback((catId: string) => {
    Haptics.selectionAsync();
    setSelectedCatId(catId);
    setSelectedChannel(null);
  }, []);

  const handleSelectChannel = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedChannel(ch);
  }, []);

  const handleLongPress = useCallback(async (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleFavorite({
      id: ch.id, name: ch.name, logo: ch.logo, groupTitle: ch.groupTitle, streamUrl: ch.streamUrl,
    });
    setFavorites(updated);
  }, []);

  const handleWatch = useCallback(() => {
    if (!selectedChannel) return;
    router.push({
      pathname: '/player',
      params: {
        url: selectedChannel.streamUrl,
        title: selectedChannel.name,
        type: 'live',
        logo: selectedChannel.logo ?? '',
        epgId: selectedChannel.epgId ?? selectedChannel.id,
      },
    });
  }, [selectedChannel, router]);

  const renderCat = useCallback(({ item }: { item: Category }) => (
    <CategoryRow
      cat={item}
      isSelected={item.id === selectedCatId}
      colors={colors}
      onPress={() => handleSelectCat(item.id)}
    />
  ), [selectedCatId, colors, handleSelectCat]);

  const renderChannel = useCallback(({ item }: { item: Channel }) => (
    <ChannelRow
      channel={item}
      isSelected={item.id === selectedChannel?.id}
      isFav={favSet.has(item.id)}
      nowPlaying={nowPlayingMap.get(item.epgId ?? item.id)}
      colors={colors}
      onPress={() => handleSelectChannel(item)}
      onLongPress={() => handleLongPress(item)}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleLongPress]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ══ LEFT: vertical category list ══ */}
      <View style={[styles.catPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          CATEGORIES
        </Text>
        <FlatList
          data={allCategories}
          keyExtractor={(c) => c.id}
          renderItem={renderCat}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: 52, offset: 52 * i, index: i })}
          contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
        />
      </View>

      {/* ══ MIDDLE: channel list ══ */}
      <View style={[styles.chPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          {currentCat?.name?.toUpperCase() ?? 'CHANNELS'}
        </Text>
        {channelsLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : (
          <FlatList
            data={channels}
            keyExtractor={(ch) => ch.id}
            renderItem={renderChannel}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          />
        )}
      </View>

      {/* ══ RIGHT: preview + EPG ══ */}
      <View style={[styles.previewPanel, { paddingTop: insets.top + 4, paddingRight: insets.right + 8 }]}>

        {/* VideoView is ALWAYS mounted so unmounting never pauses the player.
            It is simply hidden (display:none) when no channel is selected. */}
        {!isWeb && (
          <TouchableOpacity
            style={[styles.videoWrap, !selectedChannel && { display: 'none' }]}
            onPress={handleWatch}
            activeOpacity={0.85}
          >
            <VideoView
              player={player}
              style={StyleSheet.absoluteFill}
              nativeControls={false}
              contentFit="contain"
            />
            {(isBuffering && !hasError) && (
              <View style={styles.videoOverlay}>
                <ActivityIndicator color="#fff" size="large" />
              </View>
            )}
            {hasError && (
              <View style={styles.videoOverlay}>
                <Text style={styles.errText}>Stream unavailable</Text>
              </View>
            )}
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <View style={styles.tapHint}>
              <Text style={styles.tapHintText}>⛶</Text>
            </View>
          </TouchableOpacity>
        )}

        {selectedChannel ? (
          <>
            {/* EPG / TV Guide for this channel */}
            <Text style={[styles.epgHeader, { color: colors.mutedForeground }]}>TV GUIDE</Text>
            {channelEpg.length > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}>
                {channelEpg.map((prog, i) => {
                  const isCurrent = prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
                  return (
                    <View
                      key={i}
                      style={[
                        styles.epgRow,
                        { borderBottomColor: colors.border },
                        isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                      ]}
                    >
                      <View style={styles.epgTimeCol}>
                        <Text style={[styles.epgTime, { color: isCurrent ? '#3B82F6' : colors.mutedForeground }]}>
                          {fmtTime(prog.start)}
                        </Text>
                        {isCurrent && (
                          <View style={styles.nowBadge}>
                            <Text style={styles.nowBadgeText}>NOW</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.epgTitle, { color: isCurrent ? '#F2F2F2' : colors.foreground }]}
                          numberOfLines={1}
                        >
                          {prog.title}
                        </Text>
                        {prog.description ? (
                          <Text
                            style={[styles.epgDesc, { color: colors.mutedForeground }]}
                            numberOfLines={2}
                          >
                            {prog.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.epgEmpty}>
                {epgMap
                  ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No guide data available</Text>
                  : <><ActivityIndicator color={colors.primary} size="small" /><Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>Loading guide…</Text></>
                }
              </View>
            )}
          </>
        ) : (
          /* No channel selected */
          <View style={styles.noSel}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>📺</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>Select a channel</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Choose a category, then pick a channel to preview it here. Press OK to watch fullscreen.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },

  panelHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },

  // ── Category panel ──
  catPanel: {
    width: 140,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  catRow: {
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catRowText: { fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 16 },

  // ── Channel panel ──
  chPanel: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  chRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  selectedPip: {
    position: 'absolute',
    left: 0, top: '20%', bottom: '20%',
    width: 3, backgroundColor: '#3B82F6', borderRadius: 99,
  },
  chNum: { width: 24, fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'right', flexShrink: 0 },
  chLogo: { width: 38, height: 28, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  chSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  // ── Preview / right panel ──
  previewPanel: {
    flex: 1,
    paddingLeft: 12,
  },

  videoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 8,
  },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  livePill: {
    position: 'absolute',
    top: 8, left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: '#EF4444' },
  liveText: { color: '#EF4444', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },

  tapHint: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tapHintText: { color: '#fff', fontSize: 14 },

  epgHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  epgRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  epgTimeCol: { width: 68, alignItems: 'flex-start', gap: 3, flexShrink: 0 },
  epgTime: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  nowBadge: { backgroundColor: '#3B82F6', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  nowBadgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },
  epgTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  epgDesc: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 14 },
  epgEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },

  noSel: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  noSelTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  noSelSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
