import React, { memo } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

interface MovieCardProps {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  year?: string;
  onPress: () => void;
}

function MovieCardComponent({ name, cover, rating, genre, onPress }: MovieCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      {/* Poster */}
      <View style={[styles.poster, { backgroundColor: colors.secondary }]}>
        {cover ? (
          <Image source={{ uri: cover }} style={StyleSheet.absoluteFill} resizeMode="cover" />
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
      </View>

      {/* Info */}
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

export const MovieCard = memo(MovieCardComponent);

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
