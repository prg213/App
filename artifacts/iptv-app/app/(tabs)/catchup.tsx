import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FocusablePressable } from '@/components/FocusablePressable';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import {
  getXtreamLiveCategories,
  getXtreamLiveStreams,
  getXtreamCatchupEpg,
  getXtreamCatchupUrls,
} from '@/services/xtreamApi';
import type { CatchupProgram, Category, Channel } from '@/types';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c?.host ?? '', username: c?.username ?? '', password: c?.password ?? '' };
}

function fmtTime(d: Date) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')}${ampm}`;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400_000);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function initialsOf(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
}

const ALL_CAT_ID = '__all__';

// ─── Category Row ─────────────────────────────────────────────────────────────

const CategoryRow = React.memo(function CategoryRow({
  cat, isSelected, colors, onPress, hasTVPreferredFocus,
}: {
  cat: Category;
  isSelected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
  hasTVPreferredFocus?: boolean;
}) {
  return (
    <FocusablePressable
      style={[
        styles.catRow,
        isSelected ? { backgroundColor: '#3B82F6' } : { borderBottomColor: colors.border },
      ]}
      onPress={onPress}
      hasTVPreferredFocus={hasTVPreferredFocus}
    >
      <Text
        style={[styles.catRowText, { color: isSelected ? '#fff' : colors.foreground }]}
        numberOfLines={2}
      >
        {cat.name}
      </Text>
    </FocusablePressable>
  );
});

// ─── Channel Row ──────────────────────────────────────────────────────────────

const ChannelRow = React.memo(React.forwardRef<View, {
  ch: Channel;
  isSelected: boolean;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}>(function ChannelRow({ ch, isSelected, colors, onPress }, ref) {
  return (
    <FocusablePressable
      ref={ref}
      style={[
        styles.chRow,
        { borderBottomColor: colors.border },
        isSelected && { backgroundColor: '#2563EB' },
      ]}
      onPress={onPress}
    >
      <View style={[styles.chLogo, { backgroundColor: colors.muted }]}>
        {ch.logo ? (
          <Image source={{ uri: ch.logo }} style={{ width: 34, height: 24 }} resizeMode="contain" />
        ) : (
          <Text style={[styles.chInitials, { color: colors.mutedForeground }]}>{initialsOf(ch.name)}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[styles.chName, { color: isSelected ? '#fff' : colors.foreground }]}
          numberOfLines={1}
        >
          {ch.name}
        </Text>
        {(ch.tvArchiveDuration ?? 0) > 0 && (
          <Text style={[styles.chSub, { color: isSelected ? '#93C5FD' : colors.mutedForeground }]}>
            {ch.tvArchiveDuration}d archive
          </Text>
        )}
      </View>
    </FocusablePressable>
  );
}));

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function CatchupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();

  const isXtream = credentials?.type === 'xtream';
  const creds = isXtream ? buildCreds(credentials) : null;

  const [selectedCatId, setSelectedCatId] = useState<string>(ALL_CAT_ID);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Refs for auto-advancing D-pad focus between columns
  const firstChannelRef = useRef<View>(null);
  const firstProgRef = useRef<View>(null);
  // Set to true when a channel is selected so the useEffect below fires focus
  // once the programme list data arrives (EPG is fetched asynchronously).
  const pendingProgFocusRef = useRef(false);

  // D-pad / remote back: close programme list → reset category → hand off to
  // the global handler which focuses the sidebar.
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedChannel) { setSelectedChannel(null); return true; }
      if (selectedCatId !== ALL_CAT_ID) { setSelectedCatId(ALL_CAT_ID); return true; }
      return false;
    });
    return () => sub.remove();
  }, [selectedChannel, selectedCatId]));

  // ── Categories ──
  const { data: rawCategories = [], isLoading: catLoading } = useQuery<Category[]>({
    queryKey: ['live-categories', credentials],
    queryFn: () => getXtreamLiveCategories(creds!),
    enabled: !!creds,
    staleTime: 5 * 60_000,
  });

  // ── All live channels (shared cache key with guide.tsx) ──
  const { data: allChannels = [], isLoading: chLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels', null, credentials],
    queryFn: () => getXtreamLiveStreams(creds!),
    enabled: !!creds,
    staleTime: 5 * 60_000,
  });

  // Only catchup-enabled channels
  const catchupChannels = useMemo(
    () => allChannels.filter((c) => (c.tvArchive ?? 0) === 1 && (c.tvArchiveDuration ?? 0) > 0),
    [allChannels],
  );

  // Categories that actually have at least one catchup channel
  const categories = useMemo(() => {
    const withCatchup = new Set(catchupChannels.map((c) => c.groupTitle));
    const filtered = rawCategories.filter((c) => withCatchup.has(c.id));
    const all: Category = { id: ALL_CAT_ID, name: 'All' };
    return [all, ...filtered];
  }, [rawCategories, catchupChannels]);

  // Channels for the selected category
  const visibleChannels = useMemo(() => {
    if (selectedCatId === ALL_CAT_ID) return catchupChannels;
    return catchupChannels.filter((c) => c.groupTitle === selectedCatId);
  }, [catchupChannels, selectedCatId]);

  // ── Archive EPG for selected channel ──
  const { data: programs = [], isLoading: epgLoading } = useQuery<CatchupProgram[]>({
    queryKey: ['catchup-epg', selectedChannel?.id, credentials],
    queryFn: () => getXtreamCatchupEpg(creds!, selectedChannel!.id),
    enabled: !!creds && !!selectedChannel,
    staleTime: 10 * 60_000,
  });

  // Only ended programmes with archive, grouped by day (newest first)
  const { days, byDay } = useMemo(() => {
    const now = Date.now();
    const playable = programs.filter((p) => p.hasArchive && p.end.getTime() <= now);
    const map = new Map<string, CatchupProgram[]>();
    for (const p of playable) {
      const k = dayKey(p.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    for (const list of map.values()) list.sort((a, b) => b.start.getTime() - a.start.getTime());
    const sortedDays = [...map.keys()].sort((a, b) => {
      const pa = map.get(a)![0]?.start.getTime() ?? 0;
      const pb = map.get(b)![0]?.start.getTime() ?? 0;
      return pb - pa;
    });
    return { days: sortedDays, byDay: map };
  }, [programs]);

  const activeDay = selectedDay && byDay.has(selectedDay) ? selectedDay : days[0] ?? null;
  const dayPrograms = activeDay ? byDay.get(activeDay) ?? [] : [];

  const handleSelectCat = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCatId(id);
    setSelectedChannel(null);
    setSelectedDay(null);
    // Auto-advance D-pad focus to the first channel in col 2
    setTimeout(() => { firstChannelRef.current?.focus(); }, 80);
  }, []);

  const handleSelectChannel = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedChannel(ch);
    setSelectedDay(null);
    // Mark that we want to focus the first programme once EPG data arrives
    pendingProgFocusRef.current = true;
  }, []);

  // Auto-advance D-pad focus to the first programme row once EPG data loads
  useEffect(() => {
    if (pendingProgFocusRef.current && dayPrograms.length > 0) {
      pendingProgFocusRef.current = false;
      setTimeout(() => { firstProgRef.current?.focus(); }, 80);
    }
  }, [dayPrograms]);

  const handlePlay = useCallback((prog: CatchupProgram) => {
    if (!creds || !selectedChannel) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const durationMin = Math.max(1, Math.round((prog.end.getTime() - prog.start.getTime()) / 60_000));
    // getXtreamCatchupUrls returns [formatB (?utc=), formatA (/timeshift/)] — try B first
    const url = getXtreamCatchupUrls(creds, selectedChannel.id, prog.serverStart, durationMin, prog.startTimestamp)[0];
    router.push({
      pathname: '/player',
      params: {
        url,
        title: `${prog.title} — ${selectedChannel.name}`,
        type: 'catchup',
        logo: selectedChannel.logo ?? '',
        // Pass the known programme duration so the scrubber can show a progress
        // bar — timeshift HLS streams don't expose duration to expo-video.
        knownDuration: String(durationMin * 60),
        // Extra fields needed to regenerate the timeshift URL when the user seeks
        catchupStreamId: selectedChannel.id,
        catchupServerStart: prog.serverStart,
        catchupStartTimestamp: String(prog.startTimestamp),
      },
    });
  }, [creds, selectedChannel, router]);

  const renderCategory = useCallback(({ item, index }: { item: Category; index: number }) => (
    <CategoryRow
      cat={item}
      isSelected={item.id === selectedCatId}
      colors={colors}
      onPress={() => handleSelectCat(item.id)}
      hasTVPreferredFocus={index === 0}
    />
  ), [selectedCatId, colors, handleSelectCat]);

  const renderChannel = useCallback(({ item, index }: { item: Channel; index: number }) => (
    <ChannelRow
      ref={index === 0 ? firstChannelRef : undefined}
      ch={item}
      isSelected={item.id === selectedChannel?.id}
      colors={colors}
      onPress={() => handleSelectChannel(item)}
    />
  ), [selectedChannel?.id, colors, handleSelectChannel]);

  // ── Non-Xtream fallback ──
  if (!isXtream) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 36, marginBottom: 10 }}>⏪</Text>
        <Text style={[styles.noSelTitle, { color: colors.foreground }]}>Catch Up unavailable</Text>
        <Text style={[styles.noSelSub, { color: colors.mutedForeground, textAlign: 'center', maxWidth: 400 }]}>
          Catch-up TV requires an Xtream Codes connection. M3U playlists don't support archive playback.
        </Text>
      </View>
    );
  }

  const loading = catLoading || chLoading;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>

      {/* ══ COL 1: Categories ══ */}
      <View style={[styles.catCol, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.colHeader, { color: colors.mutedForeground }]}>CATEGORIES</Text>
        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            data={categories}
            keyExtractor={(c) => c.id}
            renderItem={renderCategory}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          />
        )}
      </View>

      {/* ══ COL 2: Channels ══ */}
      <View style={[styles.chCol, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.colHeader, { color: colors.mutedForeground }]}>CHANNELS</Text>
        {loading ? (
          <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
        ) : visibleChannels.length === 0 ? (
          <View style={styles.centerFill}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'center', paddingHorizontal: 16 }}>
              No catch-up channels{'\n'}in this category
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleChannels}
            keyExtractor={(c) => c.id}
            renderItem={renderChannel}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          />
        )}
      </View>

      {/* ══ COL 3: Archive programmes ══ */}
      <View style={[styles.progPanel, { paddingTop: insets.top + 4, paddingRight: insets.right + 8 }]}>
        {!selectedChannel ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>⏪</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>Select a channel</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Pick a channel to browse its archived programmes.
            </Text>
          </View>
        ) : epgLoading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 8 }}>Loading archive…</Text>
          </View>
        ) : days.length === 0 ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 30, marginBottom: 10 }}>📭</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No archive found</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              This channel reports catch-up support but returned no replayable programmes.
            </Text>
          </View>
        ) : (
          <>
            {/* Day tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={styles.dayTabs}
            >
              {days.map((k) => {
                const first = byDay.get(k)![0];
                const active = k === activeDay;
                return (
                  <FocusablePressable
                    key={k}
                    style={[
                      styles.dayTab,
                      { borderColor: colors.border },
                      active && { backgroundColor: '#2563EB', borderColor: '#2563EB' },
                    ]}
                    onPress={() => setSelectedDay(k)}
                  >
                    <Text style={[styles.dayTabText, { color: active ? '#fff' : colors.mutedForeground }]}>
                      {dayLabel(first.start)}
                    </Text>
                  </FocusablePressable>
                );
              })}
            </ScrollView>

            {/* Programme list */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
            >
              {dayPrograms.map((prog, progIdx) => (
                <FocusablePressable
                  key={prog.id}
                  ref={progIdx === 0 ? firstProgRef : undefined}
                  style={[styles.progRow, { borderBottomColor: colors.border }]}
                  onPress={() => handlePlay(prog)}
                >
                  <View style={styles.progTimeCol}>
                    <Text style={[styles.progTime, { color: colors.mutedForeground }]}>
                      {fmtTime(prog.start)}
                    </Text>
                    <Text style={[styles.progDur, { color: colors.mutedForeground }]}>
                      {Math.round((prog.end.getTime() - prog.start.getTime()) / 60_000)}m
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.progTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {prog.title}
                    </Text>
                    {prog.description ? (
                      <Text style={[styles.progDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                        {prog.description}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ color: '#3B82F6', fontSize: 16, marginLeft: 8 }}>▶</Text>
                </FocusablePressable>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  colHeader: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8,
  },

  // Col 1 — categories
  catCol: { width: 180, borderRightWidth: StyleSheet.hairlineWidth },
  catRow: {
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catRowText: { fontSize: 12.5, fontFamily: 'Inter_500Medium' },

  // Col 2 — channels
  chCol: { width: 220, borderRightWidth: StyleSheet.hairlineWidth },
  chRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chLogo: {
    width: 42, height: 30, borderRadius: 4, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 12.5, fontFamily: 'Inter_500Medium' },
  chSub: { fontSize: 10.5, fontFamily: 'Inter_400Regular', marginTop: 1 },

  // Col 3 — programmes
  progPanel: { flex: 1, paddingLeft: 14 },
  dayTabs: { flexDirection: 'row', gap: 8, paddingVertical: 8 },
  dayTab: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1,
  },
  dayTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  progRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  progTimeCol: { width: 74, flexShrink: 0 },
  progTime: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  progDur: { fontSize: 10.5, fontFamily: 'Inter_400Regular', marginTop: 1 },
  progTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  progDesc: { fontSize: 11.5, fontFamily: 'Inter_400Regular', marginTop: 2, lineHeight: 15 },

  noSel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  noSelTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  noSelSub: { fontSize: 12.5, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
