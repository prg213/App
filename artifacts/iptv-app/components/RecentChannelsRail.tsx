import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { sidebarNav } from '@/lib/sidebarNav';
import { tvRowNav } from '@/lib/tvRowNav';
import {
  RAIL_TV_PADDING_TOP_EXTRA,
  RAIL_TV_PADDING_BOTTOM,
  RAIL_TV_HEADER_MARGIN_BOTTOM,
  RAIL_TV_HEADER_FONT_SIZE,
  RAIL_TV_CARD_HEIGHT,
  TV_BANNER_LIST_GAP,
  TV_BANNER_LIST_PADDING_VERTICAL,
  TV_SECTION_MARGIN_TOP,
} from '@/lib/tvHomeLayout';
import { useFocusEffect } from 'expo-router';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import { Toast } from '@/components/Toast';
import type { Channel, RecentChannel } from '@/types';
import { LinearGradient } from 'expo-linear-gradient';

/** Convert a stored RecentChannel to a Channel so it can be passed to handlers. */
function toChannel(rc: RecentChannel): Channel {
  return {
    id: rc.id,
    name: rc.name,
    logo: rc.logo,
    groupTitle: rc.groupTitle,
    streamUrl: rc.streamUrl,
    epgId: rc.epgId,
  };
}

interface Props {
  /** IDs of channels that are blocked by parental controls — excluded from the rail. */
  blockedIds: Set<string>;
  /** Map from EPG channel ID → currently airing programme title. */
  nowPlayingMap: Map<string, string>;
  /**
   * Called when the user taps a card — goes straight to fullscreen with expand animation.
   * `channels` is the full visible list (for prev/next navigation) and `index` is
   * the tapped channel's position within that list.
   */
  onWatchFullscreen: (ch: Channel, channels: Channel[], index: number, cardRef: React.RefObject<View | null>) => void;
  /** Safe-area top inset — applied as paddingTop so the rail clears the status bar. */
  topInset?: number;
  /** TV Home uses the first card as the sidebar RIGHT destination. */
  onFirstCardRef?: (node: View | null) => void;
  /** Shared TV Home poster geometry. */
  tvCardStyle?: any;
  tvItemStride?: number | null;
  onTvRailLayout?: (event: any) => void;
  onTvItemCountChange?: (count: number) => void;
}

// ── Per-card component so each card has its own measured ref ──────────────────

interface CardProps {
  item: RecentChannel;
  index: number;
  channels: Channel[];
  nowTitle: string | undefined;
  colors: ReturnType<typeof useColors>;
  onWatchFullscreen: (ch: Channel, channels: Channel[], index: number, cardRef: React.RefObject<View | null>) => void;
  onRemove: (id: string) => void;
  onCardFocus?: () => void;
  onFirstCardRef?: (node: View | null) => void;
  isLast: boolean;
  tvCardStyle?: any;
}

function RecentCard({ item, index, channels, nowTitle, colors, onWatchFullscreen, onRemove, onCardFocus, onFirstCardRef, isLast, tvCardStyle }: CardProps) {
  const cardRef = useRef<View>(null);
  const ch = toChannel(item);
  const isTvPoster = Platform.isTV && tvCardStyle != null;
  const setCardRef = useCallback((el: View | null) => {
    cardRef.current = el;
    if (Platform.isTV) {
      tvRowNav.register('recent', index, el);
      // Install the right-edge route as soon as the final native card mounts,
      // not only after it receives focus. This prevents Fire OS from briefly
      // applying its default wrap-to-first behavior on a fast D-pad press.
      if (el && isLast) tvRowNav.pinRightEdge('recent', index);
    }
    if (index === 0) onFirstCardRef?.(el);
  }, [index, isLast, onFirstCardRef]);

  return (
    <FocusablePressable
      ref={setCardRef as any}
      style={isTvPoster ? tvCardStyle : styles.card}
      focusedStyle={Platform.isTV ? styles.tvCardFocused : undefined}
      // TV: LEFT on the first card jumps to the sidebar nav menu
      nextFocusLeft={Platform.isTV && index === 0 ? sidebarNav.handle : undefined}
      onFocus={onCardFocus}
      onPress={() => onWatchFullscreen(ch, channels, index, cardRef)}
      onLongPress={() => onRemove(item.id)}
      delayLongPress={500}
    >
      {/* TV uses the shared Home poster size instead of a separate slim strip. */}
      <View style={[
        styles.logoWrap,
        isTvPoster && styles.tvLogoWrap,
        { backgroundColor: colors.secondary },
      ]}>
        {item.logo ? (
          <Image
            source={{ uri: item.logo }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        ) : (
          <Text style={[styles.initials, { color: colors.primary }]}>
            {item.name.slice(0, 2).toUpperCase()}
          </Text>
        )}
        {/* Live badge */}
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
        </View>
        {isTvPoster && (
          <>
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.88)']}
              style={styles.tvCardGrad}
            />
            <View style={styles.tvCardInfo}>
              <Text style={[styles.chName, styles.tvCardText, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              {nowTitle ? (
                <Text style={[styles.epgTitle, styles.tvCardText, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {nowTitle}
                </Text>
              ) : null}
            </View>
          </>
        )}
      </View>

      {!isTvPoster && (
        <>
          <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name}
          </Text>
          {nowTitle ? (
            <Text style={[styles.epgTitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              {nowTitle}
            </Text>
          ) : null}
        </>
      )}
    </FocusablePressable>
  );
}

export function RecentChannelsRail({
  blockedIds,
  nowPlayingMap,
  onWatchFullscreen,
  topInset = 0,
  onFirstCardRef,
  tvCardStyle,
  tvItemStride,
  onTvRailLayout,
  onTvItemCountChange,
}: Props) {
  const colors = useColors();
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const isTvGrid = Platform.isTV && tvCardStyle != null;
  // TV: glide the rail so the focused card stays in view (Fire OS doesn't
  // reliably auto-scroll virtualized horizontal lists on D-pad focus moves).
  const listRef = useRef<FlatList<RecentChannel>>(null);
  const CARD_STRIDE = 88 + 8; // card width + list gap

  useEffect(() => {
    onTvItemCountChange?.(recent.length);
  }, [onTvItemCountChange, recent.length]);

  useFocusEffect(
    useCallback(() => {
      StorageService.getRecentChannels().then((all) => {
        const visible = all
          .filter((ch) => !blockedIds.has(ch.id))
          .slice(0, 8);
        setRecent(visible);
      });
    }, [blockedIds]),
  );

  const handleRemove = useCallback(async (id: string) => {
    const ch = recent.find((c) => c.id === id);
    await StorageService.removeFromRecentChannels(id);
    setRecent((prev) => prev.filter((c) => c.id !== id));
    if (ch) setToastMsg(`"${ch.name}" removed from recently watched`);
  }, [recent]);

  const handleClearAll = useCallback(async () => {
    await StorageService.clearRecentChannels();
    setRecent([]);
  }, []);

  if (recent.length === 0) return null;

  return (
    <View
      style={[
        styles.container,
        // TV dashboard: this is a full grid row with the same geometry as the
        // movie and series rails.
        isTvGrid && styles.containerTV,
        { borderBottomColor: colors.border, paddingTop: topInset + (Platform.isTV ? RAIL_TV_PADDING_TOP_EXTRA : 8) },
      ]}
    >
      <View style={[styles.sectionHeader, Platform.isTV && styles.sectionHeaderTV]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          RECENTLY WATCHED
        </Text>
        <FocusablePressable onPress={handleClearAll} hitSlop={8}>
          <Text style={[styles.clearAll, { color: colors.mutedForeground }]}>Clear all</Text>
        </FocusablePressable>
      </View>
      <FlatList
        ref={listRef}
        data={recent}
        horizontal
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        onLayout={isTvGrid ? onTvRailLayout : undefined}
        getItemLayout={(_, i) => {
          const stride = isTvGrid ? (tvItemStride ?? CARD_STRIDE) : CARD_STRIDE;
          return { length: stride, offset: stride * i, index: i };
        }}
        contentContainerStyle={isTvGrid ? styles.tvList : styles.list}
        renderItem={({ item, index }) => {
          const epgKey = item.epgId ?? item.id;
          const nowTitle = nowPlayingMap.get(epgKey);
          // Build the full channel list once per render so every card gets
          // the same reference for prev/next navigation.
          const channelList = recent.map(toChannel);
          return (
            <RecentCard
              item={item}
              index={index}
              channels={channelList}
              nowTitle={nowTitle}
              colors={colors}
              onWatchFullscreen={onWatchFullscreen}
              onRemove={handleRemove}
              onFirstCardRef={onFirstCardRef}
              isLast={index === recent.length - 1}
              tvCardStyle={tvCardStyle}
              onCardFocus={Platform.isTV ? () => {
                tvRowNav.focused('recent', index, { pinRightEdge: index === recent.length - 1 });
                try {
                  listRef.current?.scrollToOffset({
                    offset: (tvItemStride ?? CARD_STRIDE) * index,
                    animated: false,
                  });
                } catch {}
              } : undefined}
            />
          );
        }}
      />
      {toastMsg !== null && (
        <Toast
          message={toastMsg}
          visible
          duration={2500}
          onHide={() => setToastMsg(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  containerTV: {
    flex: 1,
    minHeight: 0,
    marginTop: TV_SECTION_MARGIN_TOP,
    paddingTop: RAIL_TV_PADDING_TOP_EXTRA,
    paddingBottom: RAIL_TV_PADDING_BOTTOM,
  },
  sectionHeaderTV: {
    marginBottom: RAIL_TV_HEADER_MARGIN_BOTTOM,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: RAIL_TV_HEADER_FONT_SIZE,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
  },
  clearAll: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    opacity: 0.6,
  },
  list: { paddingHorizontal: 8, gap: 8 },
  card: { width: 88 },
  tvList: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: TV_BANNER_LIST_PADDING_VERTICAL,
    gap: TV_BANNER_LIST_GAP,
    alignItems: 'stretch',
  },

  logoWrap: {
    width: 88,
    height: RAIL_TV_CARD_HEIGHT,  // ≈ 16:9
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  tvLogoWrap: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  tvCardFocused: {
    borderColor: '#00E5FF',
    zIndex: 2,
    elevation: 4,
  },
  tvCardGrad: {
    ...StyleSheet.absoluteFill,
    top: '42%',
  },
  tvCardInfo: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 7,
  },
  tvCardText: {
    marginTop: 0,
  },
  initials: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  liveBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: '#EF4444',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    backgroundColor: '#EF4444',
  },

  chName: {
    marginTop: 5,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 13,
  },
  epgTitle: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
    lineHeight: 12,
  },
});
