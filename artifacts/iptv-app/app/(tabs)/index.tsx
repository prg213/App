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
import { useRouter } from 'expo-router';
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

// ─── Channel Row ────────────────────────────────────────────────────────────

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

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const isWeb = Platform.OS === 'web';

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [catIndex, setCatIndex] = useState(0);
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    StorageService.getFavorites().then(setFavorites);
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Video player ────────────────────────────────────────────────────────

  const player = useVideoPlayer(isWeb ? null : (selectedChannel?.streamUrl ?? null), (p) => {
    p.loop = false;
    if (selectedChannel && !isWeb) p.play();
  });

  // Replace source when channel changes
  useEffect(() => {
    if (isWeb || !selectedChannel?.streamUrl) return;
    setIsBuffering(true);
    setHasError(false);
    try {
      player.replace(selectedChannel.streamUrl);
      player.play();
    } catch {
      setHasError(true);
    }
  }, [selectedChannel?.streamUrl]);

  // Player events
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

  // ── Data queries ────────────────────────────────────────────────────────

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
  const currentCat = allCategories[catIndex] ?? allCategories[0];

  const { data: channels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels', currentCat?.id, credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') {
        const catId = currentCat?.id === '__all' ? undefined : currentCat?.id;
        return getXtreamLiveStreams(buildCreds(credentials), catId);
      }
      if (credentials.m3uUrl) {
        const { channels: all } = await fetchAndParseM3U(credentials.m3uUrl);
        return currentCat?.id === '__all' ? all : all.filter((c) => c.groupTitle === currentCat?.id);
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

  // ── Derived data ────────────────────────────────────────────────────────

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

  // Current + upcoming programmes for the selected channel
  const { current: currentProg, upcoming } = useMemo(() => {
    if (!selectedChannel || !epgMap) return { current: null, upcoming: [] };
    const progs = epgMap.get(selectedChannel.epgId ?? selectedChannel.id) ?? [];
    const cur = progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
    const idx = cur ? progs.indexOf(cur) : -1;
    const upcomingProgs = idx >= 0 ? progs.slice(idx + 1, idx + 8) : progs.filter((p) => p.start.getTime() > nowTs).slice(0, 7);
    return { current: cur, upcoming: upcomingProgs };
  }, [selectedChannel, epgMap, nowTs]);

  // ── Handlers ────────────────────────────────────────────────────────────

  const handleSelect = useCallback((ch: Channel) => {
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

  const handleFullscreen = useCallback(() => {
    if (!selectedChannel) return;
    router.push({
      pathname: '/player',
      params: { url: selectedChannel.streamUrl, title: selectedChannel.name, type: 'live', logo: selectedChannel.logo ?? '' },
    });
  }, [selectedChannel, router]);

  const renderChannel = useCallback(({ item }: { item: Channel }) => (
    <ChannelRow
      channel={item}
      isSelected={item.id === selectedChannel?.id}
      isFav={favSet.has(item.id)}
      nowPlaying={nowPlayingMap.get(item.epgId ?? item.id)}
      colors={colors}
      onPress={() => handleSelect(item)}
      onLongPress={() => handleLongPress(item)}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelect, handleLongPress]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ══ LEFT PANEL: category nav + channel list ══ */}
      <View style={[styles.leftPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>

        {/* Category navigation */}
        <View style={[styles.catNav, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            style={styles.catArrowBtn}
            onPress={() => { setCatIndex((i) => Math.max(0, i - 1)); setSelectedChannel(null); }}
            activeOpacity={0.6}
            disabled={catIndex === 0}
          >
            <Text style={[styles.catArrow, { color: catIndex === 0 ? colors.border : colors.foreground }]}>‹</Text>
          </TouchableOpacity>

          <Text style={[styles.catLabel, { color: colors.foreground }]} numberOfLines={1}>
            {currentCat?.name ?? 'All Channels'}
          </Text>

          <TouchableOpacity
            style={styles.catArrowBtn}
            onPress={() => { setCatIndex((i) => Math.min(allCategories.length - 1, i + 1)); setSelectedChannel(null); }}
            activeOpacity={0.6}
            disabled={catIndex >= allCategories.length - 1}
          >
            <Text style={[styles.catArrow, { color: catIndex >= allCategories.length - 1 ? colors.border : colors.foreground }]}>›</Text>
          </TouchableOpacity>
        </View>

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

      {/* ══ CENTER PANEL: video preview + programme description ══ */}
      <View style={[styles.centerPanel, { backgroundColor: '#000' }]}>
        {selectedChannel ? (
          <>
            {/* Video */}
            <View style={styles.videoWrap}>
              {!isWeb && (
                <VideoView
                  player={player}
                  style={StyleSheet.absoluteFill}
                  nativeControls={false}
                  contentFit="contain"
                />
              )}
              {(isBuffering && !hasError) && (
                <View style={styles.videoOverlay}>
                  <ActivityIndicator color="#fff" size="large" />
                </View>
              )}
              {hasError && (
                <View style={styles.videoOverlay}>
                  <Text style={styles.errorText}>Stream unavailable</Text>
                </View>
              )}
              {/* Fullscreen button */}
              <TouchableOpacity style={styles.fullscreenBtn} onPress={handleFullscreen} activeOpacity={0.8}>
                <Text style={styles.fullscreenIcon}>⛶</Text>
              </TouchableOpacity>
            </View>

            {/* Programme info below video */}
            <View style={[styles.progInfo, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              {currentProg ? (
                <>
                  <Text style={[styles.progTitle, { color: '#3B82F6' }]} numberOfLines={1}>
                    {currentProg.title}
                  </Text>
                  <Text style={[styles.progTime, { color: colors.mutedForeground }]}>
                    {fmtTime(currentProg.start)} – {fmtTime(currentProg.end)}
                  </Text>
                  {currentProg.description ? (
                    <Text style={[styles.progDesc, { color: colors.mutedForeground }]} numberOfLines={4}>
                      {currentProg.description}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={[styles.progTitle, { color: colors.foreground }]}>{selectedChannel.name}</Text>
              )}
            </View>
          </>
        ) : (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📺</Text>
            <Text style={[styles.noSelText, { color: colors.mutedForeground }]}>
              Select a channel to preview
            </Text>
          </View>
        )}
      </View>

      {/* ══ RIGHT PANEL: LIVE badge + channel info + EPG schedule ══ */}
      <View style={[styles.rightPanel, { borderLeftColor: colors.border, paddingTop: insets.top + 8, paddingRight: insets.right + 8 }]}>
        {selectedChannel ? (
          <>
            {/* LIVE TV badge */}
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveBadgeText}>LIVE TV</Text>
            </View>

            {/* Channel card */}
            <View style={[styles.chCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {selectedChannel.logo ? (
                <View style={[styles.chCardLogo, { backgroundColor: colors.secondary }]}>
                  <Image source={{ uri: selectedChannel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                </View>
              ) : null}
              <Text style={[styles.chCardName, { color: colors.foreground }]} numberOfLines={1}>
                {selectedChannel.name}
              </Text>
              {currentProg ? (
                <>
                  <Text style={[styles.chCardProg, { color: '#3B82F6' }]} numberOfLines={2}>
                    {currentProg.title}
                  </Text>
                  <Text style={[styles.chCardTime, { color: colors.mutedForeground }]}>
                    {fmtTime(currentProg.start)} – {fmtTime(currentProg.end)}
                  </Text>
                </>
              ) : null}

              {/* Fullscreen button */}
              <TouchableOpacity style={styles.watchBtn} onPress={handleFullscreen} activeOpacity={0.8}>
                <Text style={styles.watchBtnText}>▶  Watch Fullscreen</Text>
              </TouchableOpacity>
            </View>

            {/* Upcoming programmes */}
            <Text style={[styles.upcomingHeader, { color: colors.mutedForeground }]}>UPCOMING</Text>
            {upcoming.length > 0 ? (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                {upcoming.map((prog, i) => (
                  <View key={i} style={[styles.upcomingRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.upcomingTime, { color: '#3B82F6' }]}>
                      {fmtTime(prog.start)} – {fmtTime(prog.end)}
                    </Text>
                    <Text style={[styles.upcomingTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {prog.title}
                    </Text>
                    {prog.description ? (
                      <Text style={[styles.upcomingDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                        {prog.description}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', paddingTop: 20 }}>
                {epgMap
                  ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No guide data</Text>
                  : <ActivityIndicator color={colors.primary} size="small" />
                }
              </View>
            )}
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No channel selected</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },

  // ── Left panel ──
  leftPanel: {
    width: 310,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  catNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catArrowBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  catArrow: { fontSize: 22, fontWeight: '600', lineHeight: 26 },
  catLabel: { flex: 1, textAlign: 'center', fontSize: 12, fontFamily: 'Inter_600SemiBold' },

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
  chNum: { width: 26, fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'right', flexShrink: 0 },
  chLogo: { width: 40, height: 30, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  chSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  // ── Center panel ──
  centerPanel: { flex: 1 },
  videoWrap: { flex: 1, position: 'relative' },
  videoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: { color: '#fff', fontSize: 13, textAlign: 'center' },
  fullscreenBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  fullscreenIcon: { color: '#fff', fontSize: 15 },

  progInfo: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  progTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  progTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  progDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16, marginTop: 2 },

  noSel: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  noSelText: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  // ── Right panel ──
  rightPanel: {
    width: 240,
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: 10,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  },
  liveDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: '#EF4444' },
  liveBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 1.5 },

  chCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 5,
    marginBottom: 12,
  },
  chCardLogo: { width: 60, height: 40, borderRadius: 6, overflow: 'hidden', marginBottom: 4 },
  chCardName: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  chCardProg: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chCardTime: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  watchBtn: {
    marginTop: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  watchBtnText: { color: '#fff', fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  upcomingHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  upcomingRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  upcomingTime: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  upcomingTitle: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  upcomingDesc: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 14 },
});
