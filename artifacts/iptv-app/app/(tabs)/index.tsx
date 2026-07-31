import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DraggableFavList } from '@/components/DraggableFavList';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext } from '@/context/ParentalContext';
import { StorageService } from '@/services/storage';
import { fetchRemoteFavourites, pushRemoteChannels, mergeFavourites } from '@/services/favoritesSync';
import {
  getXtreamLiveCategories,
  getXtreamLiveStreams,
  getXtreamXmltvUrl,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import { RecentChannelsRail } from '@/components/RecentChannelsRail';
import { CatchupSheet } from '@/components/CatchupSheet';
import type { Channel, Category, EpgProgram, FavoriteChannel } from '@/types';

const FAVS_CAT_ID = '__favs';
const ALL_CAT_ID = '__all';

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
    <Pressable
      focusable
      style={({ focused }) => [
        styles.catRow,
        isSelected
          ? { backgroundColor: '#3B82F6' }
          : { borderBottomColor: colors.border },
        focused && styles.tvFocused,
      ]}
      onPress={onPress}
    >
      <Text
        style={[styles.catRowText, { color: isSelected ? '#fff' : colors.foreground }]}
        numberOfLines={2}
      >
        {cat.name}
      </Text>
    </Pressable>
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
  onHeartPress,
  hideHeart = false,
}: {
  channel: Channel;
  isSelected: boolean;
  isFav: boolean;
  nowPlaying?: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  onHeartPress: () => void;
  hideHeart?: boolean;
}) {
  return (
    <Pressable
      focusable={!hideHeart}
      style={({ focused }) => [
        styles.chRow,
        isSelected && !hideHeart && { backgroundColor: 'rgba(59,130,246,0.15)' },
        { borderBottomColor: colors.border },
        focused && !hideHeart && styles.tvFocused,
      ]}
      onPress={hideHeart ? undefined : onPress}
    >
      {isSelected && !hideHeart && <View style={styles.selectedPip} />}
      {channel.num != null && (
        <Text style={[styles.chNum, { color: isSelected && !hideHeart ? '#3B82F6' : colors.mutedForeground }]}>
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
          style={[styles.chName, { color: isSelected && !hideHeart ? '#F2F2F2' : colors.foreground }]}
          numberOfLines={1}
        >
          {channel.name}
        </Text>
        {nowPlaying ? (
          <Text
            style={[styles.chSub, { color: isSelected && !hideHeart ? '#93C5FD' : colors.mutedForeground }]}
            numberOfLines={1}
          >
            {nowPlaying}
          </Text>
        ) : null}
      </View>
      {!hideHeart && (
        <Pressable
          focusable
          onPress={onHeartPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={({ focused }) => [styles.heartBtn, focused && styles.tvFocusedRound]}
        >
          <Text style={[styles.heartIcon, { color: isFav ? '#EF4444' : colors.mutedForeground }]}>
            {isFav ? '♥' : '♡'}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials, lastWatchedUrl, deviceMac } = useAppContext();
  const { blockedChannels } = useParentalContext();
  const isWeb = Platform.OS === 'web';

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const [selectedCatId, setSelectedCatId] = useState<string>(FAVS_CAT_ID);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [nowTs, setNowTs] = useState(Date.now());

  // ── Catch-up sheet ───────────────────────────────────────────────────────
  const [showCatchup, setShowCatchup] = useState(false);

  // ── Reorder mode ─────────────────────────────────────────────────────────
  const [isReordering, setIsReordering] = useState(false);
  // Working copy used while the edit session is open
  const [reorderedFavs, setReorderedFavs] = useState<FavoriteChannel[]>([]);

  useEffect(() => {
    // Load local favourites immediately for instant UI, then merge with server.
    StorageService.getFavorites().then(async (local) => {
      setFavorites(local);
      const remote = await fetchRemoteFavourites(deviceMac);
      if (remote) {
        const merged = mergeFavourites(remote.channels, local);
        // Persist merged list locally so future offline loads are up-to-date.
        await StorageService.saveFavorites(merged);
        setFavorites(merged);
      }
    });
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [deviceMac]);

  // ── Video player ─────────────────────────────────────────────────────────
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (isWeb || !selectedChannel?.streamUrl) return;
    setIsBuffering(true);
    setHasError(false);
    const load = async () => {
      try {
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
        if (status === 'readyToPlay') {
          setIsBuffering(false);
          // For DVR/timeshift streams, player.replace() starts at the oldest
          // buffered segment (beginning of the DVR window) rather than the
          // live edge. Once ready, seek to the end of the reported duration
          // to jump to the live edge. Pure-live streams have duration = Infinity
          // or 0, so the seek is skipped safely.
          if (pendingLiveEdgeSeek.current) {
            pendingLiveEdgeSeek.current = false;
            // Short delay — duration is often populated a tick after readyToPlay
            setTimeout(() => {
              try {
                const d = player.duration;
                if (d && isFinite(d) && d > 0) {
                  player.currentTime = d;
                }
              } catch {}
            }, 300);
          }
        }
        if (status === 'error' || error) { setHasError(true); setIsBuffering(false); }
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  const goingToPlayerRef = useRef(false);
  // Set when navigating to fullscreen so we reload the live stream on return
  // (instead of resuming from the buffered start position).
  const liveReloadNeededRef = useRef(false);
  // After reloading for the live edge, seek to end of DVR window once ready.
  const pendingLiveEdgeSeek = useRef(false);
  const selectedChannelRef = useRef(selectedChannel);
  useEffect(() => { selectedChannelRef.current = selectedChannel; }, [selectedChannel]);
  const channelsRef = useRef(channels);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  const lastWatchedUrlRef = useRef(lastWatchedUrl);
  useEffect(() => { lastWatchedUrlRef.current = lastWatchedUrl; }, [lastWatchedUrl]);

  useFocusEffect(
    useCallback(() => {
      if (!isWeb && player) {
        const curCh  = selectedChannelRef.current;
        const lastUrl = lastWatchedUrlRef.current;

        // If returning from fullscreen player where user navigated to a
        // different channel, sync the preview box to that channel.
        if (lastUrl && curCh && lastUrl !== curCh.streamUrl) {
          const found = channelsRef.current.find((ch) => ch.streamUrl === lastUrl);
          if (found) {
            setSelectedChannel(found);
            setPlayingChannel(found);
            // The useEffect on selectedChannel.streamUrl reloads the preview player
          } else {
            try { player.play(); } catch {}
          }
        } else if (curCh) {
          // Returning from fullscreen — reload stream to jump to live edge;
          // otherwise simply resume the paused preview.
          if (liveReloadNeededRef.current) {
            liveReloadNeededRef.current = false;
            pendingLiveEdgeSeek.current = true;
            try { player.replace(curCh.streamUrl); player.play(); } catch {}
          } else {
            try { player.play(); } catch {}
          }
        } else if (lastUrl) {
          // Arriving at Live TV fresh after watching elsewhere — restore preview
          const found = channelsRef.current.find((ch) => ch.streamUrl === lastUrl);
          if (found) {
            setSelectedChannel(found);
            setPlayingChannel(found);
          }
        }
      }

      return () => {
        if (goingToPlayerRef.current) {
          goingToPlayerRef.current = false;
          return;
        }
        if (!isWeb && player) {
          try { player.pause(); } catch {}
        }
        setSelectedChannel(null);
        setPlayingChannel(null);
      };
    }, [player, isWeb])
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
    () => [
      { id: FAVS_CAT_ID, name: '♥ Favourites' },
      { id: ALL_CAT_ID, name: 'All Channels' },
      ...rawCategories,
    ],
    [rawCategories],
  );

  const currentCat = useMemo(
    () => allCategories.find((c) => c.id === selectedCatId) ?? allCategories[0],
    [allCategories, selectedCatId],
  );

  const isFavsSelected = selectedCatId === FAVS_CAT_ID;

  const { data: fetchedChannels = [], isLoading: channelsLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels', selectedCatId, credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream') {
        const catId = selectedCatId === ALL_CAT_ID ? undefined : selectedCatId;
        return getXtreamLiveStreams(buildCreds(credentials), catId);
      }
      if (credentials.m3uUrl) {
        const { channels: all } = await fetchAndParseM3U(credentials.m3uUrl);
        return selectedCatId === ALL_CAT_ID ? all : all.filter((c) => c.groupTitle === selectedCatId);
      }
      return [];
    },
    enabled: !!credentials && !isFavsSelected,
    staleTime: 5 * 60_000,
  });

  const blockedSet = useMemo(() => new Set(blockedChannels), [blockedChannels]);

  // When Favourites is selected, use stored favourites as the channel list.
  // Always filter out blocked channels so they don't appear in any category.
  const channels: Channel[] = useMemo(() => {
    const base = isFavsSelected
      ? favorites.map((f) => ({
          id: f.id,
          name: f.name,
          logo: f.logo,
          groupTitle: f.groupTitle,
          streamUrl: f.streamUrl,
          epgId: f.epgId,
        }))
      : fetchedChannels;
    return blockedSet.size > 0 ? base.filter((ch) => !blockedSet.has(ch.id)) : base;
  }, [isFavsSelected, favorites, fetchedChannels, blockedSet]);

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

  const channelEpg = useMemo(() => {
    if (!selectedChannel || !epgMap) return [];
    const progs = epgMap.get(selectedChannel.epgId ?? selectedChannel.id) ?? [];
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
    // Exit reorder mode whenever the user switches category
    setIsReordering(false);
  }, []);

  // ── Reorder mode handlers ─────────────────────────────────────────────────

  const handleEditStart = useCallback(() => {
    Haptics.selectionAsync();
    // Only show non-blocked channels in reorder mode — same filter applied elsewhere
    const visible = blockedSet.size > 0
      ? favorites.filter((f) => !blockedSet.has(f.id))
      : favorites;
    setReorderedFavs(visible);
    setIsReordering(true);
    setSelectedChannel(null);
  }, [favorites, blockedSet]);

  const handleDone = useCallback(async () => {
    Haptics.selectionAsync();
    setIsReordering(false);
    // Reordered list only contains visible channels; re-append blocked ones at the
    // end so they stay in storage and reappear if the block is ever lifted.
    const blockedFavs = blockedSet.size > 0
      ? favorites.filter((f) => blockedSet.has(f.id))
      : [];
    const merged = [...reorderedFavs, ...blockedFavs];
    setFavorites(merged);
    await StorageService.saveFavorites(merged);
    pushRemoteChannels(deviceMac, merged);
  }, [reorderedFavs, favorites, blockedSet, deviceMac]);

  const handleSelectChannel = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedChannel(ch);
    setPlayingChannel(ch);
    // Record in recently-watched (fire-and-forget — never blocks the UI)
    StorageService.addRecentChannel({
      id: ch.id,
      name: ch.name,
      logo: ch.logo,
      groupTitle: ch.groupTitle,
      streamUrl: ch.streamUrl,
      epgId: ch.epgId,
      watchedAt: Date.now(),
    }).catch(() => {});
  }, []);

  const handleToggleFav = useCallback(async (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleFavorite({
      id: ch.id,
      name: ch.name,
      logo: ch.logo,
      groupTitle: ch.groupTitle,
      streamUrl: ch.streamUrl,
      epgId: ch.epgId,
    });
    setFavorites(updated);
    // Sync only channels to the server — other categories remain untouched.
    pushRemoteChannels(deviceMac, updated);
  }, [deviceMac]);

  const handleWatch = useCallback(() => {
    if (!selectedChannel) return;
    goingToPlayerRef.current = true;
    liveReloadNeededRef.current = true;

    // Pause preview player BEFORE navigating to stop double audio
    try { player.pause(); } catch {}

    // Build a lean channel list for prev/next navigation in fullscreen
    const chList = channels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
    }));
    const idx = channels.findIndex((ch) => ch.id === selectedChannel.id);

    router.push({
      pathname: '/player',
      params: {
        url: selectedChannel.streamUrl,
        title: selectedChannel.name,
        type: 'live',
        logo: selectedChannel.logo ?? '',
        epgId: selectedChannel.epgId ?? selectedChannel.id,
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
      },
    });
  }, [selectedChannel, channels, player, router]);

  /** Navigate directly to the fullscreen player from a recently-watched card. */
  const handleWatchChannel = useCallback((ch: Channel) => {
    goingToPlayerRef.current = true;
    liveReloadNeededRef.current = true;
    try { player.pause(); } catch {}

    const chList = channels.map((c) => ({
      url: c.streamUrl,
      title: c.name,
      epgId: c.epgId ?? c.id,
    }));
    const idx = channels.findIndex((c) => c.id === ch.id);

    router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        // If the channel isn't in the current category list, skip nav arrows
        channelsJson: idx >= 0 ? JSON.stringify(chList) : '[]',
        channelIndex: String(idx),
      },
    });
  }, [channels, player, router]);

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
      onHeartPress={() => handleToggleFav(item)}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleToggleFav]);

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
          removeClippedSubviews={false}
        />
      </View>

      {/* ══ MIDDLE: channel list ══ */}
      <View style={[styles.chPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        {/* Panel header — shows Edit/Done button when Favourites is active */}
        <View style={[styles.chPanelHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
            {currentCat?.name?.toUpperCase() ?? 'CHANNELS'}
          </Text>
          {isFavsSelected && favorites.length > 1 && (
            <Pressable
              onPress={isReordering ? handleDone : handleEditStart}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.editBtnText}>
                {isReordering ? 'Done' : 'Edit'}
              </Text>
            </Pressable>
          )}
        </View>

        {channelsLoading && !isFavsSelected ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : channels.length === 0 && isFavsSelected ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>♡</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No favourites yet</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Tap ♡ next to any channel to add it here.
            </Text>
          </View>
        ) : isFavsSelected && isReordering ? (
          <DraggableFavList
            data={reorderedFavs}
            keyExtractor={(ch) => ch.id}
            renderItem={(ch) => (
              <ChannelRow
                channel={{ id: ch.id, name: ch.name, logo: ch.logo, groupTitle: ch.groupTitle, streamUrl: ch.streamUrl, epgId: ch.epgId }}
                isSelected={false}
                isFav
                nowPlaying={nowPlayingMap.get(ch.epgId ?? ch.id)}
                colors={colors}
                onPress={() => {}}
                onHeartPress={() => {}}
                hideHeart
              />
            )}
            onReorder={setReorderedFavs}
            rowHeight={60}
            colors={colors}
          />
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
            removeClippedSubviews={false}
          />
        )}
      </View>

      {/* ══ RIGHT: preview + EPG ══ */}
      <View style={[styles.previewPanel, { paddingTop: insets.top + 4, paddingRight: insets.right + 8 }]}>

        {!isWeb && (
          <>
            <TouchableOpacity
              style={[styles.videoWrap, !playingChannel && { display: 'none' }]}
              onPress={handleWatch}
              activeOpacity={0.85}
              focusable={false}
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
            </TouchableOpacity>
            {playingChannel && (
              <Pressable
                focusable
                onPress={handleWatch}
                style={({ focused }) => [
                  styles.watchBtn,
                  focused && styles.watchBtnFocused,
                ]}
              >
                <Text style={styles.watchBtnText}>▶  Watch Fullscreen</Text>
              </Pressable>
            )}
          </>
        )}

        {/* ── Recently Watched Rail ── */}
        <RecentChannelsRail
          blockedIds={blockedSet}
          nowPlayingMap={nowPlayingMap}
          onSelectChannel={handleSelectChannel}
          onWatchFullscreen={handleWatchChannel}
        />

        {selectedChannel ? (
          <>
            {/* ── EPG header row with optional Catch-up button ── */}
            <View style={styles.epgHeaderRow}>
              <Text style={[styles.epgHeader, { color: colors.mutedForeground }]}>TV GUIDE</Text>
              {selectedChannel.tvArchive === 1 && (
                <Pressable
                  onPress={() => setShowCatchup(true)}
                  style={({ pressed }) => [styles.catchupBtn, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.catchupBtnText}>📅 Catch-up</Text>
                </Pressable>
              )}
            </View>
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
          <View style={styles.noSel}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>📺</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>Select a channel</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Choose a category, then pick a channel to preview it here. Press OK to watch fullscreen.
            </Text>
          </View>
        )}
      </View>

      {/* ── Catch-up sheet ── */}
      {showCatchup && selectedChannel && creds && (
        <CatchupSheet
          key={selectedChannel.id}
          visible={showCatchup}
          channel={selectedChannel}
          creds={creds}
          epgMap={epgMap}
          onClose={() => setShowCatchup(false)}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },

  // ── TV / D-pad focus rings ──
  tvFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
  tvFocusedRound: {
    borderWidth: 2,
    borderColor: '#00E5FF',
    borderRadius: 99,
  },

  // ── Watch fullscreen button ──
  watchBtn: {
    marginTop: 6,
    marginBottom: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  watchBtnFocused: {
    borderColor: '#00E5FF',
    backgroundColor: '#2563EB',
  },
  watchBtnText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },

  panelHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },

  // ── Channel panel header (title + Edit/Done button) ──
  chPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 6,
    marginLeft: 'auto',
  },
  editBtnText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
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
  heartBtn: { flexShrink: 0, paddingHorizontal: 4 },
  heartIcon: { fontSize: 16 },

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

  epgHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  epgHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
  },
  catchupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  catchupBtnText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
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
