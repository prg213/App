import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext } from '@/context/ParentalContext';
import { getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel } from '@/types';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

// ─── Channel Row ──────────────────────────────────────────────────────────────

const ChannelBlockRow = React.memo(function ChannelBlockRow({
  channel,
  isBlocked,
  colors,
  onToggle,
}: {
  channel: Channel;
  isBlocked: boolean;
  colors: ReturnType<typeof useColors>;
  onToggle: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.75 },
        isBlocked && { backgroundColor: 'rgba(239,68,68,0.06)' },
      ]}
      onPress={onToggle}
    >
      {/* Logo / initials */}
      <View style={[styles.logo, { backgroundColor: colors.secondary }]}>
        {channel.logo ? (
          <Image
            source={{ uri: channel.logo }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
          />
        ) : (
          <Text style={[styles.initials, { color: colors.primary }]}>
            {channel.name.slice(0, 2).toUpperCase()}
          </Text>
        )}
        {isBlocked && (
          <View style={styles.blockedBadge}>
            <Text style={styles.blockedBadgeText}>🚫</Text>
          </View>
        )}
      </View>

      {/* Name + group */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={[styles.chName, { color: isBlocked ? colors.mutedForeground : colors.foreground }]}
          numberOfLines={1}
        >
          {channel.name}
        </Text>
        {channel.groupTitle ? (
          <Text style={[styles.chGroup, { color: colors.mutedForeground }]} numberOfLines={1}>
            {channel.groupTitle}
          </Text>
        ) : null}
      </View>

      {/* Toggle indicator */}
      <View
        style={[
          styles.toggle,
          { borderColor: isBlocked ? '#EF4444' : colors.border },
          isBlocked && styles.toggleBlocked,
        ]}
      >
        <Text style={[styles.toggleText, isBlocked && styles.toggleTextBlocked]}>
          {isBlocked ? 'Blocked' : 'Allow'}
        </Text>
      </View>
    </Pressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BlockedChannelsScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { credentials } = useAppContext();
  const { blockedChannels, toggleBlockedChannel } = useParentalContext();
  const [search, setSearch] = useState('');

  // Fetch ALL live channels (no category filter)
  const { data: allChannels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels-all', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (
        credentials.type === 'xtream' &&
        credentials.host &&
        credentials.username &&
        credentials.password
      ) {
        return getXtreamLiveStreams(buildCreds(credentials));
      }
      if (credentials.type === 'm3u' && credentials.m3uUrl) {
        const { channels } = await fetchAndParseM3U(credentials.m3uUrl);
        return channels;
      }
      return [];
    },
    enabled: !!credentials,
    staleTime: 5 * 60_000,
  });

  const blockedSet = useMemo(() => new Set(blockedChannels), [blockedChannels]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allChannels;
    const q = search.toLowerCase();
    return allChannels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [allChannels, search]);

  const handleToggle = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleBlockedChannel(ch.id);
  }, [toggleBlockedChannel]);

  const renderItem = useCallback(({ item }: { item: Channel }) => (
    <ChannelBlockRow
      channel={item}
      isBlocked={blockedSet.has(item.id)}
      colors={colors}
      onToggle={() => handleToggle(item)}
    />
  ), [blockedSet, colors, handleToggle]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Text style={[styles.backIcon, { color: colors.foreground }]}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Blocked Channels</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {blockedChannels.length > 0
              ? `${blockedChannels.length} channel${blockedChannels.length === 1 ? '' : 's'} blocked`
              : 'Tap a channel to block it'}
          </Text>
        </View>
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, { borderBottomColor: colors.border }]}>
        <Text style={[styles.searchIcon, { color: colors.mutedForeground }]}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search channels…"
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Channel list */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading channels…
          </Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>📺</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No channels found</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {search.trim() ? 'Try a different search term.' : 'No live channels available.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(ch) => ch.id}
          renderItem={renderItem}
          getItemLayout={(_, i) => ({ length: 64, offset: 64 * i, index: i })}
          initialNumToRender={25}
          maxToRenderPerBatch={25}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          removeClippedSubviews={false}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: { fontSize: 22, lineHeight: 26 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchIcon: { fontSize: 14 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    paddingVertical: 4,
  },

  row: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    width: 42,
    height: 32,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
    position: 'relative',
  },
  initials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  blockedBadge: {
    position: 'absolute',
    top: 0, right: 0, bottom: 0, left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  blockedBadgeText: { fontSize: 14 },

  chName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chGroup: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  toggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    flexShrink: 0,
  },
  toggleBlocked: {
    backgroundColor: 'rgba(239,68,68,0.1)',
  },
  toggleText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(128,128,128,0.8)',
  },
  toggleTextBlocked: {
    color: '#EF4444',
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 32,
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 8 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
