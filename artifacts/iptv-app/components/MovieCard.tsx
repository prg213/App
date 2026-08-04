import React, { memo, useEffect, useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useIsOnline } from '@/hooks/useIsOnline';
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

interface MovieCardProps {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  year?: string;
  query?: string;
  isFav?: boolean;
  compact?: boolean;
  onPress: () => void;
  onFavPress?: () => void;
  /** #123: quick trailer shortcut shown as a small button on the poster */
  onTrailerPress?: () => void;
}

function MovieCardComponent({ name, cover, rating, genre, query = '', isFav, compact, onPress, onFavPress, onTrailerPress }: MovieCardProps) {
  const colors = useColors();
  const isOnline = useIsOnline();

  const [tmdbPoster, setTmdbPoster] = useState<string | null>(null);

  useEffect(() => {
    if (cover) { setTmdbPoster(null); return; }
    let cancelled = false;
    getTmdbPosterUrl(name, 'movie').then((url) => {
      if (!cancelled) setTmdbPoster(url);
    });
    return () => { cancelled = true; };
  }, [name, cover]);

  const posterUri = cover || tmdbPoster;

  return (
    <TouchableOpacity style={[styles.card, compact && styles.cardCompact]} onPress={onPress} activeOpacity={0.75}>
      {/* Poster */}
      <View style={[styles.poster, { backgroundColor: colors.secondary }]}>
        {posterUri ? (
          <Image source={{ uri: posterUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.noImage]}>
            <Text style={[styles.noImageIcon, { color: colors.mutedForeground }]}>▶</Text>
          </View>
        )}
        {rating && parseFloat(rating) > 0 && (
          <View style={[styles.ratingBadge, { backgroundColor: 'rgba(0,0,0,0.75)' }]}>
            <Text style={styles.ratingText}>★ {parseFloat(rating).toFixed(1)}</Text>
          </View>
        )}
        {/* Heart favourite button */}
        {onFavPress && (
          <TouchableOpacity
            style={styles.heartBtn}
            onPress={(e) => { e.stopPropagation(); onFavPress(); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text style={[styles.heartIcon, { color: isFav ? '#EF4444' : 'rgba(255,255,255,0.7)' }]}>
              {isFav ? '♥' : '♡'}
            </Text>
          </TouchableOpacity>
        )}
        {/* #123/#129: Trailer shortcut — dimmed when offline */}
        {onTrailerPress && !compact && (
          <TouchableOpacity
            style={[styles.trailerBtn, !isOnline && styles.trailerBtnOffline]}
            onPress={(e) => { e.stopPropagation(); onTrailerPress(); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text style={styles.trailerIcon}>{isOnline ? '▶' : '✕'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Info */}
      <View style={[styles.info, compact && styles.infoCompact]}>
        <HighlightedText
          text={name}
          query={query}
          compact={compact}
          style={[styles.title, { color: colors.foreground }, compact && styles.titleCompact]}
        />
        {!compact && genre ? (
          <Text style={[styles.genre, { color: colors.mutedForeground }]} numberOfLines={1}>
            {genre.split(',')[0]}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export const MovieCard = memo(MovieCardComponent);

const styles = StyleSheet.create({
  card: {
    flex: 1,
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
  trailerBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(139,92,246,0.85)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  trailerBtnOffline: {
    backgroundColor: 'rgba(75,85,99,0.75)',
  },
  trailerIcon: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
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
