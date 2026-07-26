import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';

interface SkeletonProps {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: object;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: SkeletonProps) {
  const colors = useColors();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [shimmer]);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.7],
  });

  return (
    <Animated.View
      style={[
        {
          width: width as number,
          height,
          borderRadius,
          backgroundColor: colors.border,
          overflow: 'hidden',
          opacity,
        },
        style,
      ]}
    />
  );
}

export function ChannelCardSkeleton() {
  const colors = useColors();
  return (
    <View style={[styles.channelRow, { borderBottomColor: colors.border }]}>
      <Skeleton width={44} height={44} borderRadius={8} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="60%" height={14} />
        <Skeleton width="40%" height={11} />
      </View>
    </View>
  );
}

export function MovieCardSkeleton() {
  return (
    <View style={styles.movieCard}>
      <Skeleton width="100%" height={160} borderRadius={10} />
      <View style={{ marginTop: 8, gap: 5 }}>
        <Skeleton width="80%" height={13} />
        <Skeleton width="50%" height={11} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  movieCard: {
    flex: 1,
    padding: 4,
  },
});
