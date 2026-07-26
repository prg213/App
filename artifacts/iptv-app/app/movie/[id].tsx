import React from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { getXtreamVodInfo, getXtreamVodUrl } from '@/services/xtreamApi';

export default function MovieDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();

  const params = useLocalSearchParams<{
    id: string;
    title: string;
    cover: string;
    genre: string;
    rating: string;
    plot: string;
    cast: string;
    director: string;
    releaseDate: string;
    duration: string;
    ext: string;
  }>();

  const isXtream =
    credentials?.type === 'xtream' &&
    !!credentials.host &&
    !!credentials.username &&
    !!credentials.password;

  // Fetch full VOD info to get plot/cast/director when not passed via params
  const needsInfo = isXtream && (!params.plot || !params.cast);
  const { data: vodInfo, isLoading: infoLoading } = useQuery({
    queryKey: ['vod-info', params.id, credentials],
    queryFn: () =>
      getXtreamVodInfo(
        { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
        params.id,
      ),
    enabled: needsInfo,
    staleTime: 15 * 60_000,
  });

  // Merge params with fetched info — params take priority if present
  const cover = params.cover || vodInfo?.cover || '';
  const plot = params.plot || vodInfo?.plot || '';
  const cast = params.cast || vodInfo?.cast || '';
  const director = params.director || vodInfo?.director || '';
  const genre = params.genre || vodInfo?.genre || '';
  const rating = params.rating || vodInfo?.rating || '';
  const releaseDate = params.releaseDate || vodInfo?.releaseDate || '';
  const duration = params.duration || vodInfo?.duration || '';
  const ext = params.ext || vodInfo?.containerExtension || 'mp4';

  const handlePlay = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let url = '';
    if (isXtream) {
      url = getXtreamVodUrl(
        { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
        params.id,
        ext,
      );
    }
    if (!url) return;
    router.push({
      pathname: '/player',
      params: { url, title: params.title, type: 'vod', logo: cover },
    });
  };

  const year = releaseDate?.slice(0, 4);
  const ratingNum = rating ? parseFloat(rating) : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20) }}>
        {/* Backdrop */}
        <View style={styles.backdrop}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ fontSize: 48, color: colors.mutedForeground }}>🎬</Text>
            </View>
          )}
          <LinearGradient
            colors={['transparent', 'rgba(10,10,15,0.6)', colors.background]}
            style={StyleSheet.absoluteFill}
            locations={[0.3, 0.7, 1]}
          />
          {/* Back button */}
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
          {/* Badges */}
          <View style={styles.metaRow}>
            {year ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{year}</Text>
              </View>
            ) : null}
            {duration ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{duration}</Text>
              </View>
            ) : null}
            {ratingNum > 0 ? (
              <View style={[styles.metaBadge, { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)' }]}>
                <Text style={[styles.metaText, { color: '#F59E0B' }]}>★ {ratingNum.toFixed(1)}</Text>
              </View>
            ) : null}
            {genre ? (
              <View style={[styles.metaBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>{genre.split(',')[0]}</Text>
              </View>
            ) : null}
          </View>

          {/* Title */}
          <Text style={[styles.titleText, { color: colors.foreground }]}>{params.title}</Text>

          {/* Play Button */}
          <TouchableOpacity style={styles.playBtn} onPress={handlePlay} activeOpacity={0.85}>
            <Text style={styles.playIcon}>▶</Text>
            <Text style={styles.playLabel}>Play</Text>
          </TouchableOpacity>

          {/* Plot */}
          {infoLoading && needsInfo ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 8 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.plot, { color: colors.mutedForeground }]}>Loading synopsis…</Text>
            </View>
          ) : plot ? (
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SYNOPSIS</Text>
              <Text style={[styles.plot, { color: colors.foreground }]}>{plot}</Text>
            </View>
          ) : null}

          {/* Details */}
          {(director || cast) && (
            <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {director ? (
                <View style={[styles.detailRow, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Director</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]}>{director}</Text>
                </View>
              ) : null}
              {cast ? (
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Cast</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground }]} numberOfLines={3}>{cast}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backdrop: {
    height: 300,
    position: 'relative',
  },
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
  content: {
    paddingHorizontal: 20,
    gap: 16,
    marginTop: -20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  metaText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  titleText: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#3B82F6',
    borderRadius: 14,
    paddingVertical: 15,
  },
  playIcon: { fontSize: 18, color: '#fff' },
  playLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
  },
  plot: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  detailsCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    width: 70,
    flexShrink: 0,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
});
