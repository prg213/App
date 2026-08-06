import React, { useCallback, useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import { Toast } from '@/components/Toast';
import type { WatchHistoryEntry } from '@/types';

function fmtSecs(secs: number) {
  const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

interface Props {
  /** Filter to only movie or series entries. Omit to show all. */
  type?: 'movie' | 'series';
  /** When true, renders as a full-page content area (no bottom border, larger cards). */
  fullPage?: boolean;
}

export function ContinueWatchingRail({ type, fullPage }: Props) {
  const colors = useColors();
  const router = useRouter();
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // loadHistory declared first so the hooks below can list it as a dependency
  // without hitting the temporal dead zone.
  const loadHistory = useCallback(() => {
    StorageService.getWatchHistory().then((h) => {
      const filtered = h
        .filter((e) => {
          if (!e.position || !e.duration || e.position <= 0) return false;
          // Exclude entries that are 95%+ complete — considered fully watched
          if (e.position / e.duration >= 0.95) return false;
          if (type && e.type !== type) return false;
          return true;
        })
        .slice(0, 10);
      setHistory(filtered);
    });
  }, [type]);

  useFocusEffect(useCallback(() => { loadHistory(); }, [loadHistory]));

  // Refresh instantly when settings clears history (no re-focus needed)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('history:cleared', loadHistory);
    return () => sub.remove();
  }, [loadHistory]);

  const handleClearAll = useCallback(async () => {
    // Preserve entries that don't match this rail's type
    const all = await StorageService.getWatchHistory();
    const keep = type ? all.filter((e) => e.type !== type) : [];
    await StorageService.clearHistory();
    for (const e of keep) await StorageService.addToHistory(e);
    // Re-load display from storage so it reflects the cleared+restored state
    loadHistory();
    setToastMsg('Continue Watching cleared');
  }, [type, loadHistory]);

  // In full-page mode show an empty state; in rail mode return null (hidden)
  if (history.length === 0) {
    if (!fullPage) return null;
    return (
      <View style={styles.emptyPage}>
        <Text style={[styles.emptyIcon, { color: colors.mutedForeground }]}>▶</Text>
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing to continue</Text>
        <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
          Start watching something and it will appear here.
        </Text>
      </View>
    );
  }

  const cardStyle = fullPage ? styles.cardLarge : styles.card;
  const thumbStyle = fullPage ? styles.thumbLarge : styles.thumb;

  const renderCard = ({ item }: { item: WatchHistoryEntry }) => {
    const progress = (item.position ?? 0) / Math.max(item.duration ?? 1, 1);

    const handlePress = () => {
      if (item.type === 'movie') {
        router.push({
          pathname: '/movie/[id]',
          params: {
            id: item.id,
            title: item.title,
            cover: item.cover ?? '',
            resumePosition: String(Math.floor(item.position ?? 0)),
          },
        });
      } else {
        router.push({
          pathname: '/series/[id]',
          params: {
            id: item.parentId ?? item.id,
            title: (item.title ?? '').split(' - ')[0] || (item.title ?? ''),
            cover: item.cover ?? '',
            resumeEpisodeId: item.id,
            resumePosition: String(Math.floor(item.position ?? 0)),
          },
        });
      }
    };

    const handleRemove = () => {
      StorageService.removeFromHistory(item.id).then(() => {
        setHistory((prev) => prev.filter((e) => e.id !== item.id));
        setToastMsg(`"${item.title}" removed from Continue Watching`);
      }).catch(() => {});
    };

    return (
      <TouchableOpacity
        style={cardStyle}
        onPress={handlePress}
        onLongPress={handleRemove}
        delayLongPress={500}
        activeOpacity={0.75}
      >
        <View style={[thumbStyle, { backgroundColor: colors.secondary }]}>
          {item.cover ? (
            <Image
              source={{ uri: item.cover }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <Text style={[styles.thumbIcon, { color: colors.mutedForeground }]}>
              {item.type === 'movie' ? '🎬' : '📺'}
            </Text>
          )}
          <View style={styles.progressRail}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(2, Math.min(100, progress * 100))}%` as any },
              ]}
            />
          </View>
        </View>
        <Text
          style={[styles.cardTitle, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        {item.position ? (
          <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>
            {fmtSecs(item.position)}
            {item.duration ? ` / ${fmtSecs(item.duration)}` : ''}
          </Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, !fullPage && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.header}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
          CONTINUE WATCHING
        </Text>
        <TouchableOpacity onPress={handleClearAll} hitSlop={8} activeOpacity={0.6}>
          <Text style={[styles.clearAll, { color: colors.mutedForeground }]}>Clear all</Text>
        </TouchableOpacity>
      </View>
      {toastMsg !== null && (
        <Toast message={toastMsg} visible duration={2500} onHide={() => setToastMsg(null)} />
      )}
      <FlatList
        data={history}
        horizontal={!fullPage}
        numColumns={fullPage ? 4 : undefined}
        key={fullPage ? 'grid' : 'rail'}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={fullPage ? styles.gridList : styles.list}
        renderItem={renderCard}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5 },
  clearAll: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  // Rail (horizontal) layout
  list: { paddingHorizontal: 8, gap: 8 },
  card: { width: 92 },
  thumb: {
    width: 92,
    aspectRatio: 2 / 3,
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  // Grid (full-page) layout
  gridList: { paddingHorizontal: 8, gap: 10 },
  cardLarge: { flex: 1, margin: 4 },
  thumbLarge: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  thumbIcon: { fontSize: 22 },
  progressRail: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 1.5,
  },
  cardTitle: {
    marginTop: 5,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    lineHeight: 14,
  },
  cardTime: {
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  // Empty state (full-page only)
  emptyPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyIcon: { fontSize: 36 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', opacity: 0.6 },
});
