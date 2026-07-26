import React, { memo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

interface SeriesCardProps {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  isFav?: boolean;
  onPress: () => void;
  onFavPress?: () => void;
}

function SeriesCardComponent({ name, cover, rating, genre, isFav, onPress, onFavPress }: SeriesCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
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
      </View>

      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {name}
        </Text>
        {genre ? (
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
  info: {
    marginTop: 7,
    gap: 3,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  genre: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
});
