import { FocusablePressable } from '@/components/FocusablePressable';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  BackHandler,
  DeviceEventEmitter,
  FlatList,
  Image,
  Keyboard,
  RefreshControl,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  scheduleReminderNotification,
  cancelReminderNotification,
} from '@/services/notifications';
import { DraggableFavList } from '@/components/DraggableFavList';
import { VideoView } from 'expo-video';
import { useLivePlayer } from '@/context/LivePlayerContext';
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
import { CatchupSheet } from '@/components/CatchupSheet';
import { TVLiveLayout } from '@/components/TVLiveLayout';
import type { Channel, Category, EpgProgram, FavoriteChannel } from '@/types';
import { normaliseStr } from '@/utils/normalise';

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
  isBlocked = false,
  channelCount,
  colors,
  onPress,
  onLongPress,
}: {
  cat: Category;
  isSelected: boolean;
  isBlocked?: boolean;
  channelCount?: number;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <FocusablePressable
      focusedStyle={styles.tvFocused}
      style={[
        styles.catRow,
        isSelected
          ? { backgroundColor: '#3B82F6' }
          : { borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    >
      <Text
        style={[
          styles.catRowText,
          {
            color: isSelected ? '#fff' : isBlocked ? '#EF4444' : colors.foreground,
            opacity: isBlocked ? 0.6 : 1,
          },
        ]}
        numberOfLines={2}
      >
        {isBlocked ? '⊘ ' : ''}{cat.name}
      </Text>
      {channelCount !== undefined && channelCount > 0 && (
        <Text style={[styles.catCount, { color: isSelected ? 'rgba(255,255,255,0.65)' : colors.mutedForeground }]}>
          {channelCount}
        </Text>
      )}
    </FocusablePressable>
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
  onLongPress,
  hideHeart = false,
}: {
  channel: Channel;
  isSelected: boolean;
  isFav: boolean;
  nowPlaying?: string;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  onHeartPress: () => void;
  onLongPress?: () => void;
  hideHeart?: boolean;
}) {
  return (
    <FocusablePressable
      focusable={!hideHeart}
      focusedStyle={!hideHeart ? styles.tvFocused : {}}
      style={[
        styles.chRow,
        isSelected && !hideHeart && { backgroundColor: 'rgba(59,130,246,0.15)' },
        { borderBottomColor: colors.border },
      ]}
      onPress={hideHeart ? undefined : onPress}
      onLongPress={hideHeart ? undefined : onLongPress}
      delayLongPress={500}
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
        <FocusablePressable
          focusable
          onPress={onHeartPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          focusedStyle={styles.tvFocusedRound}
          style={styles.heartBtn}
        >
          <Text style={[styles.heartIcon, { color: isFav ? '#EF4444' : colors.mutedForeground }]}>
            {isFav ? '♥' : '♡'}
          </Text>
        </FocusablePressable>
      )}
    </FocusablePressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function LiveTVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials, lastWatchedUrl, deviceMac } = useAppContext();
  const { blockedChannels, blockedCategoryIds, setBlockedChannelIds, toggleBlockedCategory, pruneBlockedCategories } = useParentalContext();
  const isWeb = Platform.OS === 'web';

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const [selectedCatId, setSelectedCatId] = useState<string>(FAVS_CAT_ID);
  // Persist and restore the last-selected category so the user lands where they left off
  useEffect(() => {
    import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
      AS.getItem('@pref_live_cat').then((v) => { if (v) setSelectedCatId(v); })
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [catSearch, setCatSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
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

  // ── Favourites sync state (#22) ──────────────────────────────────────────
  const [favSyncState, setFavSyncState] = useState<'idle' | 'syncing' | 'synced'>('idle');

  useEffect(() => {
    // Load local favourites immediately for instant UI, then merge with server.
    StorageService.getFavorites().then(async (local) => {
      setFavorites(local);
      setFavSyncState('syncing');
      const remote = await fetchRemoteFavourites(deviceMac);
      if (remote) {
        const merged = mergeFavourites(remote.channels, local);
        await StorageService.saveFavorites(merged);
        setFavorites(merged);
        // #21: if there were local-only items (added offline), push them back
        if (merged.length > remote.channels.length) {
          pushRemoteChannels(deviceMac, merged).catch(() => {});
        }
      }
      setFavSyncState('synced');
      setTimeout(() => setFavSyncState('idle'), 2000);
    }).catch(() => { setFavSyncState('idle'); });
  }, [deviceMac]);

  // #126: EPG "now" ticker — tied to credentials so the interval is cleared on
  // logout and immediately fires a fresh tick when a new user logs in, ensuring
  // stale stream-URL state from the previous session is never reused.
  useEffect(() => {
    if (!credentials) return; // cleared on logout — no timer needed
    setNowTs(Date.now()); // immediate tick so the new session is always current
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [credentials]);

  // ── Video player (shared from LivePlayerContext — persists across navigation) ──
  const { player, activeUrlRef: liveUrlRef, miniPlayerRef, isCollapsingRef, collapseRestorePendingRef, pendingCollapseRemountRef, onCollapseCompleteRef, triggerExpand, triggerExpandFromRef } = useLivePlayer();

  // Animated overlay that snaps to opaque synchronously (no React reconciler
  // roundtrip) before player.replace() is called, preventing the black flash
  // that appears when the VideoView surface clears before buffering starts.
  // Also used when remounting VideoView on focus return. Fades out on readyToPlay.
  const flashOverlayOpacity = useRef(new Animated.Value(0)).current;

  // On Android the video Surface goes black when returning from the fullscreen
  // player because the native TextureView loses its binding to the shared player.
  // Incrementing this key forces VideoView to remount, re-binding the Surface.
  // The flash overlay hides any single-frame black during the remount.
  const [videoKey, setVideoKey] = useState(0);
  const isFirstFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (isFirstFocusRef.current) {
      isFirstFocusRef.current = false;
      return;
    }
    // Returning from a fullscreen session started via recently-watched — the
    // player was paused in handleBackLive; just clear the playing channel so
    // the mini-player hides and no audio continues in the background.
    if (clearChannelOnReturnRef.current) {
      clearChannelOnReturnRef.current = false;
      try { player?.pause(); } catch {}
      setPlayingChannel(null);
      setSelectedChannel(null);
      return;
    }
    if (collapseRestorePendingRef.current) {
      // This focus return is from a fullscreen collapse.  We must NOT set
      // flashOverlayOpacity=1 here because ExoPlayer stays in STATE_READY
      // when re-attaching to a new surface, so readyToPlay never re-fires
      // and the overlay would stay permanently black.
      //
      // Two timing scenarios depending on navigation speed:
      //
      // Fast navigation (< 200 ms): the 200 ms timeout hasn't fired yet.
      //   pendingCollapseRemountRef is still true.  Register the callback so
      //   the rAF handler calls setVideoKey AFTER setOverlayVisible(false)
      //   has committed (guaranteeing overlay unmount before mini-player mount).
      //
      // Slow navigation (> 200 ms + 2 rAFs): the rAF handler already ran with
      //   no callback registered, and cleared pendingCollapseRemountRef.
      //   setOverlayVisible(false) has already committed, so the overlay is
      //   gone.  Call setVideoKey directly — it's safe to mount now.
      collapseRestorePendingRef.current = false;
      if (pendingCollapseRemountRef.current) {
        onCollapseCompleteRef.current = () => setVideoKey((k) => k + 1);
      } else {
        setVideoKey((k) => k + 1);
      }
      return;
    }
    // Normal focus return (tab switch, etc.) — show flash overlay to cover the
    // single-frame black while the VideoView remounts and re-binds the surface.
    flashOverlayOpacity.setValue(1);
    setVideoKey((k) => k + 1);
  }, [flashOverlayOpacity, isCollapsingRef, collapseRestorePendingRef, pendingCollapseRemountRef, onCollapseCompleteRef]));

  // ── AppState tracking (#21/#31/#53) ──────────────────────────────────────
  const isAppBackgroundRef = useRef(false);
  // Holds the last failed favourites push so it can be retried on foreground (#21)
  const pendingFavPushRef = useRef<FavoriteChannel[] | null>(null);
  useEffect(() => {
    if (isWeb) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const wasBackground = isAppBackgroundRef.current;
      isAppBackgroundRef.current = state === 'background' || state === 'inactive';
      // Retry a failed push when the user brings the app back to the foreground
      if (wasBackground && !isAppBackgroundRef.current && pendingFavPushRef.current) {
        const toRetry = pendingFavPushRef.current;
        pendingFavPushRef.current = null;
        pushRemoteChannels(deviceMac, toRetry).then((ok) => {
          if (!ok) pendingFavPushRef.current = toRetry; // still offline — queue again
        });
      }
    });
    return () => sub.remove();
  }, [isWeb, deviceMac]);

  // Tracks whether a load is still wanted — incremented on each new channel
  const loadGenRef = useRef(0);
  // Retry timer ref for #30
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isWeb || !selectedChannel?.streamUrl) return;
    const url = selectedChannel.streamUrl;

    // If the shared player already has this URL loaded (e.g. returning from
    // the fullscreen player on the same channel), just ensure it's playing —
    // no replaceAsync, no buffering gap.
    if (liveUrlRef.current === url) {
      setIsBuffering(false);
      setHasError(false);
      try { if (!player.playing) player.play(); } catch {}
      return;
    }

    // Different channel — load it.
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    setIsBuffering(true);
    setHasError(false);
    const gen = ++loadGenRef.current;
    const load = async () => {
      try {
        try { player.pause(); } catch {}
        flashOverlayOpacity.setValue(1);
        liveUrlRef.current = url;
        await (player as any).replaceAsync(url);
        if (gen !== loadGenRef.current) return; // superseded
        player.play();
      } catch {
        if (gen !== loadGenRef.current) return;
        setHasError(true);
        setIsBuffering(false);
        Animated.timing(flashOverlayOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
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
          // Fade the flash overlay out smoothly once a frame is available.
          Animated.timing(flashOverlayOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
          }).start();
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
        if (status === 'error' || error) {
          setIsBuffering(false);
          Animated.timing(flashOverlayOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
          // #31: suppress error UI when app is in the background
          if (!isAppBackgroundRef.current) {
            setHasError(true);
          }
          // #30: auto-retry after 5 s if still on the same channel
          const gen = loadGenRef.current;
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            // #138: skip if the fullscreen player is open — it handles re-resolution itself
            if (gen !== loadGenRef.current || isAppBackgroundRef.current || goingToPlayerRef.current) return;
            const url = selectedChannelRef.current?.streamUrl;
            if (!url) return;
            setHasError(false);
            setIsBuffering(true);
            flashOverlayOpacity.setValue(1);
            try { player.replace(url); player.play(); } catch {}
          }, 5000);
        }
      }),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };
  }, [player]);

  const goingToPlayerRef = useRef(false);
  /** Set when navigating to fullscreen from recently-watched so that backing
   *  out stops the stream rather than leaving it playing in the mini-player. */
  const clearChannelOnReturnRef = useRef(false);
  // After reloading for the live edge, seek to end of DVR window once ready.
  const pendingLiveEdgeSeek = useRef(false);
  // Timestamp (ms) when the Live TV tab was last blurred — used to decide
  // whether the preview is stale enough to warrant a live-edge reload.
  const tabBlurredAtRef = useRef<number | null>(null);
  // How long the tab must have been away before we reload to the live edge.
  const LIVE_EDGE_AWAY_THRESHOLD_MS = 30_000;
  const selectedChannelRef = useRef(selectedChannel);
  useEffect(() => { selectedChannelRef.current = selectedChannel; }, [selectedChannel]);
  // Initialise with [] — channels is declared later via useMemo so it isn't in
  // scope here. channelsRef.current is updated synchronously after channels is
  // declared below (render-time assignment avoids the TDZ dep-array crash).
  const channelsRef = useRef<Channel[]>([]);
  const lastWatchedUrlRef = useRef(lastWatchedUrl);
  useEffect(() => { lastWatchedUrlRef.current = lastWatchedUrl; }, [lastWatchedUrl]);

  // When the fullscreen player switches channels (prev/next), keep mini-player in sync
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('channel:switched', ({ url }: { url: string }) => {
      const found = channelsRef.current.find((ch) => ch.streamUrl === url);
      if (found) {
        setSelectedChannel(found);
        setPlayingChannel(found);
      }
    });
    return () => sub.remove();
  }, []);

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
          // Reload the stream to the live edge if:
          //   (a) returning from the fullscreen player (liveReloadNeededRef), OR
          //   (b) the tab was away for long enough that the preview is stale.
          const blurredAt = tabBlurredAtRef.current;
          const tabWasStale =
            blurredAt !== null &&
            Date.now() - blurredAt > LIVE_EDGE_AWAY_THRESHOLD_MS;
          if (tabWasStale) {
            pendingLiveEdgeSeek.current = true;
            // Show the buffering spinner and snap overlay opaque BEFORE replace()
            // so the black flash on the VideoView surface is hidden from the start.
            setIsBuffering(true);
            setHasError(false);
            flashOverlayOpacity.setValue(1);
            try {
              player.replace(curCh.streamUrl);
              player.play();
            } catch {
              // replace() threw synchronously before a statusChange error event.
              // Dismiss the overlay immediately so the error UI is not hidden.
              setHasError(true);
              setIsBuffering(false);
              Animated.timing(flashOverlayOpacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
              }).start();
            }
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
          // tabBlurredAtRef is intentionally NOT set here; liveReloadNeededRef
          // is the signal used when returning from the fullscreen player.
          return;
        }
        // Record when the tab was blurred so we can decide on return whether
        // the preview is stale enough to warrant a live-edge reload.
        tabBlurredAtRef.current = Date.now();
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

  // Clear channel filter whenever the user switches category
  useEffect(() => { setChannelFilter(''); }, [selectedCatId]);

  // Android back button: pop through active states one level at a time
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Exit reorder mode first
      if (isReordering) { setIsReordering(false); return true; }
      // Dismiss catch-up sheet
      if (showCatchup) { setShowCatchup(false); return true; }
      // Clear channel-list text filter
      if (channelFilter.trim()) { setChannelFilter(''); Keyboard.dismiss(); return true; }
      // Clear category search
      if (catSearch.trim()) { setCatSearch(''); return true; }
      // Stop/deselect the playing channel
      if (selectedChannel) { setPlayingChannel(null); setSelectedChannel(null); return true; }
      // Nothing left to pop — let global handler focus the sidebar
      return false;
    });
    return () => handler.remove();
  }, [isReordering, showCatchup, channelFilter, catSearch, selectedChannel]);

  const channelListRef = useRef<FlatList<Channel>>(null);
  // filteredChannels and its useEffect are declared AFTER channels (below) to
  // avoid temporal dead zone crashes — see channels useMemo declaration.

  const filteredCategories = useMemo(() => {
    const q = normaliseStr(catSearch.trim());
    if (!q) return allCategories;
    return allCategories.filter((c) => normaliseStr(c.name).includes(q));
  }, [allCategories, catSearch]);

  const currentCat = useMemo(
    () => allCategories.find((c) => c.id === selectedCatId) ?? allCategories[0],
    [allCategories, selectedCatId],
  );

  const isFavsSelected = selectedCatId === FAVS_CAT_ID;

  const { data: fetchedChannels = [], isLoading: channelsLoading, isRefetching, refetch } = useQuery<Channel[]>({
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

  // Task #11: remove blocked channel IDs that no longer exist in the full channel
  // list. Runs only when the user has "All Channels" loaded (complete roster).
  useEffect(() => {
    if (selectedCatId !== ALL_CAT_ID || fetchedChannels.length === 0 || blockedChannels.length === 0) return;
    const existingIds = new Set(fetchedChannels.map((c) => c.id));
    const cleaned = blockedChannels.filter((id) => existingIds.has(id));
    if (cleaned.length < blockedChannels.length) setBlockedChannelIds(cleaned);
  }, [fetchedChannels, selectedCatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockedSet = useMemo(() => new Set(blockedChannels), [blockedChannels]);

  // Channel count per category for the category panel badge
  const catChannelCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const ch of fetchedChannels) {
      if (blockedSet.has(ch.id)) continue;
      // Xtream categories use name as groupTitle; M3U may use id or name
      const key = ch.groupTitle ?? '';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [fetchedChannels, blockedSet]);

  // Map blocked category IDs → names so both Xtream (groupTitle = name) and
  // M3U (groupTitle = id) channels are filtered correctly.
  const blockedCatNames = useMemo(() => {
    const s = new Set<string>(blockedCategoryIds);
    rawCategories.forEach((cat) => { if (blockedCategoryIds.includes(cat.id)) s.add(cat.name); });
    return s;
  }, [blockedCategoryIds, rawCategories]);

  // #11: prune orphaned blocked-category IDs whenever the category list refreshes
  useEffect(() => {
    if (rawCategories.length === 0) return;
    pruneBlockedCategories(rawCategories.map((c) => c.id));
  }, [rawCategories, pruneBlockedCategories]);

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
    return base.filter((ch) => !blockedSet.has(ch.id) && !blockedCatNames.has(ch.groupTitle));
  }, [isFavsSelected, favorites, fetchedChannels, blockedSet, blockedCatNames]);

  // Keep channelsRef current synchronously so callbacks always see the latest
  // list without stale closures (declared early with [], updated here each render).
  channelsRef.current = channels;

  // filteredChannels is declared here — after channels — so neither it nor its
  // useEffect dep array ever hits a temporal dead zone.
  const filteredChannels: Channel[] = useMemo(() => {
    const q = normaliseStr(channelFilter.trim());
    if (!q) return channels;
    return channels.filter((ch) => normaliseStr(ch.name).includes(q));
  }, [channels, channelFilter]);

  // Scroll back to top whenever the filter changes so the first match is visible
  useEffect(() => {
    if (channelFilter.trim()) {
      channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [channelFilter, filteredChannels]);

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

  // ── Mini-guide reminder state ─────────────────────────────────────────────
  const [miniReminderIds, setMiniReminderIds] = useState<Set<string>>(new Set());

  // Reload which programs have reminders whenever the EPG list changes or the
  // screen comes back into focus (e.g. after visiting the Reminders tab).
  useEffect(() => {
    if (!selectedChannel || channelEpg.length === 0) return;
    StorageService.getReminders().then((all) => {
      const ids = new Set(all.map((r) => r.id));
      setMiniReminderIds(ids);
    });
  }, [channelEpg, selectedChannel]);

  useFocusEffect(useCallback(() => {
    StorageService.getReminders().then((all) => {
      setMiniReminderIds(new Set(all.map((r) => r.id)));
    });
  }, []));

  // #125: keep miniReminderIds in sync when a reminder is set/removed from another
  // screen (e.g. TV Guide) while the Live TV tab is already focused.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('reminders:changed', () => {
      StorageService.getReminders().then((all) => {
        setMiniReminderIds(new Set(all.map((r) => r.id)));
      });
    });
    return () => sub.remove();
  }, []);

  const handleToggleMiniReminder = useCallback(async (prog: EpgProgram) => {
    if (!selectedChannel) return;
    const reminderId = `${selectedChannel.id}_${prog.start.toISOString()}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (miniReminderIds.has(reminderId)) {
      const nid = await StorageService.getReminderNotificationId(reminderId);
      await cancelReminderNotification(nid);
      await StorageService.removeReminder(reminderId);
      setMiniReminderIds((prev) => { const s = new Set(prev); s.delete(reminderId); return s; });
    } else {
      const leadMins = await StorageService.getReminderLeadMins();
      const reminder = {
        id: reminderId,
        channelId: selectedChannel.id,
        channelName: selectedChannel.name,
        channelLogo: selectedChannel.logo,
        streamUrl: selectedChannel.streamUrl,
        programTitle: prog.title,
        programDescription: prog.description,
        start: prog.start.toISOString(),
        end: prog.end.toISOString(),
        createdAt: new Date().toISOString(),
        leadMins,
      };
      const notificationId = await scheduleReminderNotification(reminder, leadMins) ?? undefined;
      await StorageService.addReminder({ ...reminder, notificationId });
      setMiniReminderIds((prev) => new Set([...prev, reminderId]));
    }
    DeviceEventEmitter.emit('reminders:changed');
  }, [selectedChannel, miniReminderIds]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectCat = useCallback((catId: string) => {
    import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
      AS.setItem('@pref_live_cat', catId)
    );
    Haptics.selectionAsync();
    setSelectedCatId(catId);
    setSelectedChannel(null);
    // Exit reorder mode whenever the user switches category
    setIsReordering(false);
    // Scroll the channel list back to the top so the first channel is visible
    channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
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
    // #22: show syncing indicator while the push is in flight
    setFavSyncState('syncing');
    const ok = await pushRemoteChannels(deviceMac, updated);
    // #21: if the push failed (offline / server rejection), queue it for retry on foreground
    if (!ok) pendingFavPushRef.current = updated;
    setFavSyncState('synced');
    setTimeout(() => setFavSyncState('idle'), 2000);
  }, [deviceMac]);

  const handleWatch = useCallback(() => {
    if (!selectedChannel) return;
    goingToPlayerRef.current = true;
    // Shared player keeps streaming — no pause needed before going fullscreen.

    // Build a lean channel list for prev/next navigation in fullscreen
    const chList = channels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
    }));
    const idx = channels.findIndex((ch) => ch.id === selectedChannel.id);

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: selectedChannel.streamUrl,
        title: selectedChannel.name,
        type: 'live',
        logo: selectedChannel.logo ?? '',
        epgId: selectedChannel.epgId ?? selectedChannel.id,
        channelId: selectedChannel.id,
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
      },
    });

    // Animate the mini-player expanding to fullscreen, then navigate.
    triggerExpand(navigate);
  }, [selectedChannel, channels, player, router, triggerExpand]);

  /** Navigate directly to the fullscreen player from a recently-watched card. */
  const handleWatchChannel = useCallback((ch: Channel, cardRef?: React.RefObject<View | null>) => {
    goingToPlayerRef.current = true;
    // Mark that we came from recently-watched so backing out stops the stream
    // rather than leaving it playing silently in the mini-player.
    clearChannelOnReturnRef.current = true;
    // Update the right-panel EPG to show this channel's guide
    setSelectedChannel(ch);

    const chList = channels.map((c) => ({
      url: c.streamUrl,
      title: c.name,
      epgId: c.epgId ?? c.id,
      logo: c.logo ?? '',
      channelId: c.id,
    }));
    const idx = channels.findIndex((c) => c.id === ch.id);

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        channelId: ch.id,
        stopOnBack: 'true',
        // If the channel isn't in the current category list, skip nav arrows
        channelsJson: idx >= 0 ? JSON.stringify(chList) : '[]',
        channelIndex: String(idx),
      },
    });

    // Animate from the tapped card's position if a ref was provided,
    // otherwise fall back to the mini-player expand (or immediate navigation).
    if (cardRef) {
      triggerExpandFromRef(cardRef, navigate);
    } else {
      triggerExpand(navigate);
    }
  }, [channels, router, triggerExpandFromRef, triggerExpand]);

  const renderCat = useCallback(({ item }: { item: Category }) => {
    const isBlockable = item.id !== FAVS_CAT_ID && item.id !== ALL_CAT_ID;
    const isBlocked = isBlockable && blockedCategoryIds.includes(item.id);
    // Compute channel count: All = total non-blocked, Favs = favourites, others = by groupTitle name
    let channelCount: number | undefined;
    if (item.id === ALL_CAT_ID) {
      channelCount = fetchedChannels.filter((ch) => !blockedSet.has(ch.id)).length;
    } else if (item.id === FAVS_CAT_ID) {
      channelCount = favorites.length;
    } else {
      channelCount = catChannelCountMap.get(item.name);
    }
    return (
      <CategoryRow
        cat={item}
        isSelected={item.id === selectedCatId}
        isBlocked={isBlocked}
        channelCount={channelCount}
        colors={colors}
        onPress={() => handleSelectCat(item.id)}
        onLongPress={isBlockable ? () => {
          const action = isBlocked ? 'Unblock' : 'Block';
          Alert.alert(
            `${action} Category`,
            `${action} all channels in "${item.name}"?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: action, style: isBlocked ? 'default' : 'destructive', onPress: () => toggleBlockedCategory(item.id) },
            ],
          );
        } : undefined}
      />
    );
  }, [selectedCatId, blockedCategoryIds, catChannelCountMap, fetchedChannels, blockedSet, favorites, colors, handleSelectCat, toggleBlockedCategory]);

  const handleLongPressChannel = useCallback((ch: Channel) => {
    const isBlocked = blockedChannels.includes(ch.id);
    const action = isBlocked ? 'Unblock' : 'Block';
    Alert.alert(
      ch.name,
      isBlocked ? 'Unblock this channel?' : 'Block this channel? It will be hidden everywhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Show Info',
          onPress: () => {
            const nowProg = nowPlayingMap.get(ch.epgId ?? ch.id);
            Alert.alert(
              ch.name,
              [
                nowProg ? `▶ Now: ${nowProg.title}` : null,
                `Category: ${ch.groupTitle || '—'}`,
                `Stream ID: ${ch.id}`,
                ch.epgId ? `EPG ID: ${ch.epgId}` : null,
                ch.num != null ? `Channel #: ${ch.num}` : null,
              ].filter(Boolean).join('\n'),
            );
          },
        },
        {
          text: action,
          style: isBlocked ? 'default' : 'destructive',
          onPress: () => {
            const updated = isBlocked
              ? blockedChannels.filter((id) => id !== ch.id)
              : [...blockedChannels, ch.id];
            setBlockedChannelIds(updated);
          },
        },
      ],
    );
  }, [blockedChannels, setBlockedChannelIds, nowPlayingMap]);

  const renderChannel = useCallback(({ item }: { item: Channel }) => (
    <ChannelRow
      channel={item}
      isSelected={item.id === selectedChannel?.id}
      isFav={favSet.has(item.id)}
      nowPlaying={nowPlayingMap.get(item.epgId ?? item.id)}
      colors={colors}
      onPress={() => handleSelectChannel(item)}
      onHeartPress={() => handleToggleFav(item)}
      onLongPress={() => handleLongPressChannel(item)}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleToggleFav, handleLongPressChannel]);

  // ── TV remote (Fire TV / Android TV) direct navigation ───────────────────
  // Navigate straight to the fullscreen player — no expand animation needed
  // on a TV where there is no mini-player position to animate from.
  const handleTVWatch = useCallback(() => {
    if (!selectedChannel) return;
    goingToPlayerRef.current = true;
    const chList = channels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
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
        channelId: selectedChannel.id,
        stopOnBack: 'true',
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
      },
    });
  }, [selectedChannel, channels, router]);

  // ── Render ────────────────────────────────────────────────────────────────

  // On Fire TV / Android TV use the 3-panel D-pad layout.
  if (Platform.isTV) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TVLiveLayout
          allCategories={allCategories}
          selectedCatId={selectedCatId}
          onCatSelect={handleSelectCat}
          channels={filteredChannels}
          channelsLoading={channelsLoading}
          epgMap={epgMap}
          nowTs={nowTs}
          selectedChannel={selectedChannel}
          onChannelSelect={handleSelectChannel}
          onWatchFullscreen={handleTVWatch}
          onOpenCatchup={() => setShowCatchup(true)}
          nowPlayingMap={nowPlayingMap}
          colors={colors}
          insets={insets}
          player={player}
          videoKey={videoKey}
          isBuffering={isBuffering}
          hasError={hasError}
        />
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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ══ LEFT: vertical category list ══ */}
      <View style={[styles.catPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          CATEGORIES
        </Text>
        {/* Category search box */}
        <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
          <TextInput
            style={[styles.catSearchInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Search…"
            placeholderTextColor={colors.mutedForeground}
            value={catSearch}
            onChangeText={setCatSearch}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
        <FlatList
          data={filteredCategories}
          keyExtractor={(c) => c.id}
          renderItem={renderCat}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: 52, offset: 52 * i, index: i })}
          contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          removeClippedSubviews={false}
          ListEmptyComponent={
            catSearch.trim() ? (
              <View style={{ padding: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 18, marginBottom: 4 }}>🔍</Text>
                <Text style={{ color: '#888', fontSize: 10, textAlign: 'center' }}>
                  No categories match
                </Text>
              </View>
            ) : null
          }
        />
      </View>

      {/* ══ MIDDLE: channel list ══ */}
      <View style={[styles.chPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        {/* Panel header — shows Edit/Done button when Favourites is active */}
        <View style={[styles.chPanelHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
            {currentCat?.name?.toUpperCase() ?? 'CHANNELS'}
          </Text>
          {/* #22: sync indicator */}
          {isFavsSelected && favSyncState !== 'idle' && (
            <Text style={{ fontSize: 10, color: favSyncState === 'synced' ? '#22C55E' : colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>
              {favSyncState === 'syncing' ? '⟳' : '✓'}
            </Text>
          )}
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

        {/* Channel filter input — hidden during drag-reorder */}
        {!isReordering && (
          <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
            <TextInput
              style={[styles.catSearchInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
              placeholder="Filter channels…"
              placeholderTextColor={colors.mutedForeground}
              value={channelFilter}
              onChangeText={setChannelFilter}
              clearButtonMode="while-editing"
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
          </View>
        )}

        {channelsLoading && !isFavsSelected ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : channels.length === 0 && !isFavsSelected && !channelsLoading ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📡</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No channels</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              No channels found in this category. Try another category or check your provider settings.
            </Text>
          </View>
        ) : filteredChannels.length === 0 && channelFilter.trim().length > 0 ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No channels match</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              No channels found for "{channelFilter.trim()}". Try a different search term.
            </Text>
          </View>
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
            ref={channelListRef}
            data={filteredChannels}
            keyExtractor={(ch) => ch.id}
            renderItem={renderChannel}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                tintColor={colors.primary}
              />
            }
          />
        )}
      </View>

      {/* ══ RIGHT: preview + EPG ══ */}
      <View style={[styles.previewPanel, { paddingTop: insets.top + 4, paddingRight: insets.right + 8 }]}>

        {!isWeb && (
          /* collapsable={false} ensures the native view is created immediately
             so measureInWindow() works correctly for the expand animation.
             focusable lets D-pad / remote users highlight the box and press
             Select to open fullscreen — no separate button needed. */
          <Pressable
            ref={miniPlayerRef as any}
            collapsable={false}
            focusable
            onPress={handleWatch}
            style={({ focused }) => [
              styles.videoWrap,
              !playingChannel && { display: 'none' },
              focused && styles.videoWrapFocused,
            ]}
          >
            {({ focused }: { focused: boolean }) => (
              <>
                <VideoView
                  key={videoKey}
                  player={player}
                  style={StyleSheet.absoluteFill}
                  nativeControls={false}
                  contentFit="contain"
                />
                {/* Flash-prevention overlay — always rendered so setValue(1) takes
                    effect in the same native frame as player.replace(), before
                    the VideoView surface can show a black frame. Fades out once
                    the player signals readyToPlay. */}
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.flashOverlay, { opacity: flashOverlayOpacity }]}
                  pointerEvents="none"
                />
                {(isBuffering && !hasError) && (
                  <View style={styles.videoOverlay}>
                    <ActivityIndicator color="#fff" size="large" />
                  </View>
                )}
                {hasError && (
                  <Pressable
                    style={styles.videoOverlay}
                    onPress={() => {
                      if (!selectedChannel) return;
                      setHasError(false);
                      setIsBuffering(true);
                      try { player.replace(selectedChannel.streamUrl); player.play(); } catch {}
                    }}
                  >
                    <Text style={styles.errText}>Stream unavailable</Text>
                    <Text style={[styles.errText, { fontSize: 11, marginTop: 4, opacity: 0.7 }]}>Tap to retry</Text>
                  </Pressable>
                )}
                {/* Expand hint — bottom-right corner; brightens on D-pad focus */}
                {!isBuffering && !hasError && (
                  <View style={[styles.expandHint, focused && styles.expandHintFocused]}>
                    <Text style={styles.expandHintIcon}>⛶</Text>
                  </View>
                )}
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </>
            )}
          </Pressable>
        )}

        {/* Channel info bar — logo + name + now-playing EPG title below the mini-player */}
        {playingChannel && (
          <View style={[styles.chInfoBar, { borderBottomColor: colors.border }]}>
            <View style={[styles.chInfoLogo, { backgroundColor: colors.secondary }]}>
              {playingChannel.logo ? (
                <Image source={{ uri: playingChannel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              ) : (
                <Text style={[styles.chInfoInitials, { color: colors.primary }]}>
                  {playingChannel.name.slice(0, 2).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.chInfoName, { color: colors.foreground }]} numberOfLines={1}>
                {playingChannel.name}
              </Text>
              {(() => {
                const nowTitle = nowPlayingMap.get(playingChannel.epgId ?? playingChannel.id);
                return nowTitle ? (
                  <Text style={[styles.chInfoNow, { color: colors.primary }]} numberOfLines={1}>
                    ▶ {nowTitle}
                  </Text>
                ) : null;
              })()}
            </View>
          </View>
        )}

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
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
                ref={(ref) => {
                  // Scroll to the currently-airing programme when the EPG data loads
                  if (!ref) return;
                  const nowIdx = channelEpg.findIndex(
                    (p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()
                  );
                  if (nowIdx > 0) {
                    // Each EPG row is approximately 68px tall; scroll past earlier rows
                    setTimeout(() => ref.scrollTo({ y: Math.max(0, (nowIdx - 1) * 68), animated: false }), 80);
                  }
                }}
              >
                {channelEpg.map((prog, i) => {
                  const isCurrent = prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
                  const isFuture = prog.start.getTime() > nowTs;
                  const reminderId = `${selectedChannel!.id}_${prog.start.toISOString()}`;
                  const hasReminder = miniReminderIds.has(reminderId);
                  return (
                    <Pressable
                      key={i}
                      onPress={isFuture ? () => handleToggleMiniReminder(prog) : undefined}
                      style={({ pressed }) => [
                        styles.epgRow,
                        { borderBottomColor: colors.border },
                        isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                        isFuture && pressed && { backgroundColor: 'rgba(255,255,255,0.04)' },
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
                        {isCurrent && (() => {
                          const total = prog.end.getTime() - prog.start.getTime();
                          const elapsed = Math.max(0, nowTs - prog.start.getTime());
                          const pct = Math.min(1, elapsed / total);
                          const minsLeft = Math.max(0, Math.round((prog.end.getTime() - nowTs) / 60_000));
                          return (
                            <View style={styles.epgProgressWrap}>
                              <View style={[styles.epgProgressBar, { width: `${Math.round(pct * 100)}%` as any }]} />
                              <Text style={[styles.epgTimeLeft, { color: colors.mutedForeground }]}>
                                {minsLeft > 0 ? `${minsLeft}m left` : 'ending soon'}
                              </Text>
                            </View>
                          );
                        })()}
                        {prog.description ? (
                          <Text
                            style={[styles.epgDesc, { color: colors.mutedForeground }]}
                            numberOfLines={2}
                          >
                            {prog.description}
                          </Text>
                        ) : null}
                      </View>
                      {isFuture && (
                        <Text style={[styles.epgBell, { color: hasReminder ? '#3B82F6' : colors.mutedForeground }]}>
                          {hasReminder ? '🔔' : '🔕'}
                        </Text>
                      )}
                    </Pressable>
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
      </View>{/* end previewPanel */}

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
  catSearchWrap: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catSearchInput: {
    height: 34,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    includeFontPadding: false,
  } as any,
  catRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    gap: 2,
  },
  catRowText: { fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 16 },
  catCount: { fontSize: 9, fontFamily: 'Inter_400Regular' },

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

  chInfoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 2, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  chInfoLogo: { width: 28, height: 28, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  chInfoInitials: { fontSize: 9, fontFamily: 'Inter_700Bold' },
  chInfoName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chInfoNow: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  videoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  videoWrapFocused: {
    borderColor: '#00E5FF',
  },
  expandHint: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    opacity: 0.7,
  },
  expandHintFocused: {
    backgroundColor: 'rgba(0,229,255,0.25)',
    opacity: 1,
  },
  expandHintIcon: {
    color: '#fff',
    fontSize: 13,
  },
  videoOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Solid black overlay used to hide the black-flash on player.replace().
  // Rendered at opacity 0 normally; snapped to 1 before replace() via
  // Animated.Value.setValue() (synchronous, no React reconciler delay).
  flashOverlay: {
    backgroundColor: '#000',
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
  epgBell: { fontSize: 14, flexShrink: 0, alignSelf: 'center', marginLeft: 4 },
  epgEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },
  epgProgressWrap: { marginTop: 3, marginBottom: 2, height: 3, borderRadius: 2, backgroundColor: 'rgba(59,130,246,0.15)', overflow: 'hidden' as const },
  epgProgressBar: { height: 3, borderRadius: 2, backgroundColor: '#3B82F6' },
  epgTimeLeft: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 2 },

  noSel: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  noSelTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  noSelSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
