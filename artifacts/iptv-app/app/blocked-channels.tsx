import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { TVTextInput } from '@/components/TVTextInput';
import { useRouter } from 'expo-router';
import { FocusablePressable } from '@/components/FocusablePressable';
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
    <FocusablePressable
      style={[
        styles.row,
        { borderBottomColor: colors.border },
        isBlocked && { backgroundColor: 'rgba(239,68,68,0.06)' },
      ]}
      onPress={onToggle}
    >
      <View style={[styles.logo, { backgroundColor: colors.secondary }]}>
        {channel.logo ? (
          <Image source={{ uri: channel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
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
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.chName, { color: isBlocked ? colors.mutedForeground : colors.foreground }]} numberOfLines={1}>
          {channel.name}
        </Text>
        {channel.groupTitle ? (
          <Text style={[styles.chGroup, { color: colors.mutedForeground }]} numberOfLines={1}>
            {channel.groupTitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.toggle, { borderColor: isBlocked ? '#EF4444' : colors.border }, isBlocked && styles.toggleBlocked]}>
        <Text style={[styles.toggleText, isBlocked && styles.toggleTextBlocked]}>
          {isBlocked ? 'Blocked' : 'Allow'}
        </Text>
      </View>
    </FocusablePressable>
  );
});

// ─── Category Row ─────────────────────────────────────────────────────────────

const CategoryBlockRow = React.memo(function CategoryBlockRow({
  groupTitle,
  channels,
  blockedSet,
  colors,
  onToggle,
}: {
  groupTitle: string;
  channels: Channel[];
  blockedSet: Set<string>;
  colors: ReturnType<typeof useColors>;
  onToggle: (channels: Channel[]) => void;
}) {
  const blockedCount = channels.filter((ch) => blockedSet.has(ch.id)).length;
  const allBlocked = blockedCount === channels.length;
  const someBlocked = blockedCount > 0 && !allBlocked;

  return (
    <FocusablePressable
      style={[
        styles.catRow,
        { borderBottomColor: colors.border },
        allBlocked && { backgroundColor: 'rgba(239,68,68,0.06)' },
      ]}
      onPress={() => onToggle(channels)}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[styles.chName, { color: allBlocked ? colors.mutedForeground : colors.foreground }]} numberOfLines={1}>
          {groupTitle}
        </Text>
        <Text style={[styles.chGroup, { color: colors.mutedForeground }]}>
          {channels.length} channel{channels.length === 1 ? '' : 's'}
          {blockedCount > 0 ? ` · ${blockedCount} blocked` : ''}
        </Text>
      </View>
      <View style={[
        styles.toggle,
        {
          borderColor: allBlocked ? '#EF4444' : someBlocked ? '#F59E0B' : colors.border,
        },
        allBlocked && styles.toggleBlocked,
        someBlocked && styles.togglePartial,
      ]}>
        <Text style={[
          styles.toggleText,
          allBlocked && styles.toggleTextBlocked,
          someBlocked && styles.toggleTextPartial,
        ]}>
          {allBlocked ? 'All blocked' : someBlocked ? 'Partial' : 'Allow all'}
        </Text>
      </View>
    </FocusablePressable>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

type ViewMode = 'channels' | 'categories';

export default function BlockedChannelsScreen() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { credentials } = useAppContext();
  const { blockedChannels, toggleBlockedChannel, setBlockedChannelIds } = useParentalContext();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('channels');

  const { data: allChannels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels-all', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (credentials.type === 'xtream' && credentials.host && credentials.username && credentials.password) {
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

  // ── #11: Remove orphaned block IDs when channel list loads ────────────────
  useEffect(() => {
    if (!allChannels.length || !blockedChannels.length) return;
    const validIds = new Set(allChannels.map((ch) => ch.id));
    const cleaned = blockedChannels.filter((id) => validIds.has(id));
    if (cleaned.length < blockedChannels.length) {
      setBlockedChannelIds(cleaned);
    }
  }, [allChannels]);

  // ── #10: Derive category groups ───────────────────────────────────────────
  const categories = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const ch of allChannels) {
      const group = ch.groupTitle || 'Other';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(ch);
    }
    return Array.from(map.entries()).map(([name, chs]) => ({ name, channels: chs }));
  }, [allChannels]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allChannels;
    const q = search.toLowerCase();
    return allChannels.filter((ch) => ch.name.toLowerCase().includes(q));
  }, [allChannels, search]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.filter((cat) => cat.name.toLowerCase().includes(q));
  }, [categories, search]);

  const handleToggle = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleBlockedChannel(ch.id);
  }, [toggleBlockedChannel]);

  // ── #10: Toggle all channels in a category ────────────────────────────────
  const handleCategoryToggle = useCallback((chs: Channel[]) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const idsInCat = chs.map((ch) => ch.id);
    const allBlocked = idsInCat.every((id) => blockedSet.has(id));
    let newIds: string[];
    if (allBlocked) {
      // Unblock all in category
      const unblockSet = new Set(idsInCat);
      newIds = blockedChannels.filter((id) => !unblockSet.has(id));
    } else {
      // Block all in category
      newIds = [...new Set([...blockedChannels, ...idsInCat])];
    }
    setBlockedChannelIds(newIds);
  }, [blockedSet, blockedChannels, setBlockedChannelIds]);

  const renderChannel = useCallback(({ item }: { item: Channel }) => (
    <ChannelBlockRow
      channel={item}
      isBlocked={blockedSet.has(item.id)}
      colors={colors}
      onToggle={() => handleToggle(item)}
    />
  ), [blockedSet, colors, handleToggle]);

  const renderCategory = useCallback(({ item }: { item: { name: string; channels: Channel[] } }) => (
    <CategoryBlockRow
      groupTitle={item.name}
      channels={item.channels}
      blockedSet={blockedSet}
      colors={colors}
      onToggle={handleCategoryToggle}
    />
  ), [blockedSet, colors, handleCategoryToggle]);

  const listData = viewMode === 'channels' ? filtered : filteredCategories;
  const isEmpty = (viewMode === 'channels' ? filtered : filteredCategories).length === 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <FocusablePressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={[styles.backIcon, { color: colors.foreground }]}>←</Text>
        </FocusablePressable>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Blocked Channels</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {blockedChannels.length > 0
              ? `${blockedChannels.length} channel${blockedChannels.length === 1 ? '' : 's'} blocked`
              : 'Tap a channel or category to block it'}
          </Text>
        </View>
      </View>

      {/* View mode toggle */}
      <View style={[styles.segRow, { borderBottomColor: colors.border }]}>
        {(['channels', 'categories'] as ViewMode[]).map((mode) => (
          <FocusablePressable
            key={mode}
            style={[styles.seg, viewMode === mode && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => { setViewMode(mode); setSearch(''); }}
          >
            <Text style={[styles.segText, { color: viewMode === mode ? colors.primary : colors.mutedForeground }]}>
              {mode === 'channels' ? 'Channels' : 'Categories'}
            </Text>
          </FocusablePressable>
        ))}
      </View>

      {/* Search bar */}
      <View style={[styles.searchWrap, { borderBottomColor: colors.border }]}>
        <Text style={[styles.searchIcon, { color: colors.mutedForeground }]}>🔍</Text>
        <TVTextInput
          focusable
          style={[styles.searchInput, { color: colors.foreground }]}
          value={search}
          onChangeText={setSearch}
          placeholder={viewMode === 'channels' ? 'Search channels…' : 'Search categories…'}
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
        />
      </View>

      {/* List */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading channels…</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 36, marginBottom: 12 }}>📺</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {viewMode === 'channels' ? 'No channels found' : 'No categories found'}
          </Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            {search.trim() ? 'Try a different search term.' : 'No live channels available.'}
          </Text>
        </View>
      ) : viewMode === 'channels' ? (
        <FlatList
          data={filtered}
          keyExtractor={(ch) => ch.id}
          renderItem={renderChannel}
          getItemLayout={(_, i) => ({ length: 64, offset: 64 * i, index: i })}
          initialNumToRender={25}
          maxToRenderPerBatch={25}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          removeClippedSubviews={false}
        />
      ) : (
        <FlatList
          data={filteredCategories}
          keyExtractor={(cat) => cat.name}
          renderItem={renderCategory}
          getItemLayout={(_, i) => ({ length: 72, offset: 72 * i, index: i })}
          initialNumToRender={25}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
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
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  backIcon: { fontSize: 22, lineHeight: 26 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },

  segRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seg: {
    flex: 1,
    paddingVertical: 11,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  segText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

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
  catRow: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: {
    width: 42, height: 32, borderRadius: 4,
    overflow: 'hidden', justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, position: 'relative',
  },
  initials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  blockedBadge: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  blockedBadgeText: { fontSize: 14 },

  chName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chGroup: { fontSize: 11, fontFamily: 'Inter_400Regular' },

  toggle: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, flexShrink: 0,
  },
  toggleBlocked: { backgroundColor: 'rgba(239,68,68,0.1)' },
  togglePartial: { backgroundColor: 'rgba(245,158,11,0.1)' },
  toggleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: 'rgba(128,128,128,0.8)' },
  toggleTextBlocked: { color: '#EF4444' },
  toggleTextPartial: { color: '#F59E0B' },

  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    gap: 8, paddingHorizontal: 32,
  },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 8 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
