import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TrailerModal } from '@/components/TrailerModal';
import { getTmdbTrailerVideoId, getTmdbPosterUrl } from '@/services/tmdb';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, isContentBlocked } from '@/context/ParentalContext';
import { PinPad } from '@/components/PinPad';
import { StorageService } from '@/services/storage';
import { getXtreamSeriesInfo, getXtreamSeriesUrl } from '@/services/xtreamApi';
import { ThumbnailWithFallback } from '@/components/ThumbnailWithFallback';
import type { Episode, WatchHistoryEntry } from '@/types';

function StarRow({ value }: { value: number }) {
  const n = Math.round(Math.min(5, Math.max(0, value)));
  return (
    <View style={{ flexDirection: 'row', gap: 2, marginTop: 8 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <Text key={i} style={{ fontSize: 14, color: i < n ? '#F59E0B' : '#444' }}>
          {i < n ? '★' : '☆'}
        </Text>
      ))}
    </View>
  );
}

function MetaRow({
  label, value, expandable,
}: {
  label: string; value: string; expandable?: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > 90;
  return (
    <View style={mStyles.row}>
      <Text style={[mStyles.label, { color: 'rgba(255,255,255,0.5)' }]}>{label}:</Text>
      <View style={{ flex: 1 }}>
        <Text
          style={[mStyles.value, { color: colors.foreground }]}
          numberOfLines={expandable && !expanded && isLong ? 2 : undefined}
        >
          {value}
        </Text>
        {expandable && isLong && (
          <Pressable onPress={() => setExpanded(!expanded)} hitSlop={{ top: 6, bottom: 6 }}>
            <Text style={mStyles.readMore}>{expanded ? 'Show less' : 'Read more'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const mStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', gap: 10, paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  label: { width: 88, fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 18, flexShrink: 0 },
  value: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },
  readMore: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#F59E0B', marginTop: 3 },
});

type ActiveTab = 'episodes' | 'cast';

export default function SeriesDetailScreen() {
  const colors = useColors();
  const isOnline = useIsOnline(); // #140
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { maxRating, verifyPin } = useParentalContext();
  const [showEpPinGate, setShowEpPinGate] = useState(false);
  const [pendingEpisode, setPendingEpisode] = useState<{ ep: Episode; startAt?: number } | null>(null);
  const [selectedSeason, setSelectedSeason] = useState(0);
  const [showSeasonPicker, setShowSeasonPicker] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [episodeHistory, setEpisodeHistory] = useState<Record<string, WatchHistoryEntry>>({});
  const [activeTab, setActiveTab] = useState<ActiveTab>('episodes');
  const [trailerUrl, setTrailerUrl] = useState<string | null>(null);
  const [coverError, setCoverError] = useState(false);

  const params = useLocalSearchParams<{
    id: string; title: string; cover: string; rating: string;
    genre: string; plot: string; cast: string; director: string;
  }>();

  const isXtream =
    credentials?.type === 'xtream' &&
    !!credentials.host && !!credentials.username && !!credentials.password;

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
      id: params.id, name: params.title, cover: params.cover || undefined,
      rating: params.rating || undefined, genre: params.genre || undefined,
      categoryId: '', plot: params.plot || undefined,
      cast: params.cast || undefined, director: params.director || undefined,
    });
    setIsFav(updated.some((f) => f.id === params.id));
  };

  const { data, isLoading } = useQuery({
    queryKey: ['series-info', params.id, credentials],
    queryFn: () => getXtreamSeriesInfo(
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
      ep.streamId, ep.containerExtension,
    );
    router.push({
      pathname: '/player',
      params: {
        url, title: `${params.title} - ${ep.title}`, type: 'series', parentTitle: params.title,
        logo: ep.info?.cover ?? params.cover ?? '', contentId: ep.streamId,
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
  const director = params.director || data?.info?.director || '';
  const cast = params.cast || data?.info?.cast || '';
  const plot = params.plot || data?.info?.plot || '';
  const genre = params.genre || data?.info?.genre || '';
  const releaseDate = data?.info?.releaseDate || '';
  const genreDisplay = genre ? genre.split(',').slice(0, 2).map((g) => g.trim()).join(' / ') : '';

  // Fetch TMDB poster as fallback — only when no provider cover exists or the provider image errored.
  const { data: tmdbPoster } = useQuery({
    queryKey: ['tmdb-poster', params.title, 'tv'],
    queryFn: () => getTmdbPosterUrl(params.title, 'tv'),
    enabled: !params.cover || coverError,
    staleTime: 30 * 60_000,
  });
  const displayCover = (!params.cover || coverError) ? (tmdbPoster || '') : params.cover;

  // Cast list for Cast tab
  const castList = cast ? cast.split(',').map((c) => c.trim()).filter(Boolean) : [];

  return (
    <View style={[styles.root, { backgroundColor: '#0A0A0F' }]}>
      {/* Faint blurred background */}
      {displayCover ? (
        <Image source={{ uri: displayCover }} style={styles.bgImage} blurRadius={10} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,15,0.87)' }]} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: 'rgba(255,255,255,0.07)' }]}>
        <Pressable
          focusable
          style={({ focused }) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={() => router.back()}
        >
          <Text style={styles.headerBtnIcon}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{params.title}</Text>
        <Pressable
          focusable
          style={({ focused }) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={handleToggleFav}
        >
          <Text style={[styles.headerBtnIcon, { color: isFav ? '#EF4444' : '#fff', fontSize: 20 }]}>
            {isFav ? '♥' : '♡'}
          </Text>
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {/* ── Two-column section ── */}
        <View style={styles.topSection}>
          {/* Poster + stars */}
          <View style={styles.posterCol}>
            {displayCover ? (
              <Image
                source={{ uri: displayCover }}
                style={styles.poster}
                resizeMode="cover"
                onError={() => setCoverError(true)}
              />
            ) : (
              <View style={[styles.poster, { backgroundColor: '#1A1A2E', justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontSize: 36 }}>📺</Text>
              </View>
            )}
            {ratingNum > 0 && <StarRow value={ratingNum / 2} />}
          </View>

          {/* Metadata */}
          <View style={styles.metaCol}>
            {director ? <MetaRow label="Directed By" value={director} /> : null}
            {releaseDate ? <MetaRow label="Release Date" value={releaseDate} /> : null}
            {genreDisplay ? <MetaRow label="Genre" value={genreDisplay} /> : null}
            {plot ? <MetaRow label="Plot" value={plot} expandable /> : null}
            {cast ? <MetaRow label="Cast" value={cast} expandable /> : null}
            {isLoading && !data ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8 }}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter_400Regular' }}>
                  Loading details…
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* ── Action buttons ── */}
        <View style={styles.actionRow}>
          <Pressable
            focusable
            style={({ focused }) => [styles.playBtn, { opacity: !activeSeason ? 0.4 : 1 }, focused && styles.focusRing]}
            onPress={handlePlayFirst}
            disabled={!activeSeason}
          >
            <Text style={styles.playBtnText}>
              ▶  Play · S{activeSeason?.seasonNumber ?? 1}:E1
            </Text>
          </Pressable>

          {seasons.length > 1 && (
            <Pressable
              focusable
              style={({ focused }) => [styles.outlineBtn, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.2)' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSeasonPicker(true); }}
            >
              <Text style={styles.outlineBtnText}>
                Season {activeSeason?.seasonNumber ?? 1}  ▾
              </Text>
            </Pressable>
          )}

          <Pressable
            focusable
            style={({ focused }) => [styles.outlineBtn, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.15)' }, !isOnline && styles.offlineBtn, focused && styles.focusRing]}
            onPress={async () => {
              if (!isOnline) {
                Alert.alert('No Internet', 'No internet connection — trailer unavailable.', [{ text: 'OK' }]);
                return;
              }
              setTrailerUrl('loading');
              const videoId = await getTmdbTrailerVideoId(params.title, 'tv');
              if (videoId) { setTrailerUrl(`https://www.youtube.com/watch?v=${videoId}`); return; }
              const rawTrailer = data?.series?.trailerUrl;
              if (rawTrailer) {
                setTrailerUrl(rawTrailer.startsWith('http') ? rawTrailer : `https://www.youtube.com/watch?v=${rawTrailer}`);
              } else {
                setTrailerUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(`${params.title} official trailer`)}`);
              }
            }}
          >
            <Text style={[styles.outlineBtnText, !isOnline && { opacity: 0.45 }]}>
              {isOnline ? '▶  Watch Trailer' : '✕  No Connection'}
            </Text>
          </Pressable>
        </View>

        {/* ── Tabs ── */}
        <View style={[styles.tabBar, { borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
          {(['episodes', 'cast'] as ActiveTab[]).map((tab) => {
            const label = tab === 'episodes'
              ? `Episodes${activeSeason ? ` (${activeSeason.episodes.length})` : ''}`
              : `Cast${castList.length > 0 ? ` (${castList.length})` : ''}`;
            return (
              <Pressable
                key={tab}
                style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : 'rgba(255,255,255,0.45)' }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ── Episodes tab ── */}
        {activeTab === 'episodes' && (
          <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 10 }}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            ) : seasons.length === 0 ? (
              <Text style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 24, fontFamily: 'Inter_400Regular' }}>
                No episodes available
              </Text>
            ) : (
              activeSeason?.episodes.map((ep) => {
                const hist = episodeHistory[ep.streamId];
                const histProgress = hist?.position && hist?.duration ? hist.position / hist.duration : 0;
                const epRating = ep.info?.rating ? parseFloat(ep.info.rating) : 0;
                return (
                  <Pressable
                    key={ep.id}
                    focusable
                    style={({ focused }) => [styles.epRow, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.1)' }]}
                    onPress={() => handlePlayEpisode(ep)}
                  >
                    {/* Thumbnail */}
                    <ThumbnailWithFallback
                      uri={ep.info?.cover}
                      fallbackUri={displayCover}
                      style={styles.epThumb}
                      showPlayOverlay
                    />

                    {/* Info */}
                    <View style={styles.epInfo}>
                      <Text style={[styles.epTitle, { color: '#fff' }]} numberOfLines={2}>
                        {`S${String(activeSeason.seasonNumber).padStart(2, '0')}E${String(ep.episodeNum).padStart(2, '0')} · ${ep.title}`}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        {epRating > 0 && (
                          <Text style={{ fontSize: 10, color: '#F59E0B', letterSpacing: 1 }}>
                            {'★'.repeat(Math.round(epRating / 2))}{'☆'.repeat(5 - Math.round(epRating / 2))}
                          </Text>
                        )}
                        {ep.info?.duration ? (
                          <View style={[styles.durationBadge, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                            <Text style={{ fontSize: 11, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.55)' }}>
                              {ep.info.duration}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {ep.info?.plot ? (
                        <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.45)', lineHeight: 17, marginTop: 3 }} numberOfLines={2}>
                          {ep.info.plot}
                        </Text>
                      ) : null}
                      {histProgress > 0.02 && (
                        <View style={[styles.progressRail, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                          <View style={[styles.progressFill, { width: `${Math.min(100, histProgress * 100)}%` as any }]} />
                        </View>
                      )}
                    </View>

                    {/* Resume */}
                    {hist?.position && hist.position > 5 ? (
                      <Pressable
                        focusable
                        style={({ focused }) => [styles.resumeBtn, { borderColor: focused ? '#00E5FF' : colors.primary }]}
                        onPress={() => handlePlayEpisode(ep, hist.position)}
                      >
                        <Text style={[styles.resumeLabel, { color: colors.primary }]}>Resume</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        )}

        {/* ── Cast tab ── */}
        {activeTab === 'cast' && (
          <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
            {castList.length === 0 ? (
              <Text style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 24, fontFamily: 'Inter_400Regular' }}>
                No cast information available
              </Text>
            ) : (
              castList.map((name, idx) => (
                <View
                  key={idx}
                  style={[styles.castRow, { borderBottomColor: 'rgba(255,255,255,0.06)' }]}
                >
                  <View style={styles.castAvatar}>
                    <Text style={{ fontSize: 15 }}>👤</Text>
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#fff', flex: 1 }}>{name}</Text>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Season picker modal */}
      <Modal
        visible={showSeasonPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSeasonPicker(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setShowSeasonPicker(false)} />
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.pickerTitle, { color: 'rgba(255,255,255,0.5)', borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
            SELECT SEASON
          </Text>
          {seasons.map((season, idx) => (
            <Pressable
              key={season.id}
              style={[styles.pickerRow, { borderBottomColor: 'rgba(255,255,255,0.06)' }]}
              onPress={() => {
                setSelectedSeason(idx);
                setShowSeasonPicker(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            >
              <Text style={[styles.pickerRowText, { color: idx === selectedSeason ? '#3B82F6' : '#fff' }]}>
                Season {season.seasonNumber}
              </Text>
              {idx === selectedSeason && <Text style={{ color: '#3B82F6', fontSize: 16 }}>✓</Text>}
            </Pressable>
          ))}
        </View>
      </Modal>

      {/* Pin gate */}
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
      <TrailerModal url={trailerUrl} onClose={() => setTrailerUrl(null)} />
    </View>
  );
}

const POSTER_W = 120;
const POSTER_H = 172;

const styles = StyleSheet.create({
  root: { flex: 1 },
  bgImage: { position: 'absolute', width: '100%', height: '100%', opacity: 0.18 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'transparent', flexShrink: 0,
  },
  headerBtnIcon: { fontSize: 18, color: '#fff' },
  headerTitle: {
    flex: 1, textAlign: 'center',
    fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff',
    marginHorizontal: 8,
  },
  focusRing: { borderColor: '#00E5FF' },
  offlineBtn: { opacity: 0.45 },

  // Two-column
  topSection: {
    flexDirection: 'row', gap: 14,
    paddingHorizontal: 14, paddingTop: 16, paddingBottom: 8,
  },
  posterCol: { width: POSTER_W, flexShrink: 0, alignItems: 'center' },
  poster: {
    width: POSTER_W, height: POSTER_H,
    borderRadius: 10, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  metaCol: { flex: 1 },

  // Actions
  actionRow: {
    flexDirection: 'row', gap: 8, flexWrap: 'wrap',
    paddingHorizontal: 14, paddingTop: 14,
  },
  playBtn: {
    flex: 1, minWidth: 140, backgroundColor: '#3B82F6',
    borderRadius: 10, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  playBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  outlineBtn: {
    paddingHorizontal: 14, paddingVertical: 13,
    borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#fff' },

  // Tabs
  tabBar: {
    flexDirection: 'row', marginTop: 20, marginHorizontal: 14,
    borderBottomWidth: 1,
  },
  tabItem: {
    paddingVertical: 10, paddingHorizontal: 4, marginRight: 20,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: '#3B82F6' },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Episode rows
  epRow: {
    flexDirection: 'row', gap: 12,
    borderRadius: 10, borderWidth: 1, overflow: 'hidden',
    padding: 10, alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  epThumb: {
    width: 120, height: 70, borderRadius: 7,
    overflow: 'hidden', flexShrink: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  epInfo: { flex: 1, gap: 2 },
  epTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  durationBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  progressRail: { height: 3, borderRadius: 1.5, overflow: 'hidden', marginTop: 5 },
  progressFill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 1.5 },
  resumeBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  resumeLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  // Cast tab
  castRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  castAvatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },

  // Season picker
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  pickerSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#1A1A2E', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingTop: 8,
  },
  pickerTitle: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2,
    paddingHorizontal: 18, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRowText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
});
