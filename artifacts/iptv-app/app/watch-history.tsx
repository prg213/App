import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import type { WatchHistoryEntry } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtProgress(position?: number, duration?: number): string {
  if (!position || !duration || duration === 0) return '';
  const pct = Math.round((position / duration) * 100);
  return `${pct}% watched`;
}

function fmtTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─── Swipeable row ────────────────────────────────────────────────────────────

interface RowProps {
  item: WatchHistoryEntry;
  colors: ReturnType<typeof useColors>;
  onDelete: (id: string) => void;
  onPress: (item: WatchHistoryEntry) => void;
}

const HistoryRow = React.memo(function HistoryRow({ item, colors, onDelete, onPress }: RowProps) {
  const swipeRef = useRef<Swipeable>(null);
  const progress = item.position && item.duration ? item.position / Math.max(item.duration, 1) : 0;

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      onPress={() => {
        swipeRef.current?.close();
        onDelete(item.id);
      }}
      activeOpacity={0.8}
    >
      <Text style={styles.deleteIcon}>🗑</Text>
      <Text style={styles.deleteLabel}>Remove</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      rightThreshold={60}
      overshootRight={false}
      friction={2}
    >
      <TouchableOpacity
        style={[styles.row, { backgroundColor: colors.background, borderBottomColor: colors.border }]}
        onPress={() => onPress(item)}
        activeOpacity={0.75}
      >
        {/* Thumbnail */}
        <View style={[styles.thumb, { backgroundColor: colors.secondary }]}>
          {item.cover ? (
            <Image source={{ uri: item.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <Text style={[styles.thumbIcon, { color: colors.mutedForeground }]}>
              {item.type === 'movie' ? '🎬' : '📺'}
            </Text>
          )}
          {/* Progress bar */}
          {progress > 0 && (
            <View style={styles.progressRail}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(2, Math.min(100, progress * 100))}%` as any },
                ]}
              />
            </View>
          )}
        </View>

        {/* Info */}
        <View style={styles.info}>
          <View style={styles.infoTop}>
            <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
              {item.title}
            </Text>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: item.type === 'movie' ? 'rgba(59,130,246,0.15)' : 'rgba(34,197,94,0.15)' },
              ]}
            >
              <Text
                style={[
                  styles.typeBadgeText,
                  { color: item.type === 'movie' ? '#3B82F6' : '#22C55E' },
                ]}
              >
                {item.type === 'movie' ? 'Movie' : 'Series'}
              </Text>
            </View>
          </View>

          <View style={styles.infoBottom}>
            {progress > 0 && (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {fmtProgress(item.position, item.duration)}
              </Text>
            )}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              {fmtTimestamp(item.timestamp)}
            </Text>
          </View>
        </View>

        {/* Swipe hint */}
        <Text style={[styles.swipeHint, { color: colors.mutedForeground }]}>‹</Text>
      </TouchableOpacity>
    </Swipeable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function WatchHistoryScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);

  const load = useCallback(async () => {
    const h = await StorageService.getWatchHistory();
    setHistory(h);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDelete = useCallback(async (id: string) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await StorageService.removeFromHistory(id);
    setHistory((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleClearAll = useCallback(() => {
    if (history.length === 0) return;
    Alert.alert(
      'Clear Watch History',
      'This will remove all watch history entries. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await StorageService.clearHistory();
            setHistory([]);
          },
        },
      ],
    );
  }, [history.length]);

  const handlePress = useCallback((item: WatchHistoryEntry) => {
    if (item.type === 'movie') {
      router.push({
        pathname: '/movie/[id]',
        params: { id: item.id, title: item.title, cover: item.cover ?? '' },
      });
    } else {
      router.push({
        pathname: '/series/[id]',
        params: {
          id: item.parentId ?? item.id,
          title: item.title.split(' - ')[0] ?? item.title,
          cover: item.cover ?? '',
        },
      });
    }
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: WatchHistoryEntry }) => (
      <HistoryRow item={item} colors={colors} onDelete={handleDelete} onPress={handlePress} />
    ),
    [colors, handleDelete, handlePress],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={[styles.backIcon, { color: colors.foreground }]}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Watch History</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {history.length > 0
              ? `${history.length} item${history.length === 1 ? '' : 's'} · Swipe left to remove`
              : 'No watch history yet'}
          </Text>
        </View>
        {history.length > 0 && (
          <TouchableOpacity onPress={handleClearAll} activeOpacity={0.7} style={styles.clearBtn}>
            <Text style={[styles.clearBtnText, { color: colors.destructive }]}>Clear All</Text>
          </TouchableOpacity>
        )}
      </View>

      {history.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📽️</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing here yet</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Movies and series you watch will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          removeClippedSubviews={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 22, lineHeight: 26 },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  clearBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  clearBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: {
    width: 60,
    aspectRatio: 2 / 3,
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  thumbIcon: { fontSize: 20 },
  progressRail: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 1.5 },

  info: { flex: 1, gap: 6 },
  infoTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  title: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 19 },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  typeBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  infoBottom: { flexDirection: 'row', gap: 10 },
  meta: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  swipeHint: { fontSize: 16, opacity: 0.35 },

  deleteAction: {
    backgroundColor: '#EF4444',
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  deleteIcon: { fontSize: 20 },
  deleteLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
    letterSpacing: 0.3,
  },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
