import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
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
  /** Called when the user taps a card — goes straight to fullscreen with expand animation. */
  onWatchFullscreen: (ch: Channel, cardRef: React.RefObject<View | null>) => void;
  /** Safe-area top inset — applied as paddingTop so the rail clears the status bar. */
  topInset?: number;
}

// ── Per-card component so each card has its own measured ref ──────────────────

interface CardProps {
  item: RecentChannel;
  nowTitle: string | undefined;
  colors: ReturnType<typeof useColors>;
  onWatchFullscreen: (ch: Channel, cardRef: React.RefObject<View | null>) => void;
  onRemove: (id: string) => void;
}

function RecentCard({ item, nowTitle, colors, onWatchFullscreen, onRemove }: CardProps) {
  const cardRef = useRef<View>(null);
  const ch = toChannel(item);

  return (
    <TouchableOpacity
      ref={cardRef as any}
      style={styles.card}
      onPress={() => onWatchFullscreen(ch, cardRef)}
      onLongPress={() => onRemove(item.id)}
      delayLongPress={500}
      activeOpacity={0.75}
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
    </TouchableOpacity>
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

  if (recent.length === 0) return null;

  return (
    <View style={[styles.container, { borderBottomColor: colors.border, paddingTop: topInset + 8 }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        RECENTLY WATCHED
      </Text>
      <FlatList
        data={recent}
        horizontal
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const epgKey = item.epgId ?? item.id;
          const nowTitle = nowPlayingMap.get(epgKey);
          return (
            <RecentCard
              item={item}
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
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
    marginBottom: 8,
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
