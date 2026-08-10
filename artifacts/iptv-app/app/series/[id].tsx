import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { TrailerModal } from '@/components/TrailerModal';
import { getTmdbTrailerCandidates, getTmdbPosterUrl } from '@/services/tmdb';
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
          <FocusablePressable onPress={() => setExpanded(!expanded)} hitSlop={{ top: 6, bottom: 6 }}>
            <Text style={mStyles.readMore}>{expanded ? 'Show less' : 'Read more'}</Text>
          </FocusablePressable>
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
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [trailerVideoIds, setTrailerVideoIds] = useState<string[] | 'loading' | null>(null);
  const [coverError, setCoverError] = useState(false);
  // #165: Store the TMDB poster URL in a ref so it is set only once on first
  // successful fetch and never cleared when series data re-fetches in the background.
  // A companion state counter is bumped when the ref is set to trigger a re-render.
  const tmdbPosterRef = useRef<string | null>(null);
  const scrollRef = useRef<import('react-native').ScrollView>(null);
  const [, forceUpdateForPoster] = useState(0);
  // Incremented whenever the series-info query delivers fresh data so that
  // episode thumbnails which previously errored get a clean remount and retry.
  const [thumbResetKey, setThumbResetKey] = useState(0);
  // #166: pull-to-refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  const params = useLocalSearchParams<{
    id: string; title: string; cover: string; rating: string;
    genre: string; plot: string; cast: string; director: string;
    resumeEpisodeId?: string; resumePosition?: string;
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['series-info', params.id, credentials],
    queryFn: () => getXtreamSeriesInfo(
      { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
      params.id,
    ),
    enabled: isXtream,
    staleTime: 10 * 60_000,
  });

  // When the series-info query delivers fresh data (e.g. after staleTime expires),
  // bump thumbResetKey so previously-errored episode thumbnails remount and retry.
  useEffect(() => {
    if (data !== undefined) {
      setThumbResetKey((k) => k + 1);
    }
  }, [data]);

  // Auto-play a specific episode when navigated from Continue Watching rail.
  // Only fires once: when series data first arrives with a resumeEpisodeId param.
  const didAutoResumeRef = useRef(false);
  useEffect(() => {
    if (didAutoResumeRef.current || !data || !params.resumeEpisodeId) return;
    const epId = params.resumeEpisodeId;
    const startAt = params.resumePosition ? Number(params.resumePosition) : 0;
    for (let si = 0; si < (data.seasons ?? []).length; si++) {
      const ep = data.seasons[si].episodes.find((e) => String(e.streamId) === epId || String(e.id) === epId);
      if (ep) {
        didAutoResumeRef.current = true;
        setSelectedSeason(si);
        // Defer play until the season state settles
        setTimeout(() => handlePlayEpisode(ep, startAt > 5 ? startAt : undefined), 300);
        break;
      }
    }
  // handlePlayEpisode is stable (useCallback); data changes trigger this
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, params.resumeEpisodeId, params.resumePosition]);

  const seasons = data?.seasons ?? [];
  const activeSeason = seasons[selectedSeason];

  // Prefetch episode thumbnails for the current season as soon as series data
  // arrives (or the user switches seasons) so the episode list shows crisp
  // images on the very first render, even on slow connections.
  useEffect(() => {
    if (seasons.length === 0) return;
    const season = seasons[selectedSeason];
    if (!season) return;
    for (const ep of season.episodes) {
      const thumbUri = ep.info?.cover;
      if (thumbUri) {
        // Fire-and-forget — errors are silently ignored; this is best-effort.
        Image.prefetch(thumbUri).catch(() => {});
      }
    }
  }, [selectedSeason, seasons]);

  // Prefetch episode thumbnails for the adjacent seasons (N-1, N+1) so that
  // switching seasons shows images immediately instead of waiting for downloads.
  useEffect(() => {
    if (seasons.length === 0) return;

    const adjacentIndices = [selectedSeason - 1, selectedSeason + 1].filter(
      (i) => i >= 0 && i < seasons.length,
    );

    for (const idx of adjacentIndices) {
      const season = seasons[idx];
      if (!season) continue;
      for (const ep of season.episodes) {
        const thumbUri = ep.info?.cover;
        if (thumbUri) {
          // Fire-and-forget — errors are silently ignored; this is best-effort.
          Image.prefetch(thumbUri).catch(() => {});
        }
      }
    }
  }, [selectedSeason, seasons]);

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

  // #165: Fetch TMDB poster as fallback only when needed, and store it in a ref
  // so a background data refresh never clears the poster we already resolved.
  useEffect(() => {
    if (tmdbPosterRef.current) return; // already fetched — never overwrite
    if (params.cover && !coverError) return; // provider cover is fine
    getTmdbPosterUrl(params.title, 'tv').then((url) => {
      if (url && !tmdbPosterRef.current) {
        tmdbPosterRef.current = url;
        forceUpdateForPoster((n) => n + 1); // trigger a re-render
      }
    }).catch(() => {});
  }, [params.title, params.cover, coverError]);

  // displayCover must be declared before the useEffect that lists it as a dep.
  const displayCover = (!params.cover || coverError)
    ? (tmdbPosterRef.current || '')
    : params.cover;

  // #172/#171: Prefetch the poster into the native image cache whenever the URL
  // is resolved (initial load, TMDB fallback, or app returning from background).
  // This prevents a blank or blurry poster while the image re-downloads.
  useEffect(() => {
    if (displayCover) Image.prefetch(displayCover).catch(() => {});
  }, [displayCover]);

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
        <FocusablePressable
          focusable
          hasTVPreferredFocus={Platform.isTV}
          style={(focused) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
        >
          <Text style={styles.headerBtnIcon}>←</Text>
        </FocusablePressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{params.title}</Text>
        <FocusablePressable
          focusable
          style={(focused) => [styles.headerBtn, focused && styles.focusRing]}
          onPress={handleToggleFav}
        >
          <Text style={[styles.headerBtnIcon, { color: isFav ? '#EF4444' : '#fff', fontSize: 20 }]}>
            {isFav ? '♥' : '♡'}
          </Text>
        </FocusablePressable>
      </View>

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        refreshControl={
          // #166: Pull-to-refresh refetches series data and resets episode thumbnail errors.
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={async () => {
              setIsRefreshing(true);
              // #165: Reset poster error so a fresh provider cover (or TMDB
              // fallback) can load after the provider data refreshes.
              setCoverError(false);
              // Reset thumbnail error states so fresh thumbnails are fetched.
              setThumbResetKey((k) => k + 1);
              try {
                await refetch();
              } finally {
                setIsRefreshing(false);
              }
            }}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >
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
            {releaseDate ? <MetaRow label="Year" value={releaseDate.slice(0, 4)} /> : null}
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
          <FocusablePressable
            focusable
            style={(focused) => [styles.playBtn, { opacity: !activeSeason ? 0.4 : 1 }, focused && styles.focusRing]}
            onPress={handlePlayFirst}
            disabled={!activeSeason}
          >
            <Text style={styles.playBtnText}>
              ▶  Play · S{activeSeason?.seasonNumber ?? 1}:E1
            </Text>
          </FocusablePressable>

          {seasons.length > 1 && (
            <FocusablePressable
              focusable
              style={(focused) => [styles.outlineBtn, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.2)' }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSeasonPicker(true); }}
            >
              <Text style={styles.outlineBtnText}>
                Season {activeSeason?.seasonNumber ?? 1}  ▾
              </Text>
            </FocusablePressable>
          )}

          <FocusablePressable
            focusable
            style={(focused) => [styles.outlineBtn, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.15)' }, (!isOnline || trailerLoading) && styles.offlineBtn, focused && styles.focusRing]}
            onPress={async () => {
              if (!isOnline) {
                Alert.alert('No Internet', 'No internet connection — trailer unavailable.', [{ text: 'OK' }]);
                return;
              }
              setTrailerLoading(true);
              try {
                const raw = data?.series?.trailerUrl;
                const ytId = raw
                  ? raw.startsWith('http')
                    ? (raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ?? raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ?? null)
                    : (raw.length === 11 ? raw : null)
                  : null;
                const resolved = ytId ?? (await getTmdbTrailerCandidates(params.title, 'tv'))[0] ?? null;
                if (resolved) {
                  setTrailerVideoIds([resolved]);
                } else {
                  Alert.alert('No Trailer', 'No trailer found for this series.');
                }
              } finally {
                setTrailerLoading(false);
              }
            }}
          >
            <Text style={[styles.outlineBtnText, (!isOnline || trailerLoading) && { opacity: 0.45 }]}>
              {trailerLoading ? 'Loading…' : isOnline ? '▶  Watch Trailer' : '✕  No Connection'}
            </Text>
          </FocusablePressable>
        </View>

        {/* ── Tabs ── */}
        <View style={[styles.tabBar, { borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
          {(['episodes', 'cast'] as ActiveTab[]).map((tab) => {
            const totalEpisodes = seasons.reduce((sum, s) => sum + s.episodes.length, 0);
            const label = tab === 'episodes'
              ? `Episodes${activeSeason ? ` (${activeSeason.episodes.length}/${totalEpisodes})` : ''}`
              : `Cast${castList.length > 0 ? ` (${castList.length})` : ''}`;
            return (
              <FocusablePressable
                key={tab}
                style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, { color: activeTab === tab ? colors.primary : 'rgba(255,255,255,0.45)' }]}>
                  {label}
                </Text>
              </FocusablePressable>
            );
          })}
        </View>

        {/* ── Episodes tab ── */}
        {activeTab === 'episodes' && (
          <View style={{ paddingHorizontal: 14, paddingTop: 12, gap: 10 }}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            ) : seasons.length === 0 || (activeSeason && activeSeason.episodes.length === 0) ? (
              <View style={{ alignItems: 'center', paddingVertical: 48, gap: 8 }}>
                <Text style={{ fontSize: 32 }}>📭</Text>
                <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                  No episodes available
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 }}>
                  The provider hasn't listed any episodes for this season.
                </Text>
              </View>
            ) : (
              activeSeason?.episodes.map((ep) => {
                const hist = episodeHistory[ep.streamId];
                const histProgress = hist?.position && hist?.duration ? hist.position / hist.duration : 0;
                const epRating = ep.info?.rating ? parseFloat(ep.info.rating) : 0;
                return (
                  <FocusablePressable
                    key={ep.id}
                    focusable
                    style={(focused) => [styles.epRow, { borderColor: focused ? '#00E5FF' : 'rgba(255,255,255,0.1)' }]}
                    onPress={() => {
                      // On TV, pressing OK resumes from saved position when available
                      // (same destination as the Resume pill, avoiding a nested-focusable trap).
                      const savedPos = hist?.position && hist.position > 5 ? hist.position : undefined;
                      handlePlayEpisode(ep, savedPos);
                    }}
                  >
                    {/* Thumbnail — key includes thumbResetKey so a data refetch
                        causes a clean remount, letting previously-errored URLs retry. */}
                    <ThumbnailWithFallback
                      key={`ep-thumb-${ep.id}-${thumbResetKey}`}
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

                    {/* Resume — touch users tap this to resume; on TV the outer
                        row's onPress already resumes, so focusable={false}
                        prevents a nested-focusable D-pad trap. */}
                    {hist?.position && hist.position > 5 ? (
                      <FocusablePressable
                        focusable={false}
                        style={(focused) => [styles.resumeBtn, { borderColor: focused ? '#00E5FF' : colors.primary }]}
                        onPress={() => handlePlayEpisode(ep, hist.position)}
                      >
                        <Text style={[styles.resumeLabel, { color: colors.primary }]}>Resume</Text>
                      </FocusablePressable>
                    ) : null}
                  </FocusablePressable>
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
        {/* focusable={false}: BACK already closes via onRequestClose; this
            prevents the backdrop from stealing D-pad focus from the season rows */}
        <View style={styles.pickerBackdrop} pointerEvents="box-none" />
        <View style={[styles.pickerSheet, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={[styles.pickerTitle, { color: 'rgba(255,255,255,0.5)', borderBottomColor: 'rgba(255,255,255,0.08)' }]}>
            SELECT SEASON
          </Text>
          {seasons.map((season, idx) => (
            <FocusablePressable
              key={season.id}
              style={[styles.pickerRow, { borderBottomColor: 'rgba(255,255,255,0.06)' }]}
              hasTVPreferredFocus={Platform.isTV && idx === selectedSeason}
              onPress={() => {
                setSelectedSeason(idx);
                setShowSeasonPicker(false);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                // Scroll episode list back to top when user switches seasons
                scrollRef.current?.scrollTo({ y: 0, animated: false });
              }}
            >
              <Text style={[styles.pickerRowText, { color: idx === selectedSeason ? '#3B82F6' : '#fff' }]}>
                Season {season.seasonNumber}
              </Text>
              {idx === selectedSeason && <Text style={{ color: '#3B82F6', fontSize: 16 }}>✓</Text>}
            </FocusablePressable>
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
      <TrailerModal videoIds={trailerVideoIds} onClose={() => setTrailerVideoIds(null)} />
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
  pickerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
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
