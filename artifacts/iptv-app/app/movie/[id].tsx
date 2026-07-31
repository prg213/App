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
import { getXtreamVodInfo, getXtreamVodUrl } from '@/services/xtreamApi';

function fmtSecs(secs: number) {
  const s = Math.floor(secs), m = Math.floor(s / 60), h = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0'), mm = String(m % 60).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function StarRating({ value }: { value: number }) {
  const filled = Math.round(value);
  return (
    <Text style={styles.stars}>
      {Array.from({ length: 5 }, (_, i) => (i < filled ? '★' : '☆')).join('')}
    </Text>
  );
}

export default function MovieDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { maxRating, verifyPin } = useParentalContext();
  const [isFav, setIsFav] = useState(false);
  const [savedPosition, setSavedPosition] = useState<number | null>(null);
  const [showPinGate, setShowPinGate] = useState(false);
  const [pendingStartAt, setPendingStartAt] = useState<number | undefined>(undefined);

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

  useFocusEffect(
    useCallback(() => {
      StorageService.getMovieFavorites().then((favs) => {
        setIsFav(favs.some((f) => f.id === params.id));
      });
      StorageService.getWatchHistory().then((h) => {
        const entry = h.find((e) => e.id === params.id);
        setSavedPosition(entry?.position && entry.position > 5 ? entry.position : null);
      });
    }, [params.id]),
  );

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

  const cover       = params.cover       || vodInfo?.cover       || '';
  const plot        = params.plot        || vodInfo?.plot        || '';
  const cast        = params.cast        || vodInfo?.cast        || '';
  const director    = params.director    || vodInfo?.director    || '';
  const genre       = params.genre       || vodInfo?.genre       || '';
  const rating      = params.rating      || vodInfo?.rating      || '';
  const releaseDate = params.releaseDate || vodInfo?.releaseDate || '';
  const duration    = params.duration    || vodInfo?.duration    || '';
  const ext         = params.ext         || vodInfo?.containerExtension || 'mp4';

  const handleToggleFav = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleMovieFavorite({
      id: params.id,
      name: params.title,
      cover: cover || undefined,
      rating: rating || undefined,
      genre: genre || undefined,
      streamId: params.id,
      containerExtension: ext,
      categoryId: '',
      plot: plot || undefined,
      cast: cast || undefined,
      director: director || undefined,
      releaseDate: releaseDate || undefined,
      duration: duration || undefined,
    });
    setIsFav(updated.some((f) => f.id === params.id));
  };

  const doPlay = useCallback((startAt?: number) => {
    if (!isXtream) return;
    const url = getXtreamVodUrl(
      { host: credentials!.host!, username: credentials!.username!, password: credentials!.password! },
      params.id,
      ext,
    );
    if (!url) return;
    router.push({
      pathname: '/player',
      params: {
        url,
        title: params.title,
        type: 'vod',
        logo: cover,
        contentId: params.id,
        ...(startAt !== undefined ? { startAt: String(startAt) } : {}),
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cover, ext, params.id, params.title, router]);

  const handlePlay = (startAt?: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isContentBlocked(params.rating, maxRating)) {
      setPendingStartAt(startAt);
      setShowPinGate(true);
      return;
    }
    doPlay(startAt);
  };

  const year      = releaseDate?.slice(0, 4);
  const ratingNum = rating ? parseFloat(rating) : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24) }}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          {cover ? (
            <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
              <Text style={{ fontSize: 52, color: colors.mutedForeground }}>🎬</Text>
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
            {cover ? (
              <Image
                source={{ uri: cover }}
                style={[styles.poster, { borderColor: 'rgba(255,255,255,0.12)' }]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.poster, { backgroundColor: colors.secondary, justifyContent: 'center', alignItems: 'center' }]}>
                <Text style={{ fontSize: 32 }}>🎬</Text>
              </View>
            )}

            <View style={styles.heroMeta}>
              <Text style={styles.heroTitle} numberOfLines={3}>{params.title}</Text>
              {ratingNum > 0 && <StarRating value={ratingNum / 2} />}
              <View style={styles.heroBadgeRow}>
                {year ? <Text style={styles.heroBadge}>{year}</Text> : null}
                {duration ? <Text style={styles.heroBadge}>{duration}</Text> : null}
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

        {/* ── Play / Resume buttons ── */}
        <View style={styles.actionBar}>
          {savedPosition ? (
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.playBtn, { flex: 1 }]}
                onPress={() => handlePlay(savedPosition)}
                activeOpacity={0.85}
              >
                <Text style={styles.playIcon}>▶</Text>
                <Text style={styles.playLabel}>Resume · {fmtSecs(savedPosition)}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
                onPress={() => handlePlay()}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryLabel, { color: colors.foreground }]}>From start</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.playBtn} onPress={() => handlePlay()} activeOpacity={0.85}>
              <Text style={styles.playIcon}>▶</Text>
              <Text style={styles.playLabel}>Play</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Plot ── */}
        {infoLoading && needsInfo ? (
          <View style={[styles.section, { flexDirection: 'row', gap: 10, alignItems: 'center' }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.plot, { color: colors.mutedForeground }]}>Loading synopsis…</Text>
          </View>
        ) : plot ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SYNOPSIS</Text>
            <Text style={[styles.plot, { color: colors.foreground }]}>{plot}</Text>
          </View>
        ) : null}

        {/* ── Details card ── */}
        {(director || cast || releaseDate) && (
          <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {director ? (
              <View style={[styles.infoRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Director</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={2}>{director}</Text>
              </View>
            ) : null}
            {releaseDate ? (
              <View style={[styles.infoRow, { borderBottomWidth: cast ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }]}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Release</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]}>{releaseDate}</Text>
              </View>
            ) : null}
            {cast ? (
              <View style={styles.infoRow}>
                <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Cast</Text>
                <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={4}>{cast}</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={showPinGate}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setShowPinGate(false)}
      >
        <PinPad
          mode="verify"
          title="Age-Restricted Content"
          subtitle="Enter your PIN to play this title"
          verify={verifyPin}
          onSuccess={() => {
            setShowPinGate(false);
            doPlay(pendingStartAt);
          }}
          onCancel={() => setShowPinGate(false)}
        />
      </Modal>
    </View>
  );
}

const HERO_H   = 290;
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
    borderRadius: 10, borderWidth: 1,
    overflow: 'hidden', flexShrink: 0,
  },
  heroMeta: { flex: 1, paddingBottom: 6, gap: 5 },
  heroTitle: {
    fontSize: 20, fontFamily: 'Inter_700Bold',
    color: '#fff', lineHeight: 26, letterSpacing: -0.3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  stars: { fontSize: 13, color: '#F59E0B', letterSpacing: 2 },
  heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroBadge: {
    fontSize: 11, fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5,
  },
  heroDetail: { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', lineHeight: 16 },
  heroDetailLabel: { fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.45)' },

  // ── Actions ──
  actionBar: { paddingHorizontal: 16, paddingTop: 16 },
  btnRow: { flexDirection: 'row', gap: 10 },
  playBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#3B82F6', borderRadius: 14, paddingVertical: 15,
  },
  playIcon: { fontSize: 16, color: '#fff' },
  playLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  secondaryBtn: {
    paddingHorizontal: 16, paddingVertical: 15,
    borderRadius: 14, borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  secondaryLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // ── Content ──
  section: { paddingHorizontal: 16, paddingTop: 20, gap: 8 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.2 },
  plot: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },

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
});
