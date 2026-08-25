import { FocusablePressable } from '@/components/FocusablePressable';
import { TVTextInput } from '@/components/TVTextInput';
import { ConfirmModal } from '@/components/ConfirmModal';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBackHandler } from '@/hooks/useBackHandler';
import {
  ActivityIndicator,
  Easing,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  DeviceEventEmitter,
  findNodeHandle,
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
  useWindowDimensions,
} from 'react-native';
import {
  scheduleReminderNotification,
  cancelReminderNotification,
} from '@/services/notifications';
import { DraggableFavList } from '@/components/DraggableFavList';
import { useLivePlayer } from '@/context/LivePlayerContext';
import { NativeStreamPlayer } from '@/components/NativeStreamPlayer';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  getXtreamCatchupUrls,
} from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { fetchAndParseXmltv } from '@/services/epgService';
import { CatchupSheet } from '@/components/CatchupSheet';
import { TVLiveLayout } from '@/components/TVLiveLayout';
import type { Channel, Category, EpgProgram, FavoriteChannel } from '@/types';
import { normaliseStr } from '@/utils/normalise';
import { requestTvFocus } from '@/lib/tvFocus';
import { sidebarNav } from '@/lib/sidebarNav';
import {
  consumePendingLivePlayerReturn,
  getPendingLivePlayerReturn,
  setPendingLivePlayerReturn,
} from '@/lib/livePlayerHandoff';

const FAVS_CAT_ID = '__favs';
const ALL_CAT_ID = '__all';
const USES_NATIVE_VLC = Platform.OS === 'android';
const VLC_TRACE = '[SV-VLC-TRACE]';

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
      onPress={() => {
        // TV: pressing OK on the already-selected category triggers the block/
        // unblock flow (same as long-press on touch) — gives a reliable D-pad path.
        if (Platform.isTV && isSelected && onLongPress) {
          onLongPress();
        } else {
          onPress();
        }
      }}
      // On TV the double-tap OK pattern handles block; keep long-press for touch.
      onLongPress={Platform.isTV ? undefined : onLongPress}
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
  onTvBlockPress,
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
  /** TV-only: opens the block/unblock confirm modal for this channel. */
  onTvBlockPress?: () => void;
  hideHeart?: boolean;
}) {
  // TV D-pad: wire row ↔ heart ↔ block so D-pad RIGHT advances through zones
  // and D-pad LEFT goes back.  Three zones when onTvBlockPress is provided,
  // otherwise two.
  const rowRef   = useRef<View>(null);
  const heartRef = useRef<View>(null);
  const blockRef = useRef<View>(null);

  useEffect(() => {
    if (!Platform.isTV || hideHeart) return;
    const t = setTimeout(() => {
      const rowH   = findNodeHandle(rowRef.current);
      const heartH = findNodeHandle(heartRef.current);
      const blockH = onTvBlockPress ? findNodeHandle(blockRef.current) : null;
      if (!rowH || !heartH) return;
      if (blockH) {
        (rowRef.current   as any)?.setNativeProps({ nextFocusRight: heartH });
        (heartRef.current as any)?.setNativeProps({ nextFocusLeft: rowH, nextFocusRight: blockH });
        (blockRef.current as any)?.setNativeProps({ nextFocusLeft: heartH });
      } else {
        (rowRef.current   as any)?.setNativeProps({ nextFocusRight: heartH });
        (heartRef.current as any)?.setNativeProps({ nextFocusLeft: rowH });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [hideHeart, onTvBlockPress]);

  return (
    <FocusablePressable
      ref={rowRef}
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
          ref={heartRef}
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
      {/* TV: D-pad-reachable ⊘ block button — third zone after the heart.
          The long-press menu is not reliably triggerable on Fire OS, so this
          provides a reliable path to block / unblock any channel. */}
      {Platform.isTV && !hideHeart && onTvBlockPress && (
        <FocusablePressable
          ref={blockRef}
          focusable
          onPress={onTvBlockPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          focusedStyle={styles.tvFocusedRound}
          style={styles.heartBtn}
        >
          <Text style={[styles.heartIcon, { color: '#EF4444', opacity: 0.7 }]}>⊘</Text>
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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { credentials, lastWatchedUrl, deviceMac } = useAppContext();
  const { blockedChannels, blockedCategoryIds, setBlockedChannelIds, toggleBlockedCategory, pruneBlockedCategories, pruneBlockedChannelIds } = useParentalContext();
  const isWeb = Platform.OS === 'web';

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;
  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  // All Channels is the explicit Fire TV landing state when the viewer presses
  // OK on Live TV in the sidebar. Favourites remains available as the next
  // category, but never steals the first remote focus.
  const [selectedCatId, setSelectedCatId] = useState<string>(ALL_CAT_ID);
  const skipStoredCategoryRestoreRef = useRef(false);
  // Filled by TVLiveLayout so the sidebar entry event can synchronously clear
  // remembered channel focus before this tab regains navigation focus.
  const tvLiveEntryResetRef = useRef<(() => void) | null>(null);
  // Persist and restore the last-selected category so the user lands where
  // they left off.  useFocusEffect (not useEffect[]) so that when the player
  // navigates back here after a recently-watched channel it re-reads the pref
  // that the player wrote (groupTitle → @pref_live_cat) before navigating.
  useFocusEffect(useCallback(() => {
    if (Platform.isTV && skipStoredCategoryRestoreRef.current) {
      skipStoredCategoryRestoreRef.current = false;
      return;
    }
    StorageService.getPrefLiveCat().then((v) => { if (v) setSelectedCatId(v); });
  }, []));
  const [catSearch, setCatSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [playingChannel, setPlayingChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [isBuffering, setIsBuffering] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Forces a fresh VLC instance for an explicit retry of the same URL.
  const [vlcReloadKey, setVlcReloadKey] = useState(0);
  // The Live TV route stays mounted below the fullscreen route. Keep a single
  // VLC owner by unmounting its preview renderer whenever this route blurs.
  const [isLivePreviewActive, setIsLivePreviewActive] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now());

  // The sidebar emits this immediately before it navigates to the Live TV tab.
  // Selecting All Channels and clearing the focus memory are separate: the
  // former starts the correct list query, while the latter prevents
  // useFocusRestore from returning the cursor to an old channel row.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('live:open-all', () => {
      skipStoredCategoryRestoreRef.current = true;
      tvLiveEntryResetRef.current?.();
      setSelectedCatId(ALL_CAT_ID);
    });
    return () => sub.remove();
  }, []);

  // ── TV block/unblock confirm modal ───────────────────────────────────────
  // Alert.alert buttons are not reliably D-pad-focusable on Fire OS; we use
  // ConfirmModal instead for both category and channel block actions on TV.
  const [blockConfirm, setBlockConfirm] = useState<
    | { type: 'cat'; catId: string; name: string; isBlocked: boolean }
    | { type: 'chan'; channel: Channel; isBlocked: boolean }
    | null
  >(null);

  // ── Catch-up sheet ───────────────────────────────────────────────────────
  const [showCatchup, setShowCatchup] = useState(false);
  // When opened from the mini TV guide, holds the programme to deep-link to.
  const [catchupInitialProg, setCatchupInitialProg] = useState<EpgProgram | null>(null);
  // The live stream to resume after the user leaves full-screen Catch-up.
  // Catch-up replaces the shared player source, so this must survive the
  // temporary player route rather than relying on its last watched URL.
  const catchupPreviewReturnRef = useRef<Channel | null>(null);

  // ── Reorder mode ─────────────────────────────────────────────────────────
  const [isReordering, setIsReordering] = useState(false);
  // Working copy used while the edit session is open
  const [reorderedFavs, setReorderedFavs] = useState<FavoriteChannel[]>([]);

  // ── Favourites sync state (#22) ──────────────────────────────────────────
  const [favSyncState, setFavSyncState] = useState<'idle' | 'syncing' | 'synced'>('idle');
  // Tracks D-pad focus on the mini-player so the expand hint can brighten
  const [miniPlayerFocused, setMiniPlayerFocused] = useState(false);

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
  const {
    player,
    activeUrlRef: liveUrlRef,
    miniPlayerRef,
    nativeSurfaceMode,
    nativeSurfaceUrl,
    setNativeSurfaceUrl,
    beginNativeSurfaceHandoff,
    commitNativeSurfaceLayout,
    transitionNativeSurface,
    triggerExpand,
    triggerExpandFromRef,
  } = useLivePlayer();

  // Android owns one VLC TextureView in a stable direct child of this Live TV
  // root. The focusable mini control remains a real control, but only provides
  // the measured mini viewport; it never reparents or unmounts the native view.
  const nativeSurfaceFullscreen = nativeSurfaceMode === 'fullscreen';
  const nativeSurfaceRootRef = useRef<View>(null);
  const nativeSurfaceModeRef = useRef(nativeSurfaceMode);
  const previousNativeSurfaceModeRef = useRef(nativeSurfaceMode);
  const nativePreviewPanelBoundsRef = useRef({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  });
  const nativeMiniOwnerLayoutRef = useRef({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  });
  // A fullscreen handoff must wait for the Live TV root to report the actual
  // Android content viewport after the tab shell has released its sidebar.
  // This rejects old mini/sidebar layout events that can arrive late and
  // otherwise shrink the already-expanded native frame back to preview width.
  const nativeFullscreenViewportRef = useRef<{ width: number; height: number } | null>(null);
  const [nativeOwnerBounds, setNativeOwnerBounds] = useState({
    width: 0,
    height: 0,
    x: 0,
    y: 0,
  });
  const [nativeSurfaceViewport, setNativeSurfaceViewport] = useState({
    width: 0,
    height: 0,
  });

  // Layout events are already delivered after React Native has committed the
  // relevant view. Combine the direct-child preview panel with its mini-player
  // child's local frame instead of asking Android to resolve a relative native
  // measurement while that first child is being attached. The latter is the
  // race that made the first selected channel invisible until a fullscreen trip.
  const publishNativeMiniOwnerBounds = useCallback(() => {
    if (!USES_NATIVE_VLC || nativeSurfaceModeRef.current !== 'mini') return;
    const panel = nativePreviewPanelBoundsRef.current;
    const owner = nativeMiniOwnerLayoutRef.current;
    if (
      panel.width <= 0
      || panel.height <= 0
      || owner.width <= 0
      || owner.height <= 0
    ) return;

    const next = {
      x: panel.x + owner.x,
      y: panel.y + owner.y,
      width: owner.width,
      height: owner.height,
    };
    setNativeOwnerBounds((current) => (
      current.x === next.x
      && current.y === next.y
      && current.width === next.width
      && current.height === next.height
        ? current
        : next
    ));
  }, []);

  const handleNativeRootLayout = useCallback((event: any) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const isExpectedFullscreenViewport =
      Math.round(width) === Math.round(screenWidth)
      && Math.round(height) === Math.round(screenHeight);
    if (
      nativeSurfaceModeRef.current === 'fullscreen'
      && !isExpectedFullscreenViewport
    ) {
      console.log(VLC_TRACE, 'surface-root-layout-ignored-before-fullscreen-viewport', {
        width,
        height,
        expectedWidth: screenWidth,
        expectedHeight: screenHeight,
      });
      return;
    }
    setNativeSurfaceViewport((current) => (
      current.width === width && current.height === height
        ? current
        : { width, height }
    ));
    if (nativeSurfaceModeRef.current === 'fullscreen') {
      nativeFullscreenViewportRef.current = { width, height };
    }
    publishNativeMiniOwnerBounds();
  }, [publishNativeMiniOwnerBounds, screenHeight, screenWidth]);

  const handleNativePreviewPanelLayout = useCallback((event: any) => {
    nativePreviewPanelBoundsRef.current = event.nativeEvent.layout;
    publishNativeMiniOwnerBounds();
  }, [publishNativeMiniOwnerBounds]);

  const handleNativeMiniOwnerLayout = useCallback((event: any) => {
    const layout = event.nativeEvent.layout;
    nativeMiniOwnerLayoutRef.current = layout;

    // Android can deliver the child layout before its preview parent layout on
    // the first channel selection. Expose the persistent VLC surface from the
    // child bounds immediately; the parent-relative measurement below replaces
    // this provisional frame as soon as it is available.
    if (layout.width > 0 && layout.height > 0) {
      const panel = nativePreviewPanelBoundsRef.current;
      const next = {
        x: panel.width > 0 ? panel.x + layout.x : layout.x,
        y: panel.height > 0 ? panel.y + layout.y : layout.y,
        width: layout.width,
        height: layout.height,
      };
      setNativeOwnerBounds((current) => (
        current.x === next.x
        && current.y === next.y
        && current.width === next.width
        && current.height === next.height
          ? current
          : next
      ));
    }
    publishNativeMiniOwnerBounds();
  }, [publishNativeMiniOwnerBounds]);

  // Android can report the first mini-player layout before the native hierarchy
  // has a stable relative parent. Also measure the actual window coordinates a
  // few frames after the first channel selection so the persistent VLC surface
  // gets a real mini-player frame without requiring a fullscreen round-trip.
  const measureNativeMiniOwnerInWindow = useCallback(() => {
    if (!USES_NATIVE_VLC || nativeSurfaceModeRef.current !== 'mini') return;
    const owner = miniPlayerRef.current;
    const root = nativeSurfaceRootRef.current;
    if (!owner || !root || !playingChannel) return;

    owner.measureInWindow((ownerX, ownerY, width, height) => {
      if (width <= 0 || height <= 0) return;
      root.measureInWindow((rootX, rootY) => {
        const next = {
          x: Math.max(0, ownerX - rootX),
          y: Math.max(0, ownerY - rootY),
          width,
          height,
        };
        setNativeOwnerBounds((current) => (
          current.x === next.x
          && current.y === next.y
          && current.width === next.width
          && current.height === next.height
            ? current
            : next
        ));
      });
    });
  }, [miniPlayerRef, nativeSurfaceMode, playingChannel?.id]);

  useEffect(() => {
    if (!USES_NATIVE_VLC || nativeSurfaceMode !== 'mini' || !playingChannel) return;
    const timers = [0, 16, 64, 200, 400].map((delay) =>
      setTimeout(measureNativeMiniOwnerInWindow, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [measureNativeMiniOwnerInWindow, nativeSurfaceMode, playingChannel?.id]);

  // Fullscreen must use the actual Android window dimensions rather than any
  // previously measured preview/root dimensions. This prevents the native VLC
  // frame from snapping back to the old 16:9 mini-player width after entering
  // fullscreen.
  useEffect(() => {
    if (!USES_NATIVE_VLC || !nativeSurfaceFullscreen) return;
    setNativeSurfaceViewport((current) => (
      current.width === screenWidth && current.height === screenHeight
        ? current
        : { width: screenWidth, height: screenHeight }
    ));
    nativeFullscreenViewportRef.current = { width: screenWidth, height: screenHeight };
  }, [nativeSurfaceFullscreen, screenHeight, screenWidth]);

  if (previousNativeSurfaceModeRef.current !== nativeSurfaceMode) {
    previousNativeSurfaceModeRef.current = nativeSurfaceMode;
    if (nativeSurfaceMode === 'fullscreen') {
      nativeFullscreenViewportRef.current = null;
    }
  }
  nativeSurfaceModeRef.current = nativeSurfaceMode;

  // Returning from fullscreen can reuse the already-committed mini frame. No
  // timer or measurement retry is needed, and no VLC playback prop is touched.
  useEffect(() => {
    if (nativeSurfaceMode === 'mini') publishNativeMiniOwnerBounds();
  }, [nativeSurfaceMode, publishNativeMiniOwnerBounds]);

  const activeNativeSurfaceUrl = nativeSurfaceUrl
    || playingChannel?.streamUrl
    || selectedChannel?.streamUrl
    || '';

  // Keep a device-side record of the *actual* React Native content window and
  // owner bounds. This is deliberately diagnostic only: the TextureView remains
  // an ordinary absolute-fill child, with no measured-coordinate reparenting or
  // transforms. It lets phone and TV traces distinguish an inset/window problem
  // from a decoder or surface-lifecycle problem.
  useEffect(() => {
    if (!USES_NATIVE_VLC) return;
    console.log(VLC_TRACE, 'react-window-bounds', {
      width: screenWidth,
      height: screenHeight,
      insetTop: insets.top,
      insetRight: insets.right,
      insetBottom: insets.bottom,
      insetLeft: insets.left,
      fullscreen: nativeSurfaceFullscreen,
    });
  }, [
    insets.bottom,
    insets.left,
    insets.right,
    insets.top,
    nativeSurfaceFullscreen,
    screenHeight,
    screenWidth,
  ]);

  useEffect(() => {
    if (!USES_NATIVE_VLC) return;
    setNativeSurfaceUrl(playingChannel?.streamUrl ?? selectedChannel?.streamUrl ?? '');
  }, [playingChannel?.streamUrl, selectedChannel?.streamUrl, setNativeSurfaceUrl]);


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
  // These callbacks are intentionally stable so the memoized Android VLC
  // surface receives no prop update when nativeSurfaceMode changes. A
  // mini/fullscreen transition must adjust only its parent's bounds — never
  // reapply a source, volume, mute, pause, or seek value to libVLC.
  const handlePersistentVlcPlaying = useCallback(() => {
    setIsBuffering(false);
    setHasError(false);
    Animated.timing(flashOverlayOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [flashOverlayOpacity]);
  const handlePersistentVlcBuffering = useCallback(() => {
    setIsBuffering(true);
  }, []);
  const handlePersistentVlcError = useCallback(() => {
    setIsBuffering(false);
    setHasError(true);
    Animated.timing(flashOverlayOpacity, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [flashOverlayOpacity]);
  const isFirstFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (isFirstFocusRef.current) {
      isFirstFocusRef.current = false;
      // If a recently-watched channel is pending (user pressed BACK from the
      // player before ever visiting the Live TV tab), we must NOT skip — fall
      // through to the shared return handoff below to set selectedChannel.
      // For all other first-focus cases, return as before.
      if (!getPendingLivePlayerReturn()) return;
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
    const returnedChannel = consumePendingLivePlayerReturn();
    if (returnedChannel) {
      // The route hands back the active channel before it closes. The Android
      // VLC child is still mounted; only its container returns to mini layout.
      setIsBuffering(false);
      setPlayingChannel(returnedChannel);
      setSelectedChannel(returnedChannel);
      if (returnedChannel.groupTitle) {
        setSelectedCatId(returnedChannel.groupTitle);
        StorageService.setPrefLiveCat(returnedChannel.groupTitle).catch(() => {});
      }
      requestAnimationFrame(() => {
        if (!USES_NATIVE_VLC) setVideoKey((key) => key + 1);
        if (Platform.isTV) {
          setTimeout(() => {
            if (!focusPlayingChannelRef.current?.()) {
              requestTvFocus(miniPlayerRef.current);
            }
          }, 400);
        }
      });
      return;
    }
      const catchupPreviewToRestore = catchupPreviewReturnRef.current;
      if (catchupPreviewToRestore) {
        // Catch-up opens in the shared full-screen player and therefore
        // replaces the live stream source. Return to the pre-existing live
        // preview rather than leaving the TV panel empty or showing catch-up
        // audio/video in the small player.
        catchupPreviewReturnRef.current = null;
        setSelectedChannel(catchupPreviewToRestore);
        setPlayingChannel(catchupPreviewToRestore);
        setIsBuffering(true);
        setHasError(false);
        flashOverlayOpacity.setValue(1);
        if (USES_NATIVE_VLC) {
          liveUrlRef.current = catchupPreviewToRestore.streamUrl;
          setVlcReloadKey((key) => key + 1);
        } else try {
          liveUrlRef.current = catchupPreviewToRestore.streamUrl;
          player.replace(catchupPreviewToRestore.streamUrl);
          player.play();
        } catch {
          setHasError(true);
          setIsBuffering(false);
          Animated.timing(flashOverlayOpacity, {
            toValue: 0, duration: 150, useNativeDriver: true,
          }).start();
        }
        // Re-bind the shared player to the returning mini-player surface.
        if (!USES_NATIVE_VLC) {
          requestAnimationFrame(() => setVideoKey((key) => key + 1));
        }
        return;
      }
    if (USES_NATIVE_VLC) {
      // The fullscreen route restores this container before it closes. This is
      // only a safety net for interrupted navigation, never a native resize.
      // Changing nativeSurfaceMode to "fullscreen" re-runs this focus callback
      // while the transparent controls route is opening. Do not immediately
      // undo that parent-layout handoff; player.tsx is responsible for changing
      // it back to mini just before BACK removes the controls route.
      if (nativeSurfaceMode !== 'mini' && !goingToPlayerRef.current) {
        transitionNativeSurface('mini');
      }
      return;
    }
    // Normal focus return (tab switch, etc.) — show flash overlay to cover the
    // single-frame black while the VideoView remounts and re-binds the surface.
    flashOverlayOpacity.setValue(1);
    setVideoKey((k) => k + 1);
    // Safety-net: ExoPlayer stays in STATE_READY when re-attaching to a new
    // TextureView surface on Android, so the statusChange→readyToPlay event
    // never re-fires and the flash overlay would stay at opacity 1 permanently
    // — audio plays but the video is hidden behind the dark overlay.
    // If readyToPlay fires first (e.g. player.replace() is called by the live-
    // edge reload logic), it wins and cancels this timer.  If it doesn't fire
    // within 2 s, this fallback clears the overlay so the user can see video.
    const overlayFallback = setTimeout(() => {
      Animated.timing(flashOverlayOpacity, {
        toValue: 0, duration: 300, useNativeDriver: true,
      }).start();
    }, 2000);
    return () => clearTimeout(overlayFallback);
  }, [flashOverlayOpacity, nativeSurfaceMode, transitionNativeSurface]));

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
    // Android/Fire TV renders IPTV with VLC. Do not load the same source into
    // Expo's ExoPlayer as well: competing decoders can steal audio focus and
    // leave one of the native surfaces black.
    if (USES_NATIVE_VLC) {
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      liveUrlRef.current = url;
      setIsBuffering(true);
      setHasError(false);
      return;
    }

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
    if (isWeb || USES_NATIVE_VLC || !player) return;
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
  // Set by the fullscreen player only after its persistent VLC surface has
  // completed the shrink animation. Keeping this separate from the player
  // prevents a D-pad focus request from becoming part of the native playback
  // transition or from targeting the non-focusable VLC surface itself.
  const restorePreviewFocusOnReturnRef = useRef(false);
  // When a recently-watched channel is opened from the Home screen the Live TV
  // tab's playingChannel is never set (the channel was launched directly into
  // the player, bypassing this tab).  The player emits this event before its
  // fullscreen return so the mini-player is visible before the route closes.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('live:setPlayingChannel', (ch: Channel) => {
      // Set state immediately so the container is ready when fullscreen closes.
      setPlayingChannel(ch);
      // Also write to the shared handoff so it survives a direct Home → player
      // → Live TV return where this tab did not exist when the event fired.
      setPendingLivePlayerReturn(ch);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('live:restore-preview-focus', () => {
      if (Platform.isTV) restorePreviewFocusOnReturnRef.current = true;
    });
    return () => sub.remove();
  }, []);
  // Firestick focus is restored after (not during) the transparent fullscreen
  // route's removal. The first request runs after the navigator commits focus;
  // one short retry covers older Fire OS builds where the first request can race
  // native focus reassignment. Both target the stable mini-player Pressable,
  // never the VLC playback surface.
  useFocusEffect(
    useCallback(() => {
      if (!Platform.isTV || !restorePreviewFocusOnReturnRef.current) return;
      restorePreviewFocusOnReturnRef.current = false;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const frame = requestAnimationFrame(() => {
        requestTvFocus(miniPlayerRef.current);
        retry = setTimeout(() => requestTvFocus(miniPlayerRef.current), 180);
      });
      return () => {
        cancelAnimationFrame(frame);
        if (retry) clearTimeout(retry);
      };
    }, [miniPlayerRef]),
  );
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

  // When fullscreen changes channel, use the exact identity that switched rather
  // than resolving by URL alone. Providers can reuse URLs or refresh the list
  // while fullscreen is open; in either case URL-only matching can make the
  // mini-player label/EPG describe a different stream.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('channel:switched', ({
      url,
      channel,
    }: {
      url: string;
      channel?: Channel;
    }) => {
      const catalogChannel = channel?.id
        ? channelsRef.current.find((candidate) => candidate.id === channel.id)
        : channelsRef.current.find((candidate) => candidate.streamUrl === url);
      const activeChannel = catalogChannel
        ? {
            ...catalogChannel,
            ...channel,
            // Menu entries do not carry a category; retain it from the latest
            // Live TV catalogue so a later BACK opens the right category.
            groupTitle: channel?.groupTitle || catalogChannel.groupTitle,
          }
        : channel;

      if (activeChannel) {
        setSelectedChannel(activeChannel);
        setPlayingChannel(activeChannel);
      }
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLivePreviewActive(true);
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
            if (USES_NATIVE_VLC) {
              setVlcReloadKey((key) => key + 1);
            } else try {
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
          } else if (!USES_NATIVE_VLC) {
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
        // This runs before the fullscreen route renders its VLC surface.
        // Unmounting the mini renderer here prevents two independent VLC
        // decoders from opening the same IPTV URL during route transitions.
        // Android keeps its one VLC view mounted while the fullscreen route is
        // open. The route renders a transparent controls layer above it.
        if (!USES_NATIVE_VLC) setIsLivePreviewActive(false);
        if (goingToPlayerRef.current) {
          goingToPlayerRef.current = false;
          // Null out tabBlurredAtRef so returning from the fullscreen player
          // never triggers the "stale tab" live-edge reload.  VLC was streaming
          // the whole time — a reconnect is neither necessary nor wanted.
          tabBlurredAtRef.current = null;
          return;
        }
        // Record when the tab was blurred so we can decide on return whether
        // the preview is stale enough to warrant a live-edge reload.
        if (USES_NATIVE_VLC) {
          transitionNativeSurface('hidden');
          setIsLivePreviewActive(false);
        }
        tabBlurredAtRef.current = Date.now();
        if (!isWeb && !USES_NATIVE_VLC && player) {
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
      { id: ALL_CAT_ID, name: 'All Channels' },
      { id: FAVS_CAT_ID, name: '♥ Favourites' },
      ...rawCategories,
    ],
    [rawCategories],
  );

  // Clear channel filter whenever the user switches category
  useEffect(() => { setChannelFilter(''); }, [selectedCatId]);

  // TV only — preview-panel controls return BACK to the playing channel rather
  // than clearing the preview. Each row reports its native focus independently.
  const previewFocusedRef = useRef(false);
  const catchupFocusedRef = useRef(false);
  const guideFocusedRef = useRef(false);
  const categoryFocusedRef = useRef(false);
  const highlightedChNodeRef = useRef<View | null>(null);
  const focusHighlightedChCategoryRef = useRef<(() => boolean) | null>(null);
  const focusPlayingChannelRef = useRef<(() => boolean) | null>(null);

  const handleExitToSidebar = useCallback(() => {
    categoryFocusedRef.current = false;
  }, []);

  // Hardware BACK: pop through active states one level at a time.
  // useBackHandler (via useFocusEffect) ensures this is only active while Live TV is focused —
  // fixing the previous plain-useEffect bug that registered the handler on every tab.
  useBackHandler(() => {
    if (isReordering) { setIsReordering(false); return true; }
    if (showCatchup) { setShowCatchup(false); return true; }
    if (channelFilter.trim()) { setChannelFilter(''); Keyboard.dismiss(); return true; }
    if (catSearch.trim()) { setCatSearch(''); return true; }
    // TV: BACK from the preview, Catch-up, or mini-guide returns to the
    // currently playing channel — never just the last highlighted row.
    if (
      Platform.isTV
      && (previewFocusedRef.current || catchupFocusedRef.current || guideFocusedRef.current)
      && focusPlayingChannelRef.current?.()
    ) {
      return true;
    }
    // Category is the leftmost Live TV panel: BACK returns to the active
    // Live TV sidebar item while keeping the current mini-preview playing.
    if (Platform.isTV && categoryFocusedRef.current) {
      handleExitToSidebar();
      sidebarNav.focus();
      return true;
    }
    // Channel BACK returns to the category which contains that channel. Keep
    // the preview playing so browsing does not interrupt the stream.
    if (
      Platform.isTV
      && highlightedChNodeRef.current
      && focusHighlightedChCategoryRef.current?.()
    ) {
      return true;
    }
    if (selectedChannel) { setPlayingChannel(null); setSelectedChannel(null); return true; }
    return false; // let global handler focus the sidebar
  });

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

  // M3U always downloads the complete playlist regardless of which category is
  // selected — the per-category key caused a fresh network round-trip on every
  // category switch because each entry was a distinct cache slot.  Using the
  // shared ['live-channels-all'] key fetches once and filters client-side via
  // `select`, matching the key used by LiveChannelMenu and blocked-channels so
  // all three screens share a single cached payload with no duplicate requests.
  //
  // Xtream supports server-side category filtering so its per-category key is
  // kept — each category may genuinely differ in what the provider returns.
  //
  // refetchOnWindowFocus/Mount: false — staleTime handles freshness; focus
  // events on Firestick must not trigger provider API calls mid-zap.
  const isXtreamProvider = credentials?.type === 'xtream';

  const selectChannelsByCategory = useCallback(
    (data: Channel[]) =>
      selectedCatId === ALL_CAT_ID
        ? data
        : data.filter((c) => c.groupTitle === selectedCatId),
    [selectedCatId],
  );

  const { data: fetchedChannels = [], isLoading: channelsLoading, isRefetching, refetch } = useQuery<Channel[], Error, Channel[]>({
    queryKey: isXtreamProvider
      ? ['live-channels', selectedCatId, credentials]
      : ['live-channels-all', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (isXtreamProvider) {
        const catId = selectedCatId === ALL_CAT_ID ? undefined : selectedCatId;
        return getXtreamLiveStreams(buildCreds(credentials), catId);
      }
      if (credentials.m3uUrl) {
        const { channels: all } = await fetchAndParseM3U(credentials.m3uUrl);
        return all; // return all — category filtering is done by `select` below
      }
      return [];
    },
    select: isXtreamProvider ? undefined : selectChannelsByCategory,
    enabled: !!credentials && !isFavsSelected,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount:       false,
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

  // #11: prune orphaned blocked-channel IDs whenever the live channel list loads
  useEffect(() => {
    if (fetchedChannels.length === 0) return;
    pruneBlockedChannelIds(fetchedChannels.map((c) => c.id));
  }, [fetchedChannels, pruneBlockedChannelIds]);

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
    const list = q
      ? channels.filter((ch) => normaliseStr(ch.name).includes(q))
      : channels;
    const hasNums = list.some((ch) => ch.num != null);
    return hasNums ? [...list].sort((a, b) => (a.num ?? 0) - (b.num ?? 0)) : list;
  }, [channels, channelFilter]);

  // Scroll back to top whenever the filter changes so the first match is visible
  useEffect(() => {
    if (channelFilter.trim()) {
      channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [channelFilter, filteredChannels]);

  // Scroll the channel list to the playing channel when it is set from outside
  // (e.g. returning from recently-watched on the Home screen).  Also depends on
  // filteredChannels so it re-runs after the category switch populates the list.
  // TV layout handles its own scroll inside TVLiveLayout.
  useEffect(() => {
    if (Platform.isTV || !selectedChannel) return;
    const index = filteredChannels.findIndex((c) => c.id === selectedChannel.id);
    if (index < 0) return;
    try {
      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    } catch (_) {}
  }, [selectedChannel?.id, filteredChannels]);

  const queryClient = useQueryClient();
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => {
      const previous = queryClient.getQueryData<Map<string, EpgProgram[]>>(['xmltv-epg', credentials]);
      return fetchAndParseXmltv(xmltvUrl!, signal, previous);
    },
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

  // Current programme for the playing channel in the mini-player.
  // Uses playingChannel (not selectedChannel) so the info bar stays correct
  // when the user browses other channels after the mini-player is already open.
  const miniPlayerProg = useMemo(() => {
    if (!playingChannel || !epgMap) return null;
    const progs = epgMap.get(playingChannel.epgId ?? playingChannel.id) ?? [];
    return progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
  }, [playingChannel, epgMap, nowTs]);

  // ── Mini-guide reminder state ─────────────────────────────────────────────
  const [miniReminderIds, setMiniReminderIds] = useState<Set<string>>(new Set());
  // #249: track which EPG future row currently has D-pad focus so the bell icon
  // brightens alongside the cyan focus ring (TV only; no-op on touch).
  const [focusedProgIdx, setFocusedProgIdx] = useState<number | null>(null);

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
    StorageService.setPrefLiveCat(catId).catch(() => {});
    Haptics.selectionAsync();
    setSelectedCatId(catId);
    // Phone/tablet keeps its existing category-selection behavior. TV browsing
    // preserves the active mini-preview until the viewer explicitly picks a
    // different channel or navigates to another sidebar destination.
    if (!Platform.isTV) setSelectedChannel(null);
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
    // The highlighted row can change while the mini-player continues showing a
    // different channel. Fullscreen is a presentation change for the active
    // decoder, so it must always follow the channel already playing.
    const activeChannel = playingChannel ?? selectedChannel;
    if (!activeChannel) return;
    goingToPlayerRef.current = true;
    // Shared player keeps streaming — no pause needed before going fullscreen.

    // Sort by channel number when the provider assigns them so that D-pad
    // LEFT/RIGHT and Ch Up/Down follow the numeric order the viewer expects.
    // When no channels have numbers the existing provider order is preserved.
    const hasNums = channels.some((ch) => ch.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
      num: ch.num,
      groupTitle: ch.groupTitle,
      tvArchive: ch.tvArchive,
      tvArchiveDuration: ch.tvArchiveDuration,
    }));
    // Index must be from the sorted list, not the original array.
    const idx = chList.findIndex((c) => c.channelId === activeChannel.id);
    let nativeSurfaceHandoffId: string | undefined;

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: activeChannel.streamUrl,
        title: activeChannel.name,
        type: 'live',
        logo: activeChannel.logo ?? '',
        epgId: activeChannel.epgId ?? activeChannel.id,
        channelId: activeChannel.id,
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });

    // Android/Fire TV keeps the mini-player's VLC view mounted and grows that
    // exact native surface before showing the fullscreen controls route.
    if (USES_NATIVE_VLC) {
      // Do not rely on the selected-channel effect to publish this value: a
      // remote press can enter fullscreen before that effect has committed.
      // The controls route uses this as its proof that the mini-player already
      // owns the live decoder, so it must be set in the same update as the
      // surface-mode transition.
      setNativeSurfaceUrl(activeChannel.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(activeChannel.streamUrl);
      transitionNativeSurface('fullscreen', navigate);
    } else {
      triggerExpand(navigate);
    }
  }, [selectedChannel, playingChannel, channels, player, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface, triggerExpand]);

  // The persistent Android VLC TextureView is elevated above the original
  // preview card so it can animate outside clipped panels. Keep one shared
  // press handler for the card and the transparent mobile relay above that
  // native texture; otherwise the TextureView can swallow a touch before the
  // card's onPress receives it.
  const handleMiniPlayerPress = useCallback(() => {
    if (hasError && selectedChannel) {
      setHasError(false);
      setIsBuffering(true);
      if (USES_NATIVE_VLC) {
        setVlcReloadKey((key) => key + 1);
      } else {
        try {
          player.replace(selectedChannel.streamUrl);
          player.play();
        } catch {}
      }
      return;
    }
    handleWatch();
  }, [hasError, selectedChannel, player, handleWatch]);

  /** Navigate directly to the fullscreen player from a recently-watched card.
   *  Behaves identically to handleWatch (TV menu): back collapses to mini-player,
   *  full channel list is passed for prev/next navigation. */
  const handleWatchChannel = useCallback((ch: Channel, cardRef?: React.RefObject<View | null>) => {
    goingToPlayerRef.current = true;
    // Update the right-panel EPG and make the persistent playback container
    // visible before the fullscreen controls route borrows it.
    setSelectedChannel(ch);
    setPlayingChannel(ch);

    const hasNums = channels.some((c) => c.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((c) => ({
      url: c.streamUrl,
      title: c.name,
      epgId: c.epgId ?? c.id,
      logo: c.logo ?? '',
      channelId: c.id,
      num: c.num,
      groupTitle: c.groupTitle,
      tvArchive: c.tvArchive,
      tvArchiveDuration: c.tvArchiveDuration,
    }));
    const idx = chList.findIndex((c) => c.channelId === ch.id);
    let nativeSurfaceHandoffId: string | undefined;

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        channelId: ch.id,
        // Pass full channel list for prev/next navigation, same as the TV menu.
        // No stopOnBack — BACK collapses to mini-player just like a normal watch.
        channelsJson: idx >= 0 ? JSON.stringify(chList) : '[]',
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });

    // The VLC path expands the real playback container, never the tapped card.
    // The generic Expo-video route keeps its existing navigation hooks.
    if (USES_NATIVE_VLC) {
      // The Live TV mini-player becomes visible on this render. Give it one
      // layout pass before measuring and expanding its persistent VLC surface.
      setNativeSurfaceUrl(ch.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(ch.streamUrl);
      requestAnimationFrame(() => transitionNativeSurface('fullscreen', navigate));
    } else if (cardRef) {
      triggerExpandFromRef(cardRef, navigate);
    } else {
      triggerExpand(navigate);
    }
  }, [channels, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface, triggerExpandFromRef, triggerExpand]);

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
          if (Platform.isTV) {
            // TV: show ConfirmModal (Alert.alert buttons unreliable on Fire OS).
            // CategoryRow's onPress already calls this on second-OK of a selected
            // category, so the user has a reliable D-pad path.
            setBlockConfirm({ type: 'cat', catId: item.id, name: item.name, isBlocked });
          } else {
            const action = isBlocked ? 'Unblock' : 'Block';
            Alert.alert(
              `${action} Category`,
              `${action} all channels in "${item.name}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: action, style: isBlocked ? 'default' : 'destructive', onPress: () => toggleBlockedCategory(item.id) },
              ],
            );
          }
        } : undefined}
      />
    );
  }, [selectedCatId, blockedCategoryIds, catChannelCountMap, fetchedChannels, blockedSet, favorites, colors, handleSelectCat, toggleBlockedCategory]);

  const handleLongPressChannel = useCallback((ch: Channel) => {
    const isBlocked = blockedChannels.includes(ch.id);
    const action = isBlocked ? 'Unblock' : 'Block';
    if (Platform.isTV) {
      // TV: the ⊘ block button in ChannelRow already calls this (via onTvBlockPress
      // → handleLongPressChannel), so we show the ConfirmModal directly.
      setBlockConfirm({ type: 'chan', channel: ch, isBlocked });
      return;
    }
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
                nowProg ? `▶ Now: ${nowProg}` : null,
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
      // TV: dedicated ⊘ block button as a 3rd D-pad zone (RIGHT of heart).
      // Calls handleLongPressChannel which routes to ConfirmModal on TV.
      onTvBlockPress={Platform.isTV ? () => handleLongPressChannel(item) : undefined}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleToggleFav, handleLongPressChannel]);

  // ── TV remote (Fire TV / Android TV) direct navigation ───────────────────
  // Navigate straight to the fullscreen player — no expand animation needed
  // on a TV where there is no mini-player position to animate from.
  const handleTVWatch = useCallback(() => {
    // D-pad OK expands the currently visible mini-player stream, not merely
    // the last list row that received focus.
    const activeChannel = playingChannel ?? selectedChannel;
    if (!activeChannel) return;
    goingToPlayerRef.current = true;
    const hasNums = channels.some((ch) => ch.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
      num: ch.num,
      groupTitle: ch.groupTitle,
      tvArchive: ch.tvArchive,
      tvArchiveDuration: ch.tvArchiveDuration,
    }));
    const idx = chList.findIndex((c) => c.channelId === activeChannel.id);
    let nativeSurfaceHandoffId: string | undefined;
    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: activeChannel.streamUrl,
        title: activeChannel.name,
        type: 'live',
        logo: activeChannel.logo ?? '',
        epgId: activeChannel.epgId ?? activeChannel.id,
        channelId: activeChannel.id,
        // No stopOnBack — the normal triggerCollapse path handles the return
        // so the player is never paused and the TV video panel remounts cleanly
        // via onCollapseCompleteRef → setVideoKey, matching the phone flow.
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });
    if (USES_NATIVE_VLC) {
      // Publish ownership before navigation so player.tsx stays a controls-only
      // route even when Fire OS commits the route faster than effects run.
      setNativeSurfaceUrl(activeChannel.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(activeChannel.streamUrl);
      transitionNativeSurface('fullscreen', navigate);
    } else {
      navigate();
    }
  }, [selectedChannel, playingChannel, channels, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface]);

  // ── TV: play a past mini-guide programme directly (skip CatchupSheet) ─────
  // Converts an EpgProgram (which has JS Date fields) into the same catch-up
  // URL params that CatchupSheet uses, then navigates straight to the player.
  // ── TV: open CatchupSheet pre-scrolled to a specific past mini-guide row ──
  // We must NOT derive serverStart from an EpgProgram (XMLTV) Date: getXtreamCatchupUrls
  // requires the raw server-local "YYYY-MM-DD HH:MM:SS" string from get_simple_data_table,
  // which is never safe to reconstruct from a UTC Date (provider server timezone is unknown).
  // CatchupSheet fetches get_simple_data_table itself and uses the correct serverStart.
  const handleTVCatchupProg = useCallback((prog: EpgProgram) => {
    setCatchupInitialProg(prog);
    setShowCatchup(true);
  }, []);

  // Stable callbacks for TVLiveLayout — inline arrow functions would be new
  // references on every render, which can contribute to update-depth crashes
  // when the component tree is re-evaluating effects.
  const handleOpenCatchup = useCallback(() => {
    setCatchupInitialProg(null);
    setShowCatchup(true);
  }, []);

  const handleCatchupFocusChange = useCallback((focused: boolean) => {
    catchupFocusedRef.current = focused;
  }, []);

  const handlePreviewFocusChange = useCallback((focused: boolean) => {
    previewFocusedRef.current = focused;
  }, []);

  const handleGuideFocusChange = useCallback((focused: boolean) => {
    guideFocusedRef.current = focused;
  }, []);

  const handleCategoryFocusChange = useCallback((focused: boolean) => {
    categoryFocusedRef.current = focused;
  }, []);

  const handleTVCloseCatchup = useCallback(() => {
    setShowCatchup(false);
    setCatchupInitialProg(null);
  }, []);

  const handleStartCatchupPlayback = useCallback((channel: Channel) => {
    // Prevent Live TV's tab-blur cleanup from clearing its selected channel
    // while Catch-up temporarily owns the shared player.
    catchupPreviewReturnRef.current = channel;
    goingToPlayerRef.current = true;
    // Catch-up deliberately replaces the live source. Unlike a live
    // mini/fullscreen handoff, it must unmount the shared VLC view so live
    // audio cannot continue underneath the catch-up player.
    if (USES_NATIVE_VLC) {
      setIsLivePreviewActive(false);
      transitionNativeSurface('hidden');
    }
  }, [transitionNativeSurface]);

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
          onOpenCatchup={handleOpenCatchup}
          onOpenCatchupProg={handleTVCatchupProg}
          nowPlayingMap={nowPlayingMap}
          colors={colors}
          insets={insets}
          player={player}
          videoKey={videoKey}
          streamUrl={selectedChannel?.streamUrl ?? ''}
          vlcReloadKey={vlcReloadKey}
          isPlaybackActive={isLivePreviewActive}
          nativeSurfaceFullscreen={nativeSurfaceFullscreen}
           onNativeSurfaceLayout={(bounds) => {
             commitNativeSurfaceLayout(nativeSurfaceMode, bounds);
           }}
          isBuffering={isBuffering}
          hasError={hasError}
          onVlcPlaying={handlePersistentVlcPlaying}
          onVlcBuffering={handlePersistentVlcBuffering}
          onVlcError={handlePersistentVlcError}
          miniPlayerRef={miniPlayerRef}
          onPreviewFocusChange={handlePreviewFocusChange}
          onCatchupFocusChange={handleCatchupFocusChange}
          onGuideFocusChange={handleGuideFocusChange}
          onCategoryFocusChange={handleCategoryFocusChange}
          onExitToSidebar={handleExitToSidebar}
          highlightedChNodeRef={highlightedChNodeRef}
          entryResetCallbackRef={tvLiveEntryResetRef}
          focusHighlightedChCategoryRef={focusHighlightedChCategoryRef}
          focusPlayingChannelRef={focusPlayingChannelRef}
        />
        {showCatchup && selectedChannel && creds && (
          <CatchupSheet
            key={selectedChannel.id}
            visible={showCatchup}
            channel={selectedChannel}
            creds={creds}
            epgMap={epgMap}
            initialProg={catchupInitialProg ?? undefined}
            onClose={handleTVCloseCatchup}
            onStartPlayback={handleStartCatchupPlayback}
          />
        )}

      </View>
    );
  }

  return (
    <View
      ref={nativeSurfaceRootRef}
      collapsable={false}
      onLayout={handleNativeRootLayout}
      style={[styles.root, { backgroundColor: colors.background }]}
    >

      {/* ══ LEFT: vertical category list ══ */}
      <View style={[styles.catPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          CATEGORIES
        </Text>
        {/* Category search box
            TV: TVTextInput wraps the field in a FocusablePressable so D-pad
            focus lands on it and OK opens the system keyboard.  Plain TextInput
            is invisible to D-pad navigation on Fire OS (requestFocus places the
            cursor but never opens the keyboard without the explicit wrapper). */}
        <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
          <TVTextInput
            focusable
            style={[styles.catSearchInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Search…"
            placeholderTextColor={colors.mutedForeground}
            value={catSearch}
            onChangeText={setCatSearch}
            clearButtonMode="while-editing"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
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
          {/* Refresh button — pull-to-refresh is gesture-only on TV so this
              gives Firestick/Android TV users an explicit refresh action. */}
          {!isReordering && (
            <FocusablePressable
              onPress={() => refetch()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.editBtn}
              focusedStyle={styles.editBtnFocused}
            >
              <Text style={[styles.editBtnText, { color: isRefetching ? colors.primary : colors.mutedForeground }]}>↻</Text>
            </FocusablePressable>
          )}
          {isFavsSelected && favorites.length > 1 && (
            <FocusablePressable
              onPress={isReordering ? handleDone : handleEditStart}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.editBtn}
              focusedStyle={styles.editBtnFocused}
            >
              <Text style={styles.editBtnText}>
                {isReordering ? 'Done' : 'Edit'}
              </Text>
            </FocusablePressable>
          )}
        </View>

        {/* Channel filter input — hidden during drag-reorder
            TV: same TVTextInput pattern as the category search above. */}
        {!isReordering && (
          <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
            <TVTextInput
              focusable
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
      <View style={[
        styles.previewPanel,
        { paddingTop: insets.top + 4, paddingRight: insets.right + 8 },
      ]}
      collapsable={false}
      onLayout={handleNativePreviewPanelLayout}
      >

        {!isWeb && (
          /* collapsable={false} ensures the native view is created immediately
             so the persistent native surface is created immediately. Focusable
             lets D-pad / remote users highlight the box and press
             Select to open fullscreen — no separate button needed. */
          <FocusablePressable
            ref={miniPlayerRef as any}
            collapsable={false}
            onPress={handleMiniPlayerPress}
            onFocus={() => setMiniPlayerFocused(true)}
            onBlur={() => setMiniPlayerFocused(false)}
            onLayout={handleNativeMiniOwnerLayout}
            focusedStyle={{}}
            style={(focused) => [
              styles.videoWrap,
              !playingChannel && { display: 'none' },
              focused && styles.videoWrapFocused,
            ]}
          >
            {USES_NATIVE_VLC && (
              <>
                {isBuffering && !hasError && nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.videoOverlay}>
                    <ActivityIndicator color="#fff" size="large" />
                  </View>
                )}
                {hasError && nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.videoOverlay}>
                    <Text style={styles.errText}>Stream unavailable</Text>
                    <Text style={[styles.errText, { fontSize: 11, marginTop: 4, opacity: 0.7 }]}>Tap to retry</Text>
                  </View>
                )}
                {nativeSurfaceMode === 'mini' && !isBuffering && !hasError && (
                  <View pointerEvents="none" style={[styles.expandHint, miniPlayerFocused && styles.expandHintFocused]}>
                    <Text style={styles.expandHintIcon}>⛶</Text>
                  </View>
                )}
                {nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
              </>
            )}
            {/* ── Non-Android path: stream player + all overlays live inside ── */}
            {!USES_NATIVE_VLC && isLivePreviewActive && (
              <Animated.View
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
              >
                <NativeStreamPlayer
                  source={playingChannel?.streamUrl ?? selectedChannel?.streamUrl ?? ''}
                  player={player}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  // videoKey is the Expo VideoView surface-rebind workaround.
                  reloadKey={`${videoKey}:${vlcReloadKey}`}
                  onPlaying={() => {
                    setIsBuffering(false);
                    setHasError(false);
                    Animated.timing(flashOverlayOpacity, {
                      toValue: 0, duration: 200, useNativeDriver: true,
                    }).start();
                  }}
                  onBuffering={() => setIsBuffering(true)}
                  onError={() => {
                    setIsBuffering(false);
                    setHasError(true);
                    Animated.timing(flashOverlayOpacity, {
                      toValue: 0, duration: 150, useNativeDriver: true,
                    }).start();
                  }}
                />
              </Animated.View>
            )}
            {!USES_NATIVE_VLC && (
              <>
                {/* Flash-prevention overlay */}
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
                  <View style={styles.videoOverlay} pointerEvents="box-none">
                    <Text style={styles.errText}>Stream unavailable</Text>
                    <Text style={[styles.errText, { fontSize: 11, marginTop: 4, opacity: 0.7 }]}>Tap to retry</Text>
                  </View>
                )}
                {!isBuffering && !hasError && (
                  <View style={[styles.expandHint, miniPlayerFocused && styles.expandHintFocused]}>
                    <Text style={styles.expandHintIcon}>⛶</Text>
                  </View>
                )}
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </>
            )}
          </FocusablePressable>
        )}

        {/* Channel info bar — logo + name + now-playing EPG title + progress bar below the mini-player */}
        {!nativeSurfaceFullscreen && playingChannel && (
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
              {miniPlayerProg ? (
                <>
                  <Text style={[styles.chInfoNow, { color: colors.primary }]} numberOfLines={1}>
                    ▶ {miniPlayerProg.title}
                  </Text>
                  {/* Progress bar — shows how far through the current programme the viewer is.
                      Reuses the same epgProgressWrap/epgProgressBar styles used in the EPG list. */}
                  {(() => {
                    const total = miniPlayerProg.end.getTime() - miniPlayerProg.start.getTime();
                    const elapsed = Math.max(0, nowTs - miniPlayerProg.start.getTime());
                    const pct = total > 0 ? Math.min(1, elapsed / total) : 0;
                    const minsLeft = Math.max(0, Math.round((miniPlayerProg.end.getTime() - nowTs) / 60_000));
                    return (
                      <View style={styles.miniProgWrap}>
                        <View style={[styles.epgProgressWrap, { flex: 1, marginTop: 0 }]}>
                          <View style={[styles.epgProgressBar, { width: `${Math.round(pct * 100)}%` as any }]} />
                        </View>
                        <Text style={[styles.miniProgTimeLeft, { color: colors.mutedForeground }]}>
                          {minsLeft > 0 ? `${minsLeft}m` : '< 1m'}
                        </Text>
                      </View>
                    );
                  })()}
                </>
              ) : (() => {
                // Fall back to the title-only string from nowPlayingMap when full
                // programme data is not yet available (e.g. EPG still loading).
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

        {!nativeSurfaceFullscreen && (selectedChannel ? (
          <>
            {/* ── EPG header row with optional Catch-up button ── */}
            <View style={styles.epgHeaderRow}>
              <Text style={[styles.epgHeader, { color: colors.mutedForeground }]}>TV GUIDE</Text>
              {selectedChannel.tvArchive === 1 && (
                <FocusablePressable
                  onPress={() => setShowCatchup(true)}
                  style={styles.catchupBtn}
                  focusedStyle={styles.tvFocused}
                >
                  <Text style={styles.catchupBtnText}>📅 Catch-up</Text>
                </FocusablePressable>
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
                    <FocusablePressable
                      key={i}
                      onPress={isFuture ? () => handleToggleMiniReminder(prog) : undefined}
                      focusable={isFuture}
                      style={[
                        styles.epgRow,
                        { borderBottomColor: colors.border },
                        isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                      ]}
                      focusedStyle={isFuture ? styles.tvFocused : {}}
                      onFocus={Platform.isTV && isFuture ? () => setFocusedProgIdx(i) : undefined}
                      onBlur={Platform.isTV && isFuture ? () => setFocusedProgIdx(null) : undefined}
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
                        <Text style={[styles.epgBell, {
                          // #249: brighten bell when this row is D-pad focused so it
                          // stays readable against the cyan focus ring on Fire OS.
                          color: (Platform.isTV && focusedProgIdx === i)
                            ? '#FFFFFF'
                            : (hasReminder ? '#3B82F6' : colors.mutedForeground),
                        }]}>
                          {hasReminder ? '🔔' : '🔕'}
                        </Text>
                      )}
                    </FocusablePressable>
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
        ))}
      </View>{/* end previewPanel */}

      {/* Android VLC presentation host. This stays a direct child of the Live
          TV root for both mini and fullscreen. The mini control above only
          reports its real bounds; fullscreen fills this root after the tab
          shell releases its sidebar margin. */}
      {USES_NATIVE_VLC
        && isLivePreviewActive
        && nativeSurfaceMode !== 'hidden'
        && activeNativeSurfaceUrl
        && (
          nativeSurfaceFullscreen
            ? nativeSurfaceViewport.width > 0 && nativeSurfaceViewport.height > 0
            : nativeOwnerBounds.width > 0 && nativeOwnerBounds.height > 0
        ) && (
        <View
          collapsable={false}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={styles.nativeSurfacePresentationLayer}
        >
          <View
            collapsable={false}
            onLayout={(event) => {
              const { width, height, x, y } = event.nativeEvent.layout;
              console.log(VLC_TRACE, 'react-owner-layout', {
                width,
                height,
                x,
                y,
                fullscreen: nativeSurfaceFullscreen,
              });
              // The fullscreen presentation frame is explicitly sized from
              // the Android window dimensions. Do not reject the layout ack just
              // because an intermediate React Navigation container reports an
              // older preview width.
              commitNativeSurfaceLayout(nativeSurfaceMode, {
                width: nativeSurfaceFullscreen ? screenWidth : width,
                height: nativeSurfaceFullscreen ? screenHeight : height,
                x: nativeSurfaceFullscreen ? 0 : x,
                y: nativeSurfaceFullscreen ? 0 : y,
              });
            }}
            style={[
              styles.nativeSurfacePresentationFrame,
              nativeSurfaceFullscreen
                ? {
                    left: 0,
                    top: 0,
                    width: screenWidth,
                    height: screenHeight,
                  }
                : {
                    left: nativeOwnerBounds.x,
                    top: nativeOwnerBounds.y,
                    width: nativeOwnerBounds.width,
                    height: nativeOwnerBounds.height,
                  },
            ]}
          >
            <NativeStreamPlayer
              source={activeNativeSurfaceUrl}
              player={player}
              style={StyleSheet.absoluteFill}
              // Keep this native playback prop invariant across the mini/fullscreen
              // handoff. The owner frame alone changes size; libVLC starts in fill
              // mode so the same decoder can occupy the full Android viewport
              // without receiving a playback-prop update during the transition.
              resizeMode="fill"
              reloadKey={vlcReloadKey}
              onPlaying={handlePersistentVlcPlaying}
              onBuffering={handlePersistentVlcBuffering}
              onError={handlePersistentVlcError}
            />
          </View>
        </View>
      )}

      {/* ── Catch-up sheet ── */}
      {showCatchup && selectedChannel && creds && (
        <CatchupSheet
          key={selectedChannel.id}
          visible={showCatchup}
          channel={selectedChannel}
          creds={creds}
          epgMap={epgMap}
          onClose={() => setShowCatchup(false)}
          onStartPlayback={handleStartCatchupPlayback}
        />
      )}

      {/* ── TV-safe block/unblock confirmation ── */}
      {/* Replaces Alert.alert (unreliable on Fire OS) for category and channel
          block actions.  Triggered by: second OK on a selected category, the
          dedicated ⊘ button in ChannelRow (D-pad RIGHT of heart), or long-press
          (still works as a secondary path on touch). */}
      <ConfirmModal
        visible={!!blockConfirm}
        title={
          blockConfirm?.type === 'cat'
            ? `${blockConfirm.isBlocked ? 'Unblock' : 'Block'} Category`
            : `${blockConfirm?.isBlocked ? 'Unblock' : 'Block'} Channel`
        }
        message={
          blockConfirm?.type === 'cat'
            ? `${blockConfirm.isBlocked ? 'Unblock' : 'Block'} all channels in "${blockConfirm.name}"?`
            : blockConfirm?.isBlocked
              ? `Unblock "${blockConfirm.channel.name}"?`
              : `Block "${blockConfirm?.channel.name}"? It will be hidden everywhere.`
        }
        confirmLabel={blockConfirm?.isBlocked ? 'Unblock' : 'Block'}
        destructive={!blockConfirm?.isBlocked}
        onConfirm={() => {
          if (!blockConfirm) return;
          if (blockConfirm.type === 'cat') {
            toggleBlockedCategory(blockConfirm.catId);
          } else {
            const updated = blockConfirm.isBlocked
              ? blockedChannels.filter((id) => id !== blockConfirm.channel.id)
              : [...blockedChannels, blockConfirm.channel.id];
            setBlockedChannelIds(updated);
          }
          setBlockConfirm(null);
        }}
        onCancel={() => setBlockConfirm(null)}
      />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', position: 'relative' },

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
  editBtnFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
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
  previewPanelFullscreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 0,
    zIndex: 100,
    elevation: 100,
    backgroundColor: '#000',
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
  fullscreenVideoContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    aspectRatio: undefined,
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
    zIndex: 1,
    elevation: 1,
  },
  nativeSurfaceHost: {
    position: 'absolute',
    backgroundColor: '#000',
  },
  nativeSurfacePresentationLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    elevation: 50,
    pointerEvents: 'none',
  },
  nativeSurfacePresentationFrame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#000',
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

  // Mini-player info bar — progress row (bar + time remaining side by side)
  miniProgWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  miniProgTimeLeft: { fontSize: 9, fontFamily: 'Inter_400Regular', flexShrink: 0 },

  noSel: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  noSelTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  noSelSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
