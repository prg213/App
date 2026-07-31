import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { PinPad } from '@/components/PinPad';
import { StorageService } from '@/services/storage';
import { getXtreamSeriesInfo, getXtreamSeriesUrl } from '@/services/xtreamApi';
import type { Episode, WatchHistoryEntry } from '@/types';

function StarRating({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <Text style={styles.stars}>
      {Array.from({ length: 5 }, (_, i) =>
        i < filled ? '★' : '☆'
      ).join('')}
    </Text>
  );
}

export default function SeriesDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { maxRating, verifyPin } = useParentalContext();
  const [showEpPinGate, setShowEpPinGate] = useState(false);
  const [pendingEpisode, setPendingEpisode] = useState<{ ep: Episode; startAt?: number } | null>(null);

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
  const [isFav, setIsFav] = useState(false);
  const [episodeHistory, setEpisodeHistory] = useState<Record<string, WatchHistoryEntry>>({});

  const isXtream =
    credentials?.type === 'xtream' &&
    !!credentials.host &&
    !!credentials.username &&
    !!credentials.password;

  useFocusEffect(
    useCallback(() => {
      StorageService.getSeriesFavorites().then((favs) => {
        setIsFav(favs.some((f) => f.id === params.id));
      });
      StorageService.getWatchHistory().then((h) => {
        const map: Record<string, WatchHistoryEntry> = {};
        h.filter((e) => e.type === 'series').forEach((e) => { map[e.id] = e; });
        setEpisodeHistory(map);
      });
    }, [params.id]),
  );

  const handleToggleFav = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleSeriesFavorite({
      id: params.id,
      name: params.title,
      cover: params.cover || undefined,
      rating: params.rating || undefined,
      genre: params.genre || undefined,
      categoryId: '',
      plot: params.plot || undefined,
      cast: params.cast || undefined,
      director: params.director || undefined,
    });
    setIsFav(updated.some((f) => f.id === params.id));
  };

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

  const doPlayEpisode = useCallback((ep: Episode, startAt?: number) => {
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
        contentId: ep.streamId,
        parentId: params.id,
        ...(startAt !== undefined ? { startAt: String(startAt) } : {}),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentials, params.id, params.title, params.cover, router]);

  const handlePlayEpisode = (ep: Episode, startAt?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const epRating = ep.info?.rating;
    if (isContentBlocked(epRating, maxRating)) {
      setPendingEpisode({ ep, startAt });
      setShowEpPinGate(true);
      return;
    }
    doPlayEpisode(ep, startAt);
  };

  const handlePlayFirst = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const firstEp = activeSeason?.episodes[0];
    if (firstEp) handlePlayEpisode(firstEp);
  };

  const ratingNum = params.rating ? parseFloat(params.rating) : 0;
  const year = data?.info?.releaseDate?.slice(0, 4) ?? '';
  const director = params.director || data?.info?.director || '';
  const cast = params.cast || data?.info?.cast || '';
  const plot = params.plot || data?.info?.plot || '';
  const genre = params.genre || data?.info?.genre || '';

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24) }}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          {params.cover ? (
            <Image source={{ uri: params.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ fontSize: 52, color: colors.mutedForeground }}>📺</Text>
            </View>
          )}
          <LinearGradient
            colors={['rgba(0,0,0,0.25)', 'rgba(0,0,0,0.55)', colors.background]}
            style={StyleSheet.absoluteFill}
            locations={[0, 0.55, 1]}
          />

          {/* Back */}
          <TouchableOpacity
            style={[styles.navBtn, { top: insets.top + (Platform.OS === 'web' ? 67 : 10), left: 14 }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Text style={styles.navIcon}>←</Text>
          </TouchableOpacity>

          {/* Fav */}
          <TouchableOpacity
            style={[styles.navBtn, { top: insets.top + (Platform.OS === 'web' ? 67 : 10), right: 14 }]}
            onPress={handleToggleFav}
            activeOpacity={0.8}
          >
            <Text style={[styles.navIcon, { color: isFav ? '#EF4444' : '#fff' }]}>
              {isFav ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>

          {/* Poster + meta row */}
          <View style={styles.heroPosterRow}>
            {params.cover ? (
              <Image
                source={{ uri: params.cover }}
                style={[styles.poster, { borderColor: 'rgba(255,255,255,0.12)' }]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.poster, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontSize: 32 }}>📺</Text>
              </View>
            )}

            <View style={styles.heroMeta}>
              <Text style={styles.heroTitle} numberOfLines={3}>{params.title}</Text>
              {ratingNum > 0 && <StarRating value={ratingNum / 2} />}
              <View style={styles.heroBadgeRow}>
                {year ? <Text style={styles.heroBadge}>{year}</Text> : null}
                {genre ? <Text style={styles.heroBadge}>{genre.split(',')[0].trim()}</Text> : null}
              </View>
              {director ? (
                <Text style={styles.heroDetail} numberOfLines={2}>
                  <Text style={styles.heroDetailLabel}>Director  </Text>{director}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* ── Action bar ── */}
        <View style={[styles.actionBar, { paddingHorizontal: 16 }]}>
          <TouchableOpacity
            style={[styles.playBtn, { opacity: !activeSeason ? 0.4 : 1 }]}
            onPress={handlePlayFirst}
            activeOpacity={0.85}
            disabled={!activeSeason}
          >
            <Text style={styles.playIcon}>▶</Text>
            <Text style={styles.playLabel}>
              Play · S{(activeSeason?.seasonNumber ?? 1)}:E1
            </Text>
          </TouchableOpacity>

          {/* Season selector */}
          {seasons.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonRow}>
              {seasons.map((season, idx) => (
                <TouchableOpacity
                  key={season.id}
                  style={[
                    styles.seasonChip,
                    {
                      backgroundColor: idx === selectedSeason ? colors.primary : colors.secondary,
                      borderColor: idx === selectedSeason ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSeason(idx); }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.seasonChipText, { color: idx === selectedSeason ? '#fff' : colors.mutedForeground }]}>
                    Season {season.seasonNumber}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* ── Plot ── */}
        {plot ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SYNOPSIS</Text>
            <Text style={[styles.plot, { color: colors.foreground }]}>{plot}</Text>
          </View>
        ) : null}

        {/* ── Cast ── */}
        {cast ? (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.infoRow, { borderBottomWidth: director ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Cast</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={3}>{cast}</Text>
            </View>
            {director ? (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Director</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={2}>{director}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* ── Episodes ── */}
        <View style={styles.section}>
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading episodes…</Text>
            </View>
          ) : seasons.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No episodes available</Text>
            </View>
          ) : (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                {activeSeason?.name?.toUpperCase()} · {activeSeason?.episodes.length ?? 0} EPISODES
              </Text>
              {activeSeason?.episodes.map((ep) => {
                const hist = episodeHistory[ep.streamId];
                const histProgress = hist?.position && hist?.duration
                  ? hist.position / hist.duration : 0;
                const epRating = ep.info?.rating ? parseFloat(ep.info.rating) : 0;

                return (
                  <TouchableOpacity
                    key={ep.id}
                    style={[styles.epRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handlePlayEpisode(ep)}
                    activeOpacity={0.75}
                  >
                    {/* Thumbnail */}
                    <View style={[styles.epThumb, { backgroundColor: colors.secondary }]}>
                      {ep.info?.cover ? (
                        <Image source={{ uri: ep.info.cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      ) : (
                        <Text style={{ fontSize: 20 }}>📺</Text>
                      )}
                      <View style={styles.epPlayOverlay}>
                        <Text style={styles.epPlayIcon}>▶</Text>
                      </View>
                    </View>

                    {/* Info */}
                    <View style={styles.epInfo}>
                      <Text style={[styles.epTitle, { color: colors.foreground }]} numberOfLines={2}>
                        {`S${String(activeSeason.seasonNumber).padStart(2,'0')}E${String(ep.episodeNum).padStart(2,'0')} · ${ep.title}`}
                      </Text>
                      <View style={styles.epMetaRow}>
                        {epRating > 0 && (
                          <Text style={styles.epStars}>
                            {'★'.repeat(Math.round(epRating / 2))}{'☆'.repeat(5 - Math.round(epRating / 2))}
                          </Text>
                        )}
                        {ep.info?.duration && (
                          <View style={[styles.durationBadge, { backgroundColor: colors.secondary }]}>
                            <Text style={[styles.durationText, { color: colors.mutedForeground }]}>
                              {ep.info.duration}
                            </Text>
                          </View>
                        )}
                      </View>
                      {ep.info?.plot ? (
                        <Text style={[styles.epPlot, { color: colors.mutedForeground }]} numberOfLines={2}>
                          {ep.info.plot}
                        </Text>
                      ) : null}
                      {histProgress > 0.02 && (
                        <View style={[styles.progressRail, { backgroundColor: colors.secondary }]}>
                          <View style={[styles.progressFill, { width: `${Math.min(100, histProgress * 100)}%` as any }]} />
                        </View>
                      )}
                    </View>

                    {/* Resume / play */}
                    {hist?.position && hist.position > 5 ? (
                      <TouchableOpacity
                        style={[styles.resumeBtn, { borderColor: colors.primary }]}
                        onPress={() => handlePlayEpisode(ep, hist.position)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.resumeLabel, { color: colors.primary }]}>Resume</Text>
                      </TouchableOpacity>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showEpPinGate}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setShowEpPinGate(false)}
      >
        <PinPad
          mode="verify"
          title="Age-Restricted Content"
          subtitle="Enter your PIN to play this episode"
          verify={verifyPin}
          onSuccess={() => {
            setShowEpPinGate(false);
            if (pendingEpisode) doPlayEpisode(pendingEpisode.ep, pendingEpisode.startAt);
            setPendingEpisode(null);
          }}
          onCancel={() => { setShowEpPinGate(false); setPendingEpisode(null); }}
        />
      </Modal>
    </View>
  );
}

const HERO_H = 290;
const POSTER_W = 108;
const POSTER_H = 152;

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Hero ──
  hero: { height: HERO_H, position: 'relative' },
  navBtn: {
    position: 'absolute',
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center',
  },
  navIcon: { fontSize: 18, color: '#fff' },
  heroPosterRow: {
    position: 'absolute',
    bottom: 0, left: 14, right: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 14,
  },
  poster: {
    width: POSTER_W, height: POSTER_H,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    flexShrink: 0,
  },
  heroMeta: { flex: 1, paddingBottom: 6, gap: 5 },
  heroTitle: {
    fontSize: 20, fontFamily: 'Inter_700Bold',
    color: '#fff', lineHeight: 26, letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  stars: { fontSize: 13, color: '#F59E0B', letterSpacing: 2 },
  heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroBadge: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 5,
  },
  heroDetail: { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', lineHeight: 16 },
  heroDetailLabel: { fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.45)' },

  // ── Action bar ──
  actionBar: { paddingTop: 16, gap: 10 },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#3B82F6', borderRadius: 14, paddingVertical: 15,
  },
  playIcon: { fontSize: 16, color: '#fff' },
  playLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  seasonRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  seasonChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
  },
  seasonChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // ── Sections ──
  section: { paddingHorizontal: 16, paddingTop: 20, gap: 12 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2 },
  plot: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },

  // ── Info card ──
  infoCard: {
    marginHorizontal: 16, marginTop: 20,
    borderRadius: 12, borderWidth: 1, overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', width: 68, flexShrink: 0 },
  infoValue: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },

  // ── Loading / empty ──
  loadingRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 20 },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  emptyCard: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },

  // ── Episode row ──
  epRow: {
    flexDirection: 'row', gap: 12,
    borderRadius: 12, borderWidth: 1, overflow: 'hidden',
    padding: 12, alignItems: 'flex-start',
  },
  epThumb: {
    width: 120, height: 70, borderRadius: 8,
    overflow: 'hidden', flexShrink: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  epPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  epPlayIcon: { fontSize: 20, color: '#fff' },
  epInfo: { flex: 1, gap: 4 },
  epTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  epMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  epStars: { fontSize: 10, color: '#F59E0B', letterSpacing: 1 },
  durationBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  durationText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  epPlot: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },
  progressRail: { height: 3, borderRadius: 1.5, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 1.5 },
  resumeBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  resumeLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
