import React, { useCallback, useState } from 'react';
import {
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
}

export function ContinueWatchingRail({ type }: Props) {
  const colors = useColors();
  const router = useRouter();
  const [history, setHistory] = useState<WatchHistoryEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      StorageService.getWatchHistory().then((h) => {
        const filtered = h
          .filter((e) => {
            if (!e.position || !e.duration || e.position <= 0) return false;
            if (type && e.type !== type) return false;
            return true;
          })
          .slice(0, 10);
        setHistory(filtered);
      });
    }, [type]),
  );

  if (history.length === 0) return null;

  return (
    <View style={[styles.container, { borderBottomColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        CONTINUE WATCHING
      </Text>
      <FlatList
        data={history}
        horizontal
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const progress = (item.position ?? 0) / Math.max(item.duration ?? 1, 1);

          const handlePress = () => {
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
          };

          return (
            <TouchableOpacity style={styles.card} onPress={handlePress} activeOpacity={0.75}>
              <View style={[styles.thumb, { backgroundColor: colors.secondary }]}>
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
                {/* Progress bar */}
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
        }}
      />
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
});
