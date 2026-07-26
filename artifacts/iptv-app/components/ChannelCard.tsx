import React, { memo } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { Channel } from '@/types';

interface ChannelCardProps {
  channel: Channel;
  isFavorite?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

function ChannelInitials({ name, colors }: { name: string; colors: ReturnType<typeof useColors> }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[styles.initialsBox, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <Text style={[styles.initials, { color: colors.primary }]}>{initials}</Text>
    </View>
  );
}

function ChannelCardComponent({ channel, isFavorite, onPress, onLongPress }: ChannelCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.6}
    >
      {/* Logo */}
      <View style={styles.logoWrap}>
        {channel.logo ? (
          <Image
            source={{ uri: channel.logo }}
            style={styles.logo}
            resizeMode="contain"
            onError={() => {}}
          />
        ) : (
          <ChannelInitials name={channel.name} colors={colors} />
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={[styles.group, { color: colors.mutedForeground }]} numberOfLines={1}>
          {channel.groupTitle}
        </Text>
      </View>

      {/* Right side */}
      <View style={styles.right}>
        <View style={[styles.livePill, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
        {isFavorite && (
          <Text style={{ color: colors.primary, fontSize: 12, marginTop: 2 }}>★</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export const ChannelCard = memo(ChannelCardComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  logoWrap: {
    width: 48,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 48,
    height: 36,
    borderRadius: 4,
  },
  initialsBox: {
    width: 48,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  initials: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  group: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  right: {
    alignItems: 'flex-end',
    gap: 4,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#EF4444',
  },
  liveText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#EF4444',
    letterSpacing: 0.5,
  },
});
