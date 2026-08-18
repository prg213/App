import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { sidebarNav } from '@/lib/sidebarNav';
import { useFocusEffect } from 'expo-router';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import { Toast } from '@/components/Toast';
import type { Channel, RecentChannel } from '@/types';

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
}

function RecentCard({ item, index, channels, nowTitle, colors, onWatchFullscreen, onRemove }: CardProps) {
  const cardRef = useRef<View>(null);
  const ch = toChannel(item);

  return (
    <FocusablePressable
      ref={cardRef as any}
      style={styles.card}
      // TV: LEFT on the first card jumps to the sidebar nav menu
      nextFocusLeft={Platform.isTV && index === 0 ? sidebarNav.handle : undefined}
      onPress={() => onWatchFullscreen(ch, channels, index, cardRef)}
      onLongPress={() => onRemove(item.id)}
      delayLongPress={500}
    >
      {/* Logo area — 16:9 crop */}
      <View style={[styles.logoWrap, { backgroundColor: colors.secondary }]}>
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
      </View>

      <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>
        {item.name}
      </Text>
      {nowTitle ? (
        <Text style={[styles.epgTitle, { color: colors.mutedForeground }]} numberOfLines={1}>
          {nowTitle}
        </Text>
      ) : null}
    </FocusablePressable>
  );
}

export function RecentChannelsRail({
  blockedIds,
  nowPlayingMap,
  onWatchFullscreen,
  topInset = 0,
}: Props) {
  const colors = useColors();
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

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
        // TV dashboard: keep this strip as slim as possible — every saved
        // pixel goes to the poster rows below.
        Platform.isTV && styles.containerTV,
        { borderBottomColor: colors.border, paddingTop: topInset + (Platform.isTV ? 2 : 8) },
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
        data={recent}
        horizontal
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
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
    paddingTop: 2,
    paddingBottom: 4,
  },
  sectionHeaderTV: {
    marginBottom: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 9,
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

  logoWrap: {
    width: 88,
    height: 50,           // ≈ 16:9
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
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
