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
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';
import { FocusablePressable } from '@/components/FocusablePressable';
import type { Category, Channel, EpgProgram } from '@/types';

// ── Constants ────────────────────────────────────────────────────────────────

const FOCUS_BORDER = '#00E5FF';

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
  /** Called when the user presses OK on the video preview — goes full-screen */
  onWatchFullscreen: () => void;
  /** Called when the user presses OK on the catchup row */
  onOpenCatchup: () => void;
  nowPlayingMap: Map<string, string>;
  colors: any;
  insets: { top: number; bottom: number; left: number; right: number };
  player: VideoPlayer;
  videoKey: number;
  isBuffering: boolean;
  hasError: boolean;
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
  onWatchFullscreen,
  onOpenCatchup,
  nowPlayingMap,
  colors,
  insets,
  player,
  videoKey,
  isBuffering,
  hasError,
}: TVLiveLayoutProps) {

  const catListRef = useRef<FlatList<Category>>(null);
  const chListRef  = useRef<FlatList<Channel>>(null);

  // Track which channel row is visually highlighted.
  // Updated on D-pad focus AND on successful OK press — never triggers stream load.
  const [highlightedChId, setHighlightedChId] = useState<string | null>(
    selectedChannel?.id ?? null,
  );

  // Keep highlight in sync when the playing channel changes from outside
  // (e.g. prev/next channel navigation in the fullscreen player).
  useEffect(() => {
    if (selectedChannel) setHighlightedChId(selectedChannel.id);
  }, [selectedChannel?.id]);

  // EPG for the currently playing channel (panel 3 mini-guide)
  const channelEpg = useMemo(() => {
    if (!selectedChannel || !epgMap) return [];
    const key = selectedChannel.epgId ?? selectedChannel.id;
    const progs = epgMap.get(key) ?? [];
    const nowIdx = progs.findIndex((p) => p.end.getTime() > nowTs);
    return nowIdx >= 0 ? progs.slice(nowIdx, nowIdx + 10) : progs.slice(0, 10);
  }, [selectedChannel, epgMap, nowTs]);

  const currentProg = useMemo(
    () => channelEpg.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null,
    [channelEpg, nowTs],
  );

  const hasCatchup = selectedChannel?.tvArchive === 1;

  // ── Category row ──────────────────────────────────────────────────────────
  // onFocus: scroll only — category changes on OK press.

  const handleCatFocus = useCallback((index: number) => {
    try {
      catListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
    } catch (_) {}
  }, []);

  const renderCat: ListRenderItem<Category> = useCallback(({ item, index }) => (
    <FocusablePressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={item.name}
      focusedStyle={styles.focusedItem}
      style={[
        styles.catItem,
        { borderBottomColor: colors.border },
        item.id === selectedCatId && { borderLeftColor: colors.primary, borderLeftWidth: 3 },
      ]}
      onFocus={() => handleCatFocus(index)}
      onPress={() => {
        onCatSelect(item.id);
        handleCatFocus(index);
      }}
    >
      <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={1}>
        {item.name}
      </Text>
    </FocusablePressable>
  ), [selectedCatId, colors, handleCatFocus, onCatSelect]);

  // ── Channel row ───────────────────────────────────────────────────────────
  // onFocus: highlight + scroll — stream loads on OK press only.

  const handleChFocus = useCallback((ch: Channel, index: number) => {
    setHighlightedChId(ch.id);
    try {
      chListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
    } catch (_) {}
  }, []);

  const renderChannel: ListRenderItem<Channel> = useCallback(({ item, index }) => {
    const nowProg = nowPlayingMap.get(item.epgId ?? item.id) ?? nowPlayingMap.get(item.id);
    const isHighlighted = highlightedChId === item.id;
    return (
      <FocusablePressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={item.name}
        focusedStyle={styles.focusedItem}
        style={[
          styles.chItem,
          { borderBottomColor: colors.border },
          isHighlighted && { borderLeftColor: FOCUS_BORDER, borderLeftWidth: 3 },
        ]}
        onFocus={() => handleChFocus(item, index)}
        onPress={() => {
          onChannelSelect(item);
          setHighlightedChId(item.id);
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
          <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          {nowProg ? (
            <Text style={[styles.chNow, { color: colors.mutedForeground }]} numberOfLines={1}>
              {nowProg}
            </Text>
          ) : null}
        </View>
      </FocusablePressable>
    );
  }, [highlightedChId, nowPlayingMap, colors, handleChFocus, onChannelSelect]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
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
            getItemLayout={(_, i) => ({ length: CH_ITEM_H, offset: CH_ITEM_H * i, index: i })}
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
            {/* 3a — Video preview (OK = full screen) */}
            <FocusablePressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Watch fullscreen — press OK"
              focusedStyle={styles.videoFocused}
              style={styles.videoWrap}
              onPress={onWatchFullscreen}
            >
              <VideoView
                key={videoKey}
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls={false}
              />

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

              <View style={styles.videoHintBar}>
                <Text style={styles.videoHintText}>▶  OK to go full screen</Text>
              </View>
            </FocusablePressable>

            {/* Channel name + current programme info bar */}
            <View style={[styles.infoBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
              <Text style={[styles.infoChannelName, { color: colors.foreground }]} numberOfLines={1}>
                {selectedChannel.name}
              </Text>
              {currentProg ? (
                <Text style={[styles.infoProgName, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {fmtTime(currentProg.start)}–{fmtTime(currentProg.end)}  {currentProg.title}
                </Text>
              ) : null}
            </View>

            {/* 3b — Catchup */}
            {hasCatchup ? (
              <FocusablePressable
                accessible
                accessibilityRole="button"
                accessibilityLabel="Open catch-up TV"
                focusedStyle={styles.focusedItem}
                style={[styles.catchupRow, { backgroundColor: colors.card, borderColor: colors.border }]}
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

            {/* 3c — Mini TV guide (info only, not interactive) */}
            {channelEpg.length > 0 ? (
              <View style={[styles.guideWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.guideHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
                  TV GUIDE
                </Text>
                {channelEpg.map((prog, i) => {
                  const isNow = prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
                  return (
                    <View
                      key={i}
                      style={[
                        styles.guideItem,
                        { borderBottomColor: colors.border },
                        isNow && { backgroundColor: colors.secondary },
                      ]}
                    >
                      <Text
                        style={[
                          styles.guideTime,
                          { color: isNow ? colors.primary : colors.mutedForeground },
                        ]}
                      >
                        {fmtTime(prog.start)}{isNow ? ' ●' : ''}
                      </Text>
                      <Text
                        style={[styles.guideTitle, { color: colors.foreground }]}
                        numberOfLines={1}
                      >
                        {prog.title}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

// ── Layout constants ──────────────────────────────────────────────────────────

const CAT_ITEM_H = 52;
const CH_ITEM_H  = 58;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
  },

  // ── Panel 1 — Categories ──
  catPanel: {
    width: '20%',
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

  videoHintBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
  },

  videoHintText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
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
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },

  // ── Focus ring (shared) ──
  focusedItem: {
    borderWidth: 2,
    borderColor: FOCUS_BORDER,
  },
});
