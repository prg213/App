import React, { memo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

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
  query?: string;
  isFav?: boolean;
  compact?: boolean;
  onPress: () => void;
  onFavPress?: () => void;
  /** #106: quick trailer shortcut shown as a small button on the poster */
  onTrailerPress?: () => void;
}

function SeriesCardComponent({ name, cover, rating, genre, query = '', isFav, compact, onPress, onFavPress, onTrailerPress }: SeriesCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity style={[styles.card, compact && styles.cardCompact]} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.poster, { backgroundColor: colors.secondary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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

        {/* #106: Trailer shortcut button */}
        {onTrailerPress && !compact && (
          <TouchableOpacity
            style={styles.trailerBtn}
            onPress={(e) => { e.stopPropagation(); onTrailerPress(); }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Text style={styles.trailerIcon}>▶</Text>
          </TouchableOpacity>
        )}
      </View>

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

export const SeriesCard = memo(SeriesCardComponent);

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
  trailerBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(139,92,246,0.85)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
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
