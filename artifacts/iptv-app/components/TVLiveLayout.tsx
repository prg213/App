/**
 * TVLiveLayout — 3-panel Fire TV / Android TV remote-navigable layout.
 *
 * Panel 1 (left)   — Categories    (D-pad ↑↓ to move, OK to select category)
 * Panel 2 (centre) — Channels      (D-pad ↑↓ to move, OK to play, ← to go back)
 * Panel 3 (right)  — Preview area  (video on top, catchup below, mini-guide at bottom)
 *
 * IMPORTANT: D-pad focus on a channel does NOT automatically change the playing
 * channel. Only OK (onPress) selects/plays. This prevents rapid scrolling from
 * spamming the video player with stream replacements.
 *
 * All interactive elements use FocusablePressable — the Pressable style-callback
 * `focused` prop silently does nothing on Fire OS / Android TV.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  findNodeHandle,
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { type VideoPlayer } from 'expo-video';
import { FocusablePressable } from '@/components/FocusablePressable';
import { NativeStreamPlayer } from '@/components/NativeStreamPlayer';
import { useFocusRestore } from '@/hooks/useFocusRestore';
import { useTVRemote } from '@/hooks/useTVRemote';
import type { Category, Channel, EpgProgram } from '@/types';
import { channelHasCatchup, isCatchupRowPlayable } from '@/utils/catchup';
import { requestTvFocus } from '@/lib/tvFocus';
import { computeTvVerticalFocusOffset } from '@/lib/tvFocusWindow';
import { sidebarNav } from '@/lib/sidebarNav';

// ── Constants ────────────────────────────────────────────────────────────────

const FOCUS_BORDER = '#00E5FF';
const CHANNEL_HIGHLIGHT_COMMIT_DELAY_MS = 90;

// ── Types ────────────────────────────────────────────────────────────────────

export interface TVLiveLayoutProps {
  allCategories: Category[];
  selectedCatId: string;
  onCatSelect: (catId: string) => void;
  channels: Channel[];
  channelsLoading: boolean;
  epgMap: Map<string, EpgProgram[]> | undefined;
  nowTs: number;
  selectedChannel: Channel | null;
  /** Called when the user presses OK on a channel — triggers stream load */
  onChannelSelect: (ch: Channel) => void;
  /** Tracks whether remote focus is currently in the category panel. */
  onCategoryFocusChange?: (focused: boolean) => void;
  /** Stops preview only after focus has actually reached the Live TV sidebar. */
  onExitToSidebar?: () => void;
  /** Tracks focus on the small preview player for BACK handling. */
  onPreviewFocusChange?: (focused: boolean) => void;
  /** Tracks focus on mini-guide rows for BACK handling. */
  onGuideFocusChange?: (focused: boolean) => void;
  /** Called when the user presses OK on the video preview — goes full-screen */
  onWatchFullscreen: () => void;
  /** Called when the user presses OK on the catchup row */
  onOpenCatchup: () => void;
  /**
   * Called when the user presses OK on a past programme row in the mini guide
   * on a catch-up channel.  Receives the programme so the caller can deep-link
   * to the correct day in the CatchupSheet.
   */
  onOpenCatchupProg?: (prog: EpgProgram) => void;
  nowPlayingMap: Map<string, string>;
  colors: any;
  insets: { top: number; bottom: number; left: number; right: number };
  player: VideoPlayer;
  videoKey: number;
  streamUrl: string;
  vlcReloadKey?: number;
  /** False while fullscreen playback owns the Android VLC decoder. */
  isPlaybackActive: boolean;
  isBuffering: boolean;
  hasError: boolean;
  onVlcPlaying?: () => void;
  onVlcBuffering?: () => void;
  onVlcError?: () => void;
  /**
   * Ref to the video preview container — passed in from LivePlayerContext so
   * triggerCollapse / triggerExpand can measure this view's on-screen position
   * for the fullscreen ↔ mini-player animation on TV.
   */
  miniPlayerRef?: React.RefObject<View | null>;
  /**
   * TV only — called when the Catch-up TV row gains or loses focus so the
   * parent's BACK handler can redirect focus to the channel list instead of
   * clearing the channel selection.
   */
  onCatchupFocusChange?: (focused: boolean) => void;
  /**
   * TV only — written by TVLiveLayout with the currently-highlighted channel's
   * View node so the parent's BACK handler can requestTvFocus on it.
   */
  highlightedChNodeRef?: React.MutableRefObject<View | null>;
  /**
   * Filled with a synchronous reset callback for the sidebar's Live TV entry
   * action. It clears remembered channel focus so the next tab activation
   * lands on All Channels rather than a previously-highlighted row.
   */
  entryResetCallbackRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Filled with a callback so the parent's BACK handler can return from a
   * highlighted channel to that channel's category without stopping playback.
   */
  focusHighlightedChCategoryRef?: React.MutableRefObject<(() => boolean) | null>;
  /**
   * Filled with a callback so preview-panel controls can return focus to the
   * currently playing channel, even when it is not the highlighted row.
   */
  focusPlayingChannelRef?: React.MutableRefObject<(() => boolean) | null>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Component ────────────────────────────────────────────────────────────────

export function TVLiveLayout({
  allCategories,
  selectedCatId,
  onCatSelect,
  channels,
  channelsLoading,
  epgMap,
  nowTs,
  selectedChannel,
  onChannelSelect,
  onCategoryFocusChange,
  onExitToSidebar,
  onPreviewFocusChange,
  onGuideFocusChange,
  onWatchFullscreen,
  onOpenCatchup,
  onOpenCatchupProg,
  nowPlayingMap,
  colors,
  insets,
  onCatchupFocusChange,
  highlightedChNodeRef,
  entryResetCallbackRef,
  focusHighlightedChCategoryRef,
  focusPlayingChannelRef,
  player,
  videoKey,
  streamUrl,
  vlcReloadKey,
  isPlaybackActive,
  isBuffering,
  hasError,
  onVlcPlaying,
  onVlcBuffering,
  onVlcError,
  miniPlayerRef,
}: TVLiveLayoutProps) {

  const catListRef = useRef<FlatList<Category>>(null);
  const chListRef  = useRef<FlatList<Channel>>(null);
  // The two lists have different available heights, so measure each viewport
  // independently. D-pad focus uses these measurements to keep a stable
  // bottom-edge focus window instead of re-centering on every row.
  const catViewportHeightRef = useRef(0);
  const chViewportHeightRef = useRef(0);
  // Keep the current first-visible row for each independent TV list. The
  // focus-window helper uses these values to avoid scrolling while the D-pad
  // highlight is still moving through rows already visible on screen.
  const catScrollOffsetRef = useRef(0);
  const chScrollOffsetRef = useRef(0);
  // Categories and channels scroll independently. Category focus/selection
  // controls the category list position; browsing channels must not move the
  // category list underneath the user's selected category.
  // TV LEFT navigation refs:
  //   catRefMap — stores each mounted category node by item.id
  //   catFocusedRef — the most-recently-focused category node (LEFT target for channels)
  const catRefMap    = useRef(new Map<string, View>());
  const catFocusedRef = useRef<View | null>(null);
  const channelFocusedRef = useRef(false);
  const previewFocusedRef = useRef(false);
  const catchupFocusedLocalRef = useRef(false);
  const guideFocusedRef = useRef(false);
  // Fire OS can ignore a cross-panel nextFocusLeft target and move focus to the
  // category column before the hardware-key fallback receives the event. Keep a
  // sticky source marker so a category that receives focus directly from any
  // preview-panel control can immediately redirect to the playing channel.
  const previewPanelReturnPendingRef = useRef(false);
  // TV no-wrap UP/DOWN edge refs for yellow panel
  const catchupRowRef   = useRef<View | null>(null);
  const leftReturnProxyRef = useRef<View | null>(null);
  const firstGuideRowRef = useRef<View | null>(null);
  const lastGuideRowRef = useRef<View | null>(null);
  const guideRowRefMap = useRef(new Map<number, View>());
  // Count refs so renderers can check isFirst/isLast without breaking memoization
  const catCountRef = useRef(0);
  const chCountRef  = useRef(0);

  // ── TV remote initial focus ───────────────────────────────────────────────
  // useFocusRestore handles the full restore lifecycle:
  //   • firstRef (firstCatRef) — default fallback on first visit or after clearFocus()
  //   • markChFocused(node)    — records the last D-pad-focused channel row
  //   • On every tab visit (initial + return from player) the last-focused channel
  //     is restored; if none exists focus falls back to the first category item.
  const {
    firstRef: firstCatRef,
    markFocused: markChFocused,
    clearFocus,
  } = useFocusRestore({ delay: 400 });
  const firstChRef  = useRef<View>(null);
  const chRefMap = useRef(new Map<string, View>());
  // A category press selects a new (potentially async) channel list. Keep the
  // intent until its first row has mounted so OK can focus it without changing
  // the currently playing preview.
  const pendingCategoryActivationRef = useRef<string | null>(null);
  const pendingPlayingChannelFocusRef = useRef<{
    channelId: string;
    categoryId: string;
  } | null>(null);
  const firstChannelFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playingChannelFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nodeHandle = useCallback((node: View | null | undefined): number | null => {
    try { return node ? findNodeHandle(node) : null; } catch { return null; }
  }, []);
  // When the playing channel belongs to a different category than the channel
  // list currently on screen, its row is not mounted and Fire OS falls back to
  // spatial LEFT navigation (which lands on Categories). This relay stays
  // mounted in the preview panel and runs the same resolver as BACK instead.
  const [leftReturnProxyHandle, setLeftReturnProxyHandle] = useState<number | null>(null);
  const setLeftReturnProxyRef = useCallback((node: View | null) => {
    leftReturnProxyRef.current = node;
    const nextHandle = nodeHandle(node);
    setLeftReturnProxyHandle((current) => current === nextHandle ? current : nextHandle);
  }, [nodeHandle]);

  const focusFirstChannel = useCallback(() => {
    const firstChannel = channels[0];
    if (!firstChannel) return false;
    pendingCategoryActivationRef.current = null;
    setHighlightedChId(firstChannel.id);
    if (firstChannelFocusTimerRef.current) clearTimeout(firstChannelFocusTimerRef.current);
    firstChannelFocusTimerRef.current = setTimeout(() => {
      requestTvFocus(chRefMap.current.get(firstChannel.id) ?? firstChRef.current);
      firstChannelFocusTimerRef.current = null;
    }, 80);
    return true;
  }, [channels]);

  useEffect(() => () => {
    if (firstChannelFocusTimerRef.current) clearTimeout(firstChannelFocusTimerRef.current);
    if (categoryFocusTimerRef.current) clearTimeout(categoryFocusTimerRef.current);
    if (playingChannelFocusTimerRef.current) clearTimeout(playingChannelFocusTimerRef.current);
  }, []);

  // The sidebar emits its entry intent before React Navigation focuses this
  // tab. Clear the old channel restore target synchronously and make the
  // first-focus fallback the All Channels category (which is deliberately the
  // first category rendered by the parent).
  useEffect(() => {
    if (!entryResetCallbackRef) return;
    const resetEntryFocus = () => {
      clearFocus();
      const allChannelsNode = catRefMap.current.get('__all__') ?? firstCatRef.current;
      catFocusedRef.current = allChannelsNode ?? null;
      if (allChannelsNode) {
        (firstCatRef as React.MutableRefObject<View | null>).current = allChannelsNode;
      }
    };
    entryResetCallbackRef.current = resetEntryFocus;
    return () => {
      if (entryResetCallbackRef.current === resetEntryFocus) {
        entryResetCallbackRef.current = null;
      }
    };
  }, [clearFocus, entryResetCallbackRef, firstCatRef]);

  // TV: if the selected category has no channels the category-press handler's
  // firstChRef.focus() is a no-op (the channel FlatList is replaced by an
  // empty view).  Detect the settled-empty state and return D-pad focus to
  // the category list so the user always has a reachable target.
  useEffect(() => {
    if (!Platform.isTV || channelsLoading || channels.length > 0) return;
    const t = setTimeout(() => requestTvFocus(firstCatRef.current), 400);
    return () => clearTimeout(t);
  }, [channelsLoading, channels]);

  // Category OK waits for a newly selected list to finish loading, then
  // highlights and focuses its first row. Playback remains an explicit channel
  // OK action, so browsing never replaces the active preview.
  useEffect(() => {
    if (
      !Platform.isTV
      || pendingCategoryActivationRef.current !== selectedCatId
      || channelsLoading
    ) {
      return;
    }
    if (!focusFirstChannel()) pendingCategoryActivationRef.current = null;
  }, [selectedCatId, channelsLoading, channels, focusFirstChannel]);

  // Track which channel row is visually highlighted.
  // Updated on D-pad focus AND on successful OK press — never triggers stream load.
  const [highlightedChId, setHighlightedChId] = useState<string | null>(
    selectedChannel?.id ?? null,
  );
  const highlightedChIdRef = useRef<string | null>(highlightedChId);
  const highlightedChCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The focused row paints itself through FocusablePressable. Persist its
  // accent after a short pause so a held D-pad press does not redraw the
  // image/EPG-heavy channel list for every native focus event.
  const updateHighlightedChannel = useCallback((
    channelId: string | null,
    deferCommit = false,
  ) => {
    highlightedChIdRef.current = channelId;
    if (highlightedChCommitTimerRef.current) {
      clearTimeout(highlightedChCommitTimerRef.current);
      highlightedChCommitTimerRef.current = null;
    }
    if (!deferCommit) {
      setHighlightedChId(channelId);
      return;
    }
    highlightedChCommitTimerRef.current = setTimeout(() => {
      setHighlightedChId(highlightedChIdRef.current);
      highlightedChCommitTimerRef.current = null;
    }, CHANNEL_HIGHLIGHT_COMMIT_DELAY_MS);
  }, []);

  useEffect(() => () => {
    if (highlightedChCommitTimerRef.current) clearTimeout(highlightedChCommitTimerRef.current);
  }, []);

  // Keep highlight in sync when the playing channel changes from outside
  // (e.g. prev/next channel navigation in the fullscreen player).
  useEffect(() => {
    if (selectedChannel) updateHighlightedChannel(selectedChannel.id);
  }, [selectedChannel?.id, updateHighlightedChannel]);

  // Preview-panel rows route left to the playing channel, which can differ from
  // the last channel the viewer merely highlighted while browsing.
  const [playingChHandle, setPlayingChHandle] = useState<number | null>(null);
  const setPlayingChannelHandle = useCallback((handle: number | null) => {
    // FlatList rows can mount after the preview controls. Keep the native LEFT
    // target fresh without needlessly rerendering every visible channel row.
    setPlayingChHandle((current) => current === handle ? current : handle);
  }, []);

  useEffect(() => {
    highlightedChIdRef.current = highlightedChId;
    if (!Platform.isTV) return;
    const node = highlightedChId ? chRefMap.current.get(highlightedChId) : null;
    // Expose highlighted channel node to the parent (for BACK handler).
    if (highlightedChNodeRef) {
      highlightedChNodeRef.current = node ?? null;
    }
  }, [highlightedChId, highlightedChNodeRef]);

  // Preview controls must return to the channel that is actually playing, not
  // a different row that the viewer may have highlighted while browsing.
  useEffect(() => {
    if (!Platform.isTV) return;
    const node = selectedChannel ? chRefMap.current.get(selectedChannel.id) : null;
    setPlayingChannelHandle(nodeHandle(node));
  }, [selectedChannel?.id, channels, nodeHandle, setPlayingChannelHandle]);

  // Scroll the channel list to the selected channel when it is set from outside
  // (e.g. returning from recently-watched on the Home screen).  Also depends on
  // `channels` so it re-runs after the category switch populates the list.
  useEffect(() => {
    if (!selectedChannel) return;
    const index = channels.findIndex((c) => c.id === selectedChannel.id);
    if (index < 0) return;
    try {
      chListRef.current?.scrollToIndex({
        index,
        animated: false,
        viewPosition: TV_LIST_FOCUS_VIEW_POSITION,
      });
    } catch (_) {}
  }, [selectedChannel?.id, channels]);

  const categoryForChannel = useCallback((channel: Channel) => {
    const group = channel.groupTitle?.trim();
    if (group) {
      const matchingCategory = allCategories.find(
        (category) => category.id === group || category.name === group,
      );
      if (matchingCategory) return matchingCategory;
    }
    return allCategories.find((category) => category.id === selectedCatId)
      ?? allCategories[0]
      ?? null;
  }, [allCategories, selectedCatId]);

  const focusCategoryForHighlightedChannel = useCallback(() => {
    const channel = channels.find((candidate) => candidate.id === highlightedChIdRef.current)
      ?? selectedChannel;
    const category = channel ? categoryForChannel(channel) : null;
    if (!category) return false;

    const categoryIndex = allCategories.findIndex((candidate) => candidate.id === category.id);
    if (categoryIndex < 0) return false;
    catListRef.current?.scrollToIndex({
      index: categoryIndex,
      animated: false,
      viewPosition: TV_LIST_FOCUS_VIEW_POSITION,
    });

    const focusCategory = () => {
      const node = catRefMap.current.get(category.id);
      if (!node) return;
      catFocusedRef.current = node;
      sidebarNav.focusedRoute = null;
      onCategoryFocusChange?.(true);
      requestTvFocus(node);
    };
    focusCategory();
    if (categoryFocusTimerRef.current) clearTimeout(categoryFocusTimerRef.current);
    categoryFocusTimerRef.current = setTimeout(() => {
      focusCategory();
      categoryFocusTimerRef.current = null;
    }, 120);
    return true;
  }, [
    allCategories,
    categoryForChannel,
    channels,
    onCategoryFocusChange,
    selectedChannel,
  ]);

  useEffect(() => {
    if (!focusHighlightedChCategoryRef) return;
    focusHighlightedChCategoryRef.current = focusCategoryForHighlightedChannel;
    return () => {
      if (focusHighlightedChCategoryRef.current === focusCategoryForHighlightedChannel) {
        focusHighlightedChCategoryRef.current = null;
      }
    };
  }, [focusHighlightedChCategoryRef, focusCategoryForHighlightedChannel]);

  const focusPlayingChannel = useCallback(() => {
    if (!selectedChannel) return false;
    const playingChannel = selectedChannel;
    const playingIndex = channels.findIndex((channel) => channel.id === playingChannel.id);
    if (playingIndex < 0) {
      const playingCategory = categoryForChannel(playingChannel);
      if (!playingCategory) return false;
      pendingPlayingChannelFocusRef.current = {
        channelId: playingChannel.id,
        categoryId: playingCategory.id,
      };
      onCatSelect(playingCategory.id);
      return true;
    }

    updateHighlightedChannel(playingChannel.id);
    const focusPlayingNode = () => {
      const node = chRefMap.current.get(playingChannel.id);
      if (!node) return false;
      if (highlightedChNodeRef) highlightedChNodeRef.current = node;
      setPlayingChannelHandle(nodeHandle(node));
      requestTvFocus(node);
      return true;
    };

    if (focusPlayingNode()) return true;
    try {
      chListRef.current?.scrollToIndex({
        index: playingIndex,
        animated: false,
        viewPosition: TV_LIST_FOCUS_VIEW_POSITION,
      });
    } catch {}
    if (playingChannelFocusTimerRef.current) {
      clearTimeout(playingChannelFocusTimerRef.current);
    }
    // A FlatList can take several render batches to remount a row after a
    // preview-panel LEFT/BACK. Keep trying until the target exists instead of
    // letting the one-shot timeout leave Fire OS free to focus Categories.
    const retryFocusPlayingNode = (attemptsRemaining: number) => {
      if (focusPlayingNode() || attemptsRemaining <= 0) {
        playingChannelFocusTimerRef.current = null;
        return;
      }
      playingChannelFocusTimerRef.current = setTimeout(
        () => retryFocusPlayingNode(attemptsRemaining - 1),
        PLAYING_CHANNEL_FOCUS_RETRY_DELAY_MS,
      );
    };
    playingChannelFocusTimerRef.current = setTimeout(
      () => retryFocusPlayingNode(PLAYING_CHANNEL_FOCUS_RETRY_ATTEMPTS),
      PLAYING_CHANNEL_FOCUS_RETRY_DELAY_MS,
    );
    return true;
  }, [
    categoryForChannel,
    channels,
    highlightedChNodeRef,
    nodeHandle,
    onCatSelect,
    selectedChannel,
    setPlayingChannelHandle,
    updateHighlightedChannel,
  ]);

  useEffect(() => {
    const pending = pendingPlayingChannelFocusRef.current;
    if (
      !pending
      || pending.channelId !== selectedChannel?.id
      || pending.categoryId !== selectedCatId
      || channelsLoading
    ) {
      return;
    }
    if (!channels.some((channel) => channel.id === pending.channelId)) {
      pendingPlayingChannelFocusRef.current = null;
      return;
    }
    pendingPlayingChannelFocusRef.current = null;
    focusPlayingChannel();
  }, [channels, channelsLoading, focusPlayingChannel, selectedCatId, selectedChannel?.id]);

  useEffect(() => {
    if (!focusPlayingChannelRef) return;
    focusPlayingChannelRef.current = focusPlayingChannel;
    return () => {
      if (focusPlayingChannelRef.current === focusPlayingChannel) {
        focusPlayingChannelRef.current = null;
      }
    };
  }, [focusPlayingChannelRef, focusPlayingChannel]);

  // Direct nextFocusLeft handles the normal route. When that category row has
  // been virtualized away, Fire OS lets the key fall through to this shared
  // remote hook. It also returns preview-panel rows to the playing channel
  // when their direct native target is unavailable.
  useTVRemote({
    left: (event) => {
      if (event.eventKeyAction === 0) return;
      if (
        previewFocusedRef.current
        || catchupFocusedLocalRef.current
        || guideFocusedRef.current
      ) {
        focusPlayingChannel();
        return;
      }
      if (channelFocusedRef.current) focusCategoryForHighlightedChannel();
    },
  });

  // EPG for the currently playing channel (panel 3 mini-guide).
  // Include up to 2 recently-ended programmes before the current one so that
  // past rows are present in the list and can be pressed for catch-up on TV.
  const channelEpg = useMemo(() => {
    if (!selectedChannel || !epgMap) return [];
    const key = selectedChannel.epgId ?? selectedChannel.id;
    const progs = epgMap.get(key) ?? [];
    // Index of the first programme that hasn't fully ended yet (current or future)
    const nowIdx = progs.findIndex((p) => p.end.getTime() > nowTs);
    if (nowIdx < 0) {
      // All programmes have ended — show the last 10 (all past, all catchupPlayable)
      return progs.slice(Math.max(0, progs.length - 10));
    }
    // Start 2 slots before the current programme so recently-aired shows appear
    const startIdx = Math.max(0, nowIdx - 2);
    return progs.slice(startIdx, startIdx + 10);
  }, [selectedChannel, epgMap, nowTs]);

  const currentProg = useMemo(
    () => channelEpg.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null,
    [channelEpg, nowTs],
  );

  const hasCatchup = channelHasCatchup(selectedChannel);

  // The preview panel is a deliberate vertical D-pad chain:
  // preview → Catch-up (when present) → first guide row. Native spatial
  // navigation regularly skips these controls on Fire OS because the video
  // surface overlaps their measured bounds. When the playing row is
  // virtualized, pin LEFT to a focus relay that invokes focusPlayingChannel
  // (the same resolver used by BACK), rather than allowing spatial navigation
  // to jump straight to the category panel.
  useEffect(() => {
    if (!Platform.isTV) return;
    const previewNode = miniPlayerRef?.current as View | null | undefined;
    if (!previewNode) return;
    const previewH = nodeHandle(previewNode);
    if (previewH == null) return;
    const catchupNode = catchupRowRef.current;
    const firstGuideNode = firstGuideRowRef.current;
    const lastGuideNode = lastGuideRowRef.current;
    const playingOrReturnProxy = playingChHandle ?? leftReturnProxyHandle;
    const patch = (node: View | null, props: Record<string, number | null>) => {
      if (!node) return;
      const usable = Object.fromEntries(
        Object.entries(props).filter(([, handle]) => handle != null),
      ) as Record<string, number>;
      if (Object.keys(usable).length) {
        try { (node as any).setNativeProps?.(usable); } catch {}
      }
    };

    patch(previewNode, {
      nextFocusUp: previewH,
      nextFocusDown: nodeHandle(catchupNode) ?? nodeHandle(firstGuideNode) ?? previewH,
      nextFocusLeft: playingOrReturnProxy,
    });
    patch(catchupNode, {
      nextFocusUp: previewH,
      nextFocusDown: nodeHandle(firstGuideNode) ?? nodeHandle(catchupNode),
      nextFocusLeft: playingOrReturnProxy,
    });
    guideRowRefMap.current.forEach((node, index) => {
      patch(node, {
        ...(index === 0
          ? { nextFocusUp: nodeHandle(catchupNode) ?? previewH }
          : {}),
        ...(node === lastGuideNode
          ? { nextFocusDown: nodeHandle(lastGuideNode) }
          : {}),
        nextFocusLeft: playingOrReturnProxy,
      });
    });
  }, [channelEpg.length, hasCatchup, leftReturnProxyHandle, miniPlayerRef, nodeHandle, playingChHandle, selectedChannel?.id]);

  // ── Category row ──────────────────────────────────────────────────────────
  // onFocus: scroll only — category changes on OK press.

  // Keep count refs in sync so renderers can check isFirst/isLast each render.
  catCountRef.current = allCategories.length;
  chCountRef.current  = channels.length;

  const handleCatFocus = useCallback((index: number) => {
    try {
      const nextOffset = computeTvVerticalFocusOffset(
        index,
        CAT_ITEM_H,
        catViewportHeightRef.current,
        catScrollOffsetRef.current,
      );
      catScrollOffsetRef.current = nextOffset;
      catListRef.current?.scrollToOffset({
        offset: nextOffset,
        animated: false,
      });
    } catch (_) {}
  }, []);

  const wireCategoryToFirstChannel = useCallback((categoryNode?: View | null) => {
    if (!Platform.isTV) return;
    const category = categoryNode ?? catFocusedRef.current;
    const firstChannelHandle = nodeHandle(firstChRef.current);
    if (!category || firstChannelHandle == null) return;
    try { (category as any).setNativeProps?.({ nextFocusRight: firstChannelHandle }); } catch {}
  }, [nodeHandle]);

  // A new category can load its rows after that category already has focus.
  // Re-wire RIGHT after those rows mount instead of waiting for another focus event.
  useEffect(() => {
    wireCategoryToFirstChannel();
  }, [channels, wireCategoryToFirstChannel]);

  const renderCat: ListRenderItem<Category> = useCallback(({ item, index }) => (
    <FocusablePressable
      ref={(node: View | null) => {
        // Keep firstCatRef pointed at the first item for focus-restore fallback.
        if (index === 0) (firstCatRef as React.MutableRefObject<View | null>).current = node;
        // Store every mounted node so onFocus can identify the focused one.
        if (node) catRefMap.current.set(item.id, node);
        else catRefMap.current.delete(item.id);
      }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={item.name}
      focusedStyle={styles.focusedItem}
      style={[
        styles.catItem,
        { borderBottomColor: colors.border },
        item.id === selectedCatId && { borderLeftColor: colors.primary, borderLeftWidth: 3 },
      ]}
      // TV LEFT: category panel is leftmost content — go to the sidebar.
      nextFocusLeft={Platform.isTV ? (sidebarNav.handle ?? undefined) : undefined}
      onFocus={() => {
        // Native Android TV focus occasionally skips the requested channel
        // target when leaving the preview panel and lands here instead. Treat
        // that arrival as the failed LEFT route it is, not as a real category
        // selection, then restore the channel before this row can remain
        // highlighted.
        if (Platform.isTV && previewPanelReturnPendingRef.current) {
          previewPanelReturnPendingRef.current = false;
          focusPlayingChannel();
          return;
        }
        previewPanelReturnPendingRef.current = false;
        handleCatFocus(index);
        onCategoryFocusChange?.(true);
        sidebarNav.focusedRoute = null;
        channelFocusedRef.current = false;
        if (!Platform.isTV) return;
        // Record focused category node so channel LEFT can return here.
        const node = catRefMap.current.get(item.id) ?? null;
        catFocusedRef.current = node;
        // No-wrap edges: UP on first → nothing; DOWN on last → nothing.
        if (node) {
          try {
            const h = findNodeHandle(node);
            if (h != null) {
              const props: Record<string, number> = {};
              if (index === 0) props.nextFocusUp = h;
              if (index === catCountRef.current - 1) props.nextFocusDown = h;
              // Category LEFT must land on the active Live TV sidebar item.
              if (sidebarNav.handle != null) props.nextFocusLeft = sidebarNav.handle;
              if (Object.keys(props).length) (node as any).setNativeProps?.(props);
              // Fire OS does not reliably infer a route across these two
              // independently-virtualised lists. Make category → first channel
              // deterministic once the channel row is mounted.
              wireCategoryToFirstChannel(node);
            }
          } catch {}
        }
      }}
      onBlur={() => {
        onCategoryFocusChange?.(false);
        // Native focus events can arrive in either order on Fire OS. Defer
        // this check until the sidebar has had a chance to claim focus, so
        // category → channel navigation never stops the preview.
        setTimeout(() => {
          if (sidebarNav.focusedRoute === 'index') onExitToSidebar?.();
        }, 0);
      }}
      onPress={() => {
        pendingCategoryActivationRef.current = item.id;
        onCatSelect(item.id);
        handleCatFocus(index);
        // Selecting an already-loaded category does not trigger a data update,
        // so focus its first row immediately rather than waiting for the
        // pending-selection effect. This intentionally does not start playback.
        if (item.id === selectedCatId && !channelsLoading) focusFirstChannel();
      }}
    >
      <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={1}>
        {item.name}
      </Text>
    </FocusablePressable>
  ), [
    selectedCatId,
    colors,
    handleCatFocus,
    onCatSelect,
    nodeHandle,
    onCategoryFocusChange,
    wireCategoryToFirstChannel,
    channelsLoading,
    focusFirstChannel,
    focusPlayingChannel,
  ]);

  // ── Channel row ───────────────────────────────────────────────────────────
  // onFocus: highlight only — native TV focus owns rapid list scrolling.
  // Stream loads on OK press only.  An imperative animated scroll here would
  // start a new animation for every D-pad event and make fast navigation jump.

  const handleChFocus = useCallback((ch: Channel, index: number) => {
    updateHighlightedChannel(ch.id, true);
    try {
      const nextOffset = computeTvVerticalFocusOffset(
        index,
        CH_ITEM_H,
        chViewportHeightRef.current,
        chScrollOffsetRef.current,
      );
      chScrollOffsetRef.current = nextOffset;
      chListRef.current?.scrollToOffset({
        offset: nextOffset,
        animated: false,
      });
    } catch {}
  }, [updateHighlightedChannel]);

  const renderChannel: ListRenderItem<Channel> = useCallback(({ item, index }) => {
    const nowProg = nowPlayingMap.get(item.epgId ?? item.id) ?? nowPlayingMap.get(item.id);
    const isHighlighted = highlightedChId === item.id;
    const isPlaying = selectedChannel?.id === item.id;
    // EPG progress for this channel's currently-airing programme
    const epgProgs = epgMap?.get(item.epgId ?? item.id) ?? [];
    const currentEpgProg = epgProgs.find(
      (p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime(),
    );
    const epgPct = currentEpgProg
      ? Math.min(100, Math.max(0,
          (nowTs - currentEpgProg.start.getTime()) /
          (currentEpgProg.end.getTime() - currentEpgProg.start.getTime()) * 100,
        ))
      : null;
    return (
      <FocusablePressable
        ref={(node: View | null) => {
          if (index === 0) (firstChRef as any).current = node;
          if (node) {
            chRefMap.current.set(item.id, node);
            // The selected row is often virtualized in after the preview
            // controls mount. Update their native LEFT target at that moment
            // so Fire OS cannot spatially skip the channel panel for
            // Categories.
            if (Platform.isTV && item.id === selectedChannel?.id) {
              setPlayingChannelHandle(nodeHandle(node));
            }
          } else {
            chRefMap.current.delete(item.id);
            // Virtualized lists recycle native handles. If the playing row
            // leaves the render window, clear its route immediately so
            // preview-panel LEFT self-pins until focusPlayingChannel remounts
            // and restores the selected row instead of targeting a recycled
            // channel/category view.
            if (Platform.isTV && item.id === selectedChannel?.id) {
              setPlayingChannelHandle(null);
            }
          }
        }}
        accessible
        accessibilityRole="button"
        accessibilityLabel={item.name}
        focusedStyle={styles.focusedItem}
        style={[
          styles.chItem,
          { borderBottomColor: colors.border },
          isHighlighted && { borderLeftColor: FOCUS_BORDER, borderLeftWidth: 3 },
        ]}
        onFocus={() => {
          previewPanelReturnPendingRef.current = false;
          handleChFocus(item, index);
          onCategoryFocusChange?.(false);
          sidebarNav.focusedRoute = null;
          channelFocusedRef.current = true;
          const node = chRefMap.current.get(item.id);
          if (node) {
            if (highlightedChNodeRef) highlightedChNodeRef.current = node;
            markChFocused(node);
            if (Platform.isTV) {
              try {
                const h = findNodeHandle(node);
                const props: Record<string, number> = {};
                // LEFT → last-focused category (or first category if none has
                // been D-pad-focused yet, e.g. user arrived via BACK from catchup).
                const channelCategory = categoryForChannel(item);
                const categoryNode = channelCategory
                  ? catRefMap.current.get(channelCategory.id)
                  : null;
                if (categoryNode) catFocusedRef.current = categoryNode;
                const catTarget = categoryNode ?? catFocusedRef.current ?? firstCatRef.current;
                if (catTarget) {
                  const ch = findNodeHandle(catTarget);
                  if (ch != null) props.nextFocusLeft = ch;
                }
                // No-wrap edges: UP on first → nothing; DOWN on last → nothing.
                if (h != null) {
                  if (index === 0) props.nextFocusUp = h;
                  if (index === chCountRef.current - 1) props.nextFocusDown = h;
                  // The preview panel is the next column to the right. Without
                  // an explicit native target Fire OS can lose focus within
                  // the channel list or jump to an unrelated control.
                  const previewHandle = nodeHandle(miniPlayerRef?.current);
                  if (previewHandle != null) props.nextFocusRight = previewHandle;
                }
                if (Object.keys(props).length) (node as any).setNativeProps?.(props);
              } catch {}
            }
          }
        }}
        onBlur={() => {
          channelFocusedRef.current = false;
        }}
        onPress={() => {
          onChannelSelect(item);
          updateHighlightedChannel(item.id);
        }}
      >
        {item.logo ? (
          <Image source={{ uri: item.logo }} style={styles.chLogo} resizeMode="contain" />
        ) : (
          <View style={[styles.chLogoPlaceholder, { backgroundColor: colors.secondary }]}>
            <Text style={styles.chLogoPlaceholderText}>📺</Text>
          </View>
        )}
        <View style={styles.chTextWrap}>
          <View style={styles.chNameRow}>
            <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>
              {item.name}
            </Text>
            {/* LIVE badge on the currently-playing channel */}
            {isPlaying && (
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            )}
          </View>
          {nowProg ? (
            <Text style={[styles.chNow, { color: colors.mutedForeground }]} numberOfLines={1}>
              {nowProg}
            </Text>
          ) : null}
          {/* EPG progress bar — how far through the current programme */}
          {epgPct !== null && (
            <View style={styles.chEpgBarBg}>
              <View style={[styles.chEpgBarFill, { width: `${epgPct}%` as any }]} />
            </View>
          )}
        </View>
      </FocusablePressable>
    );
  }, [highlightedChId, nowPlayingMap, selectedChannel, epgMap, nowTs, colors, handleChFocus, onChannelSelect, onCategoryFocusChange, onExitToSidebar, categoryForChannel, markChFocused, miniPlayerRef, nodeHandle, highlightedChNodeRef, setPlayingChannelHandle, updateHighlightedChannel]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          // TVs often report zero safe-area insets even when overscan trims
          // the outermost pixels. Keep the three-panel grid inside a small
          // hardware-safe margin on every edge.
          paddingTop: Math.max(insets.top, 8),
          paddingBottom: Math.max(insets.bottom, 8),
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
        },
      ]}
    >
      {/* ═══ Panel 1 — Categories ═══════════════════════════════════════════ */}
      <View style={[styles.catPanel, { borderRightColor: colors.border }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          CATEGORIES
        </Text>
        <FlatList
          ref={catListRef}
          data={allCategories}
          keyExtractor={(c) => c.id}
          renderItem={renderCat}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: CAT_ITEM_H, offset: CAT_ITEM_H * i, index: i })}
          onLayout={(event) => {
            catViewportHeightRef.current = event.nativeEvent.layout.height;
          }}
          onScroll={(event) => {
            catScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onScrollToIndexFailed={() => {}}
        />
      </View>

      {/* ═══ Panel 2 — Channels ══════════════════════════════════════════════ */}
      <View style={[styles.chPanel, { borderRightColor: colors.border }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          {channelsLoading ? 'LOADING…' : `CHANNELS · ${channels.length}`}
        </Text>
        {channelsLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : channels.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 28 }}>📭</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No channels</Text>
          </View>
        ) : (
          <FlatList
            ref={chListRef}
            data={channels}
            keyExtractor={(c) => c.id}
            renderItem={renderChannel}
            showsVerticalScrollIndicator={false}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={16}
            windowSize={7}
            getItemLayout={(_, i) => ({ length: CH_ITEM_H, offset: CH_ITEM_H * i, index: i })}
            onLayout={(event) => {
              chViewportHeightRef.current = event.nativeEvent.layout.height;
            }}
            onScroll={(event) => {
              chScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            onScrollToIndexFailed={() => {}}
          />
        )}
      </View>

      {/* ═══ Panel 3 — Preview ═══════════════════════════════════════════════ */}
      <View style={styles.previewPanel}>
        {!selectedChannel ? (
          <View style={styles.noSelWrap}>
            <Text style={{ fontSize: 48 }}>📺</Text>
            <Text style={[styles.noSelText, { color: colors.mutedForeground }]}>
              Select a channel{'\n'}to preview
            </Text>
          </View>
        ) : (
          <>
            {/* This is only a native D-pad relay. It is invisible and cannot be
                reached through normal spatial navigation; preview-panel LEFT
                targets it only when the playing channel row is unmounted. */}
            <FocusablePressable
              ref={setLeftReturnProxyRef as any}
              focusable={Platform.isTV}
              accessible={false}
              pointerEvents="none"
              style={styles.leftReturnProxy}
              onFocus={() => { focusPlayingChannel(); }}
            />
            {/* 3a — Video preview (OK = full screen) */}
            <FocusablePressable
              ref={miniPlayerRef as any}
              collapsable={false}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Watch fullscreen — press OK"
              focusedStyle={styles.videoFocused}
              style={styles.videoWrap}
              nextFocusLeft={playingChHandle ?? leftReturnProxyHandle ?? undefined}
              onFocus={() => {
                previewPanelReturnPendingRef.current = true;
                previewFocusedRef.current = true;
                onPreviewFocusChange?.(true);
              }}
              onBlur={() => {
                previewFocusedRef.current = false;
                onPreviewFocusChange?.(false);
              }}
              onPress={onWatchFullscreen}
            >
              {isPlaybackActive && !!streamUrl && (
                <NativeStreamPlayer
                  source={streamUrl}
                  player={player}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  reloadKey={`${videoKey}:${vlcReloadKey ?? 0}`}
                  onPlaying={onVlcPlaying}
                  onBuffering={onVlcBuffering}
                  onError={onVlcError}
                />
              )}

              {isBuffering && (
                <View style={styles.videoOverlay}>
                  <ActivityIndicator color="#fff" size="large" />
                  <Text style={styles.videoOverlayText}>Loading…</Text>
                </View>
              )}

              {hasError && !isBuffering && (
                <View style={styles.videoOverlay}>
                  <Text style={{ fontSize: 28 }}>⚠️</Text>
                  <Text style={styles.videoOverlayText}>Stream unavailable</Text>
                </View>
              )}

            </FocusablePressable>

            {/* Channel name + current programme + progress bar */}
            <View style={[styles.infoBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              <Text style={[styles.infoChannelName, { color: colors.foreground }]} numberOfLines={1}>
                {selectedChannel.name}
              </Text>
              {currentProg ? (
                <>
                  <Text style={[styles.infoProgName, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {fmtTime(currentProg.start)}–{fmtTime(currentProg.end)}  {currentProg.title}
                  </Text>
                  <View style={styles.previewProgBarBg}>
                    <View style={[styles.previewProgBarFill, {
                      width: `${Math.min(100, Math.max(0,
                        (nowTs - currentProg.start.getTime()) /
                        (currentProg.end.getTime() - currentProg.start.getTime()) * 100,
                      ))}%` as any,
                    }]} />
                  </View>
                </>
              ) : null}
            </View>

            {/* 3b — Catchup */}
            {hasCatchup ? (
              <FocusablePressable
                ref={(n: View | null) => { catchupRowRef.current = n; }}
                accessible
                accessibilityRole="button"
                accessibilityLabel="Open catch-up TV"
                focusedStyle={styles.focusedItem}
                style={[styles.catchupRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                // TV LEFT / BACK: return to the channel that is playing.
                nextFocusLeft={playingChHandle ?? leftReturnProxyHandle ?? undefined}
                onFocus={() => {
                  previewPanelReturnPendingRef.current = true;
                  catchupFocusedLocalRef.current = true;
                  onCatchupFocusChange?.(true);
                }}
                onBlur={() => {
                  catchupFocusedLocalRef.current = false;
                  onCatchupFocusChange?.(false);
                }}
                onPress={onOpenCatchup}
              >
                <Text style={styles.catchupIcon}>📼</Text>
                <View style={styles.catchupText}>
                  <Text style={[styles.catchupTitle, { color: colors.foreground }]}>Catch-up TV</Text>
                  <Text style={[styles.catchupSub, { color: colors.mutedForeground }]}>
                    Last {selectedChannel.tvArchiveDuration ?? 7} days available
                  </Text>
                </View>
                <Text style={[styles.catchupArrow, { color: colors.mutedForeground }]}>›</Text>
              </FocusablePressable>
            ) : null}

            {/* 3c — Mini TV guide.  On TV each row is focusable so the D-pad
                can move down INTO the list; the enclosing ScrollView then
                auto-scrolls to keep the focused row visible (previously the
                rows were plain Views, so the remote could never reach or
                scroll this panel and everything below the fold was
                inaccessible on Firestick). */}
            {channelEpg.length > 0 ? (
              <View style={[styles.guideWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.guideHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
                  TV GUIDE
                </Text>
                <ScrollView
                  style={{ flex: 1, minHeight: 0 }}
                  contentContainerStyle={{ paddingBottom: 4 }}
                  showsVerticalScrollIndicator={false}
                >
                  {channelEpg.map((prog, i) => {
                    const isNow = prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
                    const isPast = prog.end.getTime() <= nowTs;
                    // On TV: past programmes on a catch-up channel are pressable
                    // so the user can open catch-up directly for that show.
                    const isCatchupPlayable = isCatchupRowPlayable(prog, nowTs, Platform.isTV, hasCatchup, !!onOpenCatchupProg);
                    const Row = (Platform.isTV ? FocusablePressable : View) as any;
                    const isLastGuideRow = i === channelEpg.length - 1;
                    return (
                      <Row
                        key={i}
                        ref={Platform.isTV
                          ? (n: View | null) => {
                              if (n) {
                                guideRowRefMap.current.set(i, n);
                                if (i === 0) firstGuideRowRef.current = n;
                                if (isLastGuideRow) lastGuideRowRef.current = n;
                              } else {
                                guideRowRefMap.current.delete(i);
                                if (i === 0) firstGuideRowRef.current = null;
                                if (isLastGuideRow) lastGuideRowRef.current = null;
                              }
                            }
                          : undefined}
                        focusedStyle={Platform.isTV ? { backgroundColor: colors.secondary } : undefined}
                        style={[
                          styles.guideItem,
                          { borderBottomColor: colors.border },
                          isNow && { backgroundColor: colors.secondary },
                        ]}
                        // TV LEFT: mini-guide → return to the playing channel.
                        {...(Platform.isTV && playingChHandle != null
                          ? { nextFocusLeft: playingChHandle }
                          : {})}
                        {...(Platform.isTV
                          ? {
                              onFocus: () => {
                                previewPanelReturnPendingRef.current = true;
                                guideFocusedRef.current = true;
                                onGuideFocusChange?.(true);
                              },
                              onBlur: () => {
                                guideFocusedRef.current = false;
                                onGuideFocusChange?.(false);
                              },
                            }
                          : {})}
                        {...(isCatchupPlayable
                          ? {
                              accessible: true,
                              accessibilityRole: 'button',
                              accessibilityLabel: `Play ${prog.title} catch-up`,
                              onPress: () => onOpenCatchupProg!(prog),
                            }
                          : {})}
                      >
                        <Text
                          style={[
                            styles.guideTime,
                            { color: isNow ? colors.primary : colors.mutedForeground },
                          ]}
                        >
                          {fmtTime(prog.start)}{isNow ? ' ●' : ''}
                          {isCatchupPlayable ? ' 📼' : ''}
                        </Text>
                        <Text
                          style={[styles.guideTitle, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {prog.title}
                        </Text>
                      </Row>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
// ── Layout constants ──────────────────────────────────────────────────────────

// Both lists share one row height so their horizontal boundaries stay inline
// while the viewer scrolls through channels. The channel row is the taller
// requirement because it contains the logo, channel name, and programme text.
const TV_LIST_ROW_H = 58;
const CAT_ITEM_H = TV_LIST_ROW_H;
const CH_ITEM_H  = TV_LIST_ROW_H;
const TV_LIST_FOCUS_VIEW_POSITION = 0.3;
const PLAYING_CHANNEL_FOCUS_RETRY_ATTEMPTS = 6;
const PLAYING_CHANNEL_FOCUS_RETRY_DELAY_MS = 80;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  leftReturnProxy: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
  },
  root: {
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },

  // ── Panel 1 — Categories ──
  catPanel: {
    width: '20%',
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },

  panelHeader: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  catItem: {
    height: CAT_ITEM_H,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },

  catName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },

  // ── Panel 2 — Channels ──
  chPanel: {
    width: '30%',
    minWidth: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
  },

  chItem: {
    height: CH_ITEM_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },

  chLogo: {
    width: 36,
    height: 28,
    borderRadius: 4,
  },

  chLogoPlaceholder: {
    width: 36,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chLogoPlaceholderText: {
    fontSize: 14,
  },

  chTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  chName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },

  chNow: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },

  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  emptyText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },

  // ── Panel 3 — Preview ──
  previewPanel: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
  },

  noSelWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  noSelText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },

  videoWrap: {
    aspectRatio: 16 / 9,
    width: '100%',
    flexShrink: 0,
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'transparent',
    overflow: 'hidden',
  },

  videoFocused: {
    borderColor: FOCUS_BORDER,
  },

  videoOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },

  videoOverlayText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },

  infoBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },

  infoChannelName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },

  infoProgName: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },

  // ── Catchup row ──
  catchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 12,
  },

  catchupIcon: {
    fontSize: 22,
  },

  catchupText: {
    flex: 1,
  },

  catchupTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },

  catchupSub: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },

  catchupArrow: {
    fontSize: 22,
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Mini guide ──
  guideWrap: {
    marginHorizontal: 10,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },

  guideHeader: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.2,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  guideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  guideTime: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    width: 54,
  },

  guideTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },

  // ── Channel name row (name + LIVE badge) ──
  chNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },

  // ── LIVE badge on the currently-playing channel row ──
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EF4444',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexShrink: 0,
  },
  liveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  liveBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },

  // ── EPG progress bar on channel rows ──
  chEpgBarBg: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  chEpgBarFill: {
    height: 2,
    backgroundColor: '#00D4FF',
    borderRadius: 1,
  },

  // ── Programme progress bar in the preview info panel ──
  previewProgBarBg: {
    height: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  previewProgBarFill: {
    height: 2,
    backgroundColor: '#3B82F6',
    borderRadius: 1,
  },

  // ── Focus highlight (shared — TV D-pad cursor) ──
  // A solid tinted background + thick left accent makes the focused row
  // immediately obvious from across the room on a Firestick / Android TV.
  focusedItem: {
    backgroundColor: 'rgba(0, 229, 255, 0.22)',
    // Matches the unfocused row's left-border width so focus never changes the
    // measured row geometry and shifts the category/channel grid out of line.
    borderLeftWidth: 3,
    borderLeftColor: FOCUS_BORDER,
  },
});
