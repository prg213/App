import React, { memo, useEffect, useState } from 'react';
import { FocusablePressable } from '@/components/FocusablePressable';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
import { useForegroundEpoch } from '@/hooks/useForegroundEpoch';
import { getTmdbPosterUrl } from '@/services/tmdb';

function HighlightedText({ text, query, style, compact }: { text: string; query: string; style: any; compact?: boolean }) {
  const colors = useColors();
  if (!query) return <Text style={style} numberOfLines={2}>{text}</Text>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: { t: string; m: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx === -1) { parts.push({ t: text.slice(i), m: false }); break; }
    if (idx > i) parts.push({ t: text.slice(i, idx), m: false });
    parts.push({ t: text.slice(idx, idx + q.length), m: true });
    i = idx + q.length;
  }
  const hlStyle = { color: colors.primary, fontFamily: compact ? 'Inter_500Medium' : 'Inter_700Bold' };
  return (
    <Text style={style} numberOfLines={2}>
      {parts.map((p, j) => p.m ? <Text key={j} style={hlStyle}>{p.t}</Text> : p.t)}
    </Text>
  );
}

interface SeriesCardProps {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  year?: string;
  query?: string;
  isFav?: boolean;
  compact?: boolean;
  /** 0–1 resume progress bar shown at the bottom of the poster */
  progress?: number;
  /**
   * Optional style override for the outer TouchableOpacity wrapper.
   * Use when the card is nested inside a layout container that already
   * controls width (e.g. SwipeToDeleteCard) so the card's own maxWidth
   * doesn't double-constrain it.
   */
  cardStyle?: StyleProp<ViewStyle>;
  onPress: () => void;
  onFavPress?: () => void;
  onLongPress?: () => void;
  /** kept for API compatibility — button no longer rendered on the poster */
  onTrailerPress?: () => void;
}

function SeriesCardComponent({ name, cover, rating, genre, year, query = '', isFav, compact, progress, cardStyle, onPress, onFavPress, onLongPress }: SeriesCardProps) {
  const colors = useColors();
  const isOnline = useIsOnline();
  // #172: increment whenever the app returns to the foreground so images that
  // were evicted from memory (or served broken from a stale cache entry) are
  // remounted cleanly.  Combined with the poster URI it also catches the #165
  // case where the provider serves a fresh cover after a background refetch.
  const fgEpoch = useForegroundEpoch();

  const [tmdbPoster, setTmdbPoster] = useState<string | null>(null);

  useEffect(() => {
    if (cover) { setTmdbPoster(null); return; }
    if (!isOnline) return;
    let cancelled = false;
    getTmdbPosterUrl(name, 'tv').then((url) => {
      if (!cancelled) setTmdbPoster(url);
    });
    return () => { cancelled = true; };
  }, [name, cover, isOnline]);

  const posterUri = cover || tmdbPoster;

  return (
    <FocusablePressable style={[styles.card, compact && styles.cardCompact, cardStyle]} onPress={onPress} onLongPress={onLongPress} delayLongPress={500} accessibilityLabel={name} accessibilityRole="button">
      <View style={[styles.poster, { backgroundColor: colors.secondary }]}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${posterUri}-${fgEpoch}`} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noImage]}>
            <Text style={[styles.noImageIcon, { color: colors.mutedForeground }]}>◼</Text>
          </View>
        )}

        {/* Series badge */}
        <View style={[styles.seriesBadge, { backgroundColor: 'rgba(59,130,246,0.85)' }]}>
          <Text style={styles.seriesLabel}>SERIES</Text>
        </View>

        {rating && parseFloat(rating) > 0 && (
          <View style={[styles.ratingBadge, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
            <Text style={styles.ratingText}>★ {parseFloat(rating).toFixed(1)}</Text>
          </View>
        )}

        {/* Heart favourite button — focusable={false} on TV prevents a nested-
            focusable D-pad trap; long-press on the card opens the action menu
            which includes "Toggle Favourite" as the TV-safe alternative. */}
        {onFavPress && (
          <FocusablePressable
            style={styles.heartBtn}
            focusable={false}
            onPress={(e) => { (e as any).stopPropagation?.(); onFavPress(); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Text style={[styles.heartIcon, { color: isFav ? '#EF4444' : 'rgba(255,255,255,0.7)' }]}>
              {isFav ? '♥' : '♡'}
            </Text>
          </FocusablePressable>
        )}

        {/* Resume progress bar */}
        {progress != null && progress > 0 && (
          <View style={styles.progressRail}>
            <View style={[styles.progressFill, { width: `${Math.max(2, Math.min(100, progress * 100))}%` as any }]} />
          </View>
        )}
      </View>

      <View style={[styles.info, compact && styles.infoCompact]}>
        <HighlightedText
          text={name}
          query={query}
          compact={compact}
          style={[styles.title, { color: colors.foreground }, compact && styles.titleCompact]}
        />
        {!compact && (genre || year) ? (
          <Text style={[styles.genre, { color: colors.mutedForeground }]} numberOfLines={1}>
            {[genre?.split(',')[0], year].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
    </FocusablePressable>
  );
}

export const SeriesCard = memo(SeriesCardComponent);


const styles = StyleSheet.create({
  card: {
    flex: 1,
    maxWidth: '25%',
    padding: 5,
  },
  cardCompact: {
    padding: 3,
  },
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  noImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noImageIcon: {
    fontSize: 28,
  },
  seriesBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  seriesLabel: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: {
    color: '#F59E0B',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  heartBtn: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 99,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heartIcon: {
    fontSize: 14,
    lineHeight: 16,
  },
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
  info: {
    marginTop: 7,
    gap: 3,
    paddingHorizontal: 2,
  },
  infoCompact: {
    marginTop: 4,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  titleCompact: {
    fontSize: 10,
    lineHeight: 13,
  },
  genre: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
});
