import React, { useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { getXtreamSeriesInfo, getXtreamSeriesUrl } from '@/services/xtreamApi';
import type { Episode } from '@/types';

export default function SeriesDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();

  const params = useLocalSearchParams<{
    id: string;
    title: string;
    cover: string;
    rating: string;
    genre: string;
    plot: string;
    cast: string;
    director: string;
  }>();

  const [selectedSeason, setSelectedSeason] = useState(0);

  const isXtream =
    credentials?.type === 'xtream' &&
    !!credentials.host &&
    !!credentials.username &&
    !!credentials.password;

  const { data, isLoading } = useQuery({
    queryKey: ['series-info', params.id, credentials],
    queryFn: () =>
      getXtreamSeriesInfo(
        { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
        params.id,
      ),
    enabled: isXtream,
    staleTime: 10 * 60_000,
  });

  const seasons = data?.seasons ?? [];
  const activeSeason = seasons[selectedSeason];

  const handlePlayEpisode = (ep: Episode) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = getXtreamSeriesUrl(
      { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
      ep.streamId,
      ep.containerExtension,
    );
    router.push({
      pathname: '/player',
      params: {
        url,
        title: `${params.title} - ${ep.title}`,
        type: 'series',
        logo: ep.info?.cover ?? params.cover ?? '',
      },
    });
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20) }}
      >
        {/* Backdrop */}
        <View style={styles.backdrop}>
          {params.cover ? (
            <Image source={{ uri: params.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ fontSize: 48, color: colors.mutedForeground }}>📺</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(10,10,15,0.6)', colors.background]}
            style={StyleSheet.absoluteFill}
            locations={[0.3, 0.7, 1]}
          />
          <TouchableOpacity
            style={[styles.backBtn, { top: insets.top + (Platform.OS === 'web' ? 67 : 8) }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Meta */}
          <View style={styles.metaRow}>
            {params.rating && parseFloat(params.rating) > 0 ? (
              <View style={[styles.metaBadge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)' }]}>
                <Text style={[styles.metaText, { color: '#F59E0B' }]}>★ {parseFloat(params.rating).toFixed(1)}</Text>
              </View>
            ) : null}
            {params.genre ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{params.genre.split(',')[0]}</Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.titleText, { color: colors.foreground }]}>{params.title}</Text>

          {params.plot ? (
            <Text style={[styles.plot, { color: colors.mutedForeground }]} numberOfLines={4}>
              {params.plot}
            </Text>
          ) : null}

          {/* Seasons */}
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading episodes...</Text>
            </View>
          ) : seasons.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No episodes available</Text>
            </View>
          ) : (
            <>
              {/* Season Tabs */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonTabs}>
                {seasons.map((season, idx) => (
                  <TouchableOpacity
                    key={season.id}
                    style={[
                      styles.seasonTab,
                      {
                        backgroundColor: idx === selectedSeason ? colors.primary : colors.secondary,
                        borderColor: idx === selectedSeason ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedSeason(idx)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.seasonTabText, { color: idx === selectedSeason ? '#fff' : colors.mutedForeground }]}>
                      S{season.seasonNumber}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Episodes */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                {activeSeason?.name.toUpperCase()} — {activeSeason?.episodes.length ?? 0} EPISODES
              </Text>
              {activeSeason?.episodes.map((ep) => (
                <TouchableOpacity
                  key={ep.id}
                  style={[styles.episodeRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handlePlayEpisode(ep)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.epNumBox, { backgroundColor: colors.secondary }]}>
                    <Text style={[styles.epNum, { color: colors.primary }]}>
                      {String(ep.episodeNum).padStart(2, '0')}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={[styles.epTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {ep.title}
                    </Text>
                    {ep.info?.duration && (
                      <Text style={[styles.epDuration, { color: colors.mutedForeground }]}>
                        {ep.info.duration}
                      </Text>
                    )}
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>▶</Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backdrop: { height: 180, position: 'relative' },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: { fontSize: 20, color: '#fff' },
  content: { paddingHorizontal: 20, gap: 14, marginTop: -20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  metaText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  titleText: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  plot: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  loadingRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  seasonTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
  },
  seasonTab: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  seasonTabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    marginTop: 4,
  },
  episodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  epNumBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  epNum: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  epTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 },
  epDuration: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
