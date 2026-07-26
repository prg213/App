import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { getXtreamLiveStreams, getXtreamXmltvUrl } from '@/services/xtreamApi';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { Channel, EpgProgram } from '@/types';

// ─── Constants ─────────────────────────────────────────────────────────────
const PX_PER_MIN = 3;
const CHANNEL_W = 145;
const ROW_H = 58;
const TIME_H = 38;
const SLOT_MINS = 30;
const WINDOW_MINS = 360; // 6 hours visible
const SLOT_W = SLOT_MINS * PX_PER_MIN; // 90px per 30-min slot
const TOTAL_W = WINDOW_MINS * PX_PER_MIN; // 1080px total grid width
const NUM_SLOTS = WINDOW_MINS / SLOT_MINS; // 12 slots

function getWindowStart(): Date {
  const now = new Date();
  const rounded = new Date(now);
  rounded.setMinutes(Math.floor(now.getMinutes() / 30) * 30, 0, 0);
  return new Date(rounded.getTime() - SLOT_MINS * 60_000); // -30 min for context
}

function fmt(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${ampm}`;
}

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

// ─── Sub-components ────────────────────────────────────────────────────────

function TimeHeader({ windowStart, colors }: { windowStart: Date; colors: any }) {
  const slots = useMemo(() =>
    Array.from({ length: NUM_SLOTS }, (_, i) => ({
      label: fmt(new Date(windowStart.getTime() + i * SLOT_MINS * 60_000)),
      x: i * SLOT_W,
    })), [windowStart]);

  return (
    <View style={[styles.timeHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {slots.map((slot, i) => (
        <View key={i} style={[styles.timeSlot, { borderLeftColor: colors.border }]}>
          <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>{slot.label}</Text>
        </View>
      ))}
    </View>
  );
}

function ChannelCell({ channel, colors }: { channel: Channel; colors: any }) {
  return (
    <View style={[styles.channelCell, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.chLogo, { backgroundColor: colors.secondary }]}>
        {channel.logo ? (
          <Image source={{ uri: channel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Text style={[styles.chInitials, { color: colors.primary }]}>
            {channel.name.slice(0, 2).toUpperCase()}
          </Text>
        )}
      </View>
      <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={2}>{channel.name}</Text>
    </View>
  );
}

function ProgramCell({
  program,
  left,
  width,
  now,
  colors,
  onPress,
}: {
  program: EpgProgram;
  left: number;
  width: number;
  now: number;
  colors: any;
  onPress: () => void;
}) {
  if (width < 6) return null;
  const isNow = program.start.getTime() <= now && now < program.end.getTime();
  const progress = isNow
    ? (now - program.start.getTime()) / (program.end.getTime() - program.start.getTime())
    : 0;

  return (
    <TouchableOpacity
      style={[
        styles.programCell,
        {
          left,
          width: width - 2,
          backgroundColor: isNow ? '#1A2A4A' : colors.secondary,
          borderColor: isNow ? '#3B82F6' : colors.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {isNow && (
        <View style={[styles.progressBar, { width: `${progress * 100}%` as any }]} />
      )}
      {width > 30 && (
        <Text style={[styles.progTitle, { color: isNow ? '#F2F2F2' : colors.foreground }]} numberOfLines={1}>
          {program.title}
        </Text>
      )}
      {width > 80 && (
        <Text style={[styles.progTime, { color: isNow ? '#93C5FD' : colors.mutedForeground }]}>
          {fmt(program.start)} – {fmt(program.end)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function ProgramRow({
  channel,
  programs,
  windowStart,
  now,
  colors,
  onProgramPress,
}: {
  channel: Channel;
  programs: EpgProgram[];
  windowStart: number;
  now: number;
  colors: any;
  onProgramPress: (p: EpgProgram, ch: Channel) => void;
}) {
  const windowEnd = windowStart + WINDOW_MINS * 60_000;

  const visible = useMemo(() =>
    programs.filter((p) => p.end.getTime() > windowStart && p.start.getTime() < windowEnd),
    [programs, windowStart, windowEnd]);

  return (
    <View style={[styles.programRow, { borderBottomColor: colors.border }]}>
      {visible.map((prog, i) => {
        const rawLeft = (prog.start.getTime() - windowStart) / 60_000 * PX_PER_MIN;
        const rawRight = (prog.end.getTime() - windowStart) / 60_000 * PX_PER_MIN;
        const left = Math.max(0, rawLeft);
        const right = Math.min(TOTAL_W, rawRight);
        const width = right - left;

        return (
          <ProgramCell
            key={i}
            program={prog}
            left={left}
            width={width}
            now={now}
            colors={colors}
            onPress={() => onProgramPress(prog, channel)}
          />
        );
      })}
      {visible.length === 0 && (
        <View style={[styles.noProg, { borderColor: colors.border }]}>
          <Text style={[styles.noProgText, { color: colors.mutedForeground }]}>No guide data</Text>
        </View>
      )}
    </View>
  );
}

// ─── Program Info Modal ────────────────────────────────────────────────────

function ProgramModal({
  program,
  channel,
  onClose,
  onWatch,
  colors,
}: {
  program: EpgProgram;
  channel: Channel;
  onClose: () => void;
  onWatch: () => void;
  colors: any;
}) {
  const durationMins = Math.round(
    (program.end.getTime() - program.start.getTime()) / 60_000,
  );
  const isNow = program.start <= new Date() && new Date() < program.end;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={1}
        >
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]} numberOfLines={2}>
                {program.title}
              </Text>
              <Text style={[styles.modalCh, { color: colors.primary }]}>{channel.name}</Text>
            </View>
            {channel.logo && (
              <View style={[styles.modalLogo, { backgroundColor: colors.secondary }]}>
                <Image source={{ uri: channel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              </View>
            )}
          </View>

          {/* Meta */}
          <View style={[styles.metaRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>START</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmt(program.start)}</Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>END</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmt(program.end)}</Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>DURATION</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>
                {durationMins >= 60
                  ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
                  : `${durationMins}m`}
              </Text>
            </View>
            {program.category && (
              <>
                <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
                <View style={styles.metaItem}>
                  <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>GENRE</Text>
                  <Text style={[styles.metaValue, { color: colors.foreground }]}>{program.category}</Text>
                </View>
              </>
            )}
          </View>

          {/* Description */}
          {program.description ? (
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]} numberOfLines={4}>
              {program.description}
            </Text>
          ) : null}

          {/* Actions */}
          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeBtnText, { color: colors.foreground }]}>Close</Text>
            </TouchableOpacity>
            {isNow && (
              <TouchableOpacity style={styles.watchBtn} onPress={onWatch} activeOpacity={0.8}>
                <Text style={styles.watchBtnText}>▶  Watch Live</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────

export default function GuideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const { height: screenH } = useWindowDimensions();
  const isXtream = credentials?.type === 'xtream';

  // Measured height of the grid container — initialised with screen height so
  // the FlatList has a valid height on first render (avoids Android blank-rows bug)
  const [gridContainerH, setGridContainerH] = useState(screenH);

  // Category filter
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // Refs for synchronized scrolling
  const timeHeaderRef = useRef<ScrollView>(null);
  const gridHorizRef = useRef<ScrollView>(null);
  const leftListRef = useRef<FlatList>(null);
  const rightListRef = useRef<FlatList>(null);
  const isLeftScrolling = useRef(false);
  const isRightScrolling = useRef(false);

  // Modal state
  const [selected, setSelected] = useState<{ program: EpgProgram; channel: Channel } | null>(null);

  // Current time (updates every minute)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const windowStart = useMemo(() => getWindowStart(), []);
  const windowStartMs = windowStart.getTime();
  const nowX = ((now - windowStartMs) / 60_000) * PX_PER_MIN;

  // ── Data fetching ──

  const creds = isXtream ? buildCreds(credentials) : null;

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['live-channels', null, credentials],
    queryFn: () => getXtreamLiveStreams(creds!),
    enabled: !!creds,
    staleTime: 5 * 60_000,
  });

  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const {
    data: epgMap,
    isLoading: epgLoading,
    error: epgError,
    refetch: refetchEpg,
  } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
    enabled: !!xmltvUrl,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  // Derive category list from channels (no extra API call needed)
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const ch of channels) {
      if (ch.groupTitle && !seen.has(ch.groupTitle)) {
        seen.add(ch.groupTitle);
        list.push(ch.groupTitle);
      }
    }
    return list;
  }, [channels]);

  // Channels filtered by selected category
  const filteredChannels = useMemo(
    () => (selectedCat ? channels.filter((c) => c.groupTitle === selectedCat) : channels),
    [channels, selectedCat],
  );

  // Reset list scroll positions when category changes
  useEffect(() => {
    leftListRef.current?.scrollToOffset({ offset: 0, animated: false });
    rightListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [selectedCat]);

  // Auto-scroll to current time on mount
  useEffect(() => {
    const scrollX = Math.max(0, nowX - SLOT_W);
    const timer = setTimeout(() => {
      gridHorizRef.current?.scrollTo({ x: scrollX, animated: false });
      timeHeaderRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 500);
    return () => clearTimeout(timer);
  }, [nowX]);

  // ── Scroll sync ──

  const onGridHorizScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      timeHeaderRef.current?.scrollTo({ x, animated: false });
    },
    [],
  );

  const onRightVertScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      if (!isRightScrolling.current) {
        isLeftScrolling.current = true;
        leftListRef.current?.scrollToOffset({ offset: y, animated: false });
        setTimeout(() => { isLeftScrolling.current = false; }, 100);
      }
      isRightScrolling.current = false;
    },
    [],
  );

  const onLeftVertScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      if (!isLeftScrolling.current) {
        isRightScrolling.current = true;
        rightListRef.current?.scrollToOffset({ offset: y, animated: false });
        setTimeout(() => { isRightScrolling.current = false; }, 100);
      }
      isLeftScrolling.current = false;
    },
    [],
  );

  // ── Render helpers ──

  // Height of the program/channel list area (grid height minus the time-header row)
  const listH = Math.max(0, gridContainerH - TIME_H);

  const renderChannelCell = useCallback(
    ({ item }: { item: Channel }) => (
      <ChannelCell channel={item} colors={colors} />
    ),
    [colors],
  );

  const renderProgramRow = useCallback(
    ({ item }: { item: Channel }) => {
      const programs = epgMap?.get(item.epgId ?? item.id) ?? [];
      return (
        <ProgramRow
          channel={item}
          programs={programs}
          windowStart={windowStartMs}
          now={now}
          colors={colors}
          onProgramPress={(p, ch) => setSelected({ program: p, channel: ch })}
        />
      );
    },
    [epgMap, windowStartMs, now, colors],
  );

  const getItemLayout = useCallback(
    (_: any, index: number) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [],
  );

  // ── Not Xtream ──
  if (!isXtream) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.empty}>
          <Text style={{ fontSize: 40, color: colors.mutedForeground }}>📋</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Guide Requires Xtream Codes</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            M3U connections don't support EPG. Connect using Xtream Codes to access the TV guide.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>TV Guide</Text>
        <View style={styles.nowBadge}>
          <View style={styles.nowDot} />
          <Text style={styles.nowLabel}>Now: {fmt(new Date(now))}</Text>
        </View>
        {epgLoading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingLabel, { color: colors.mutedForeground }]}>Loading EPG…</Text>
          </View>
        )}
        {epgError && !epgLoading && (
          <TouchableOpacity style={[styles.errBadge, { borderColor: '#EF4444' }]} onPress={() => refetchEpg()}>
            <Text style={styles.errText}>EPG failed — tap to retry</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.todayBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          onPress={() => {
            const scrollX = Math.max(0, nowX - SLOT_W);
            gridHorizRef.current?.scrollTo({ x: scrollX, animated: true });
            timeHeaderRef.current?.scrollTo({ x: scrollX, animated: true });
          }}
          activeOpacity={0.7}
        >
          <Text style={[styles.todayBtnText, { color: colors.foreground }]}>⊙ Now</Text>
        </TouchableOpacity>
      </View>

      {/* Category filter bar — sits between topBar and the grid */}
      {categories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.catBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
          contentContainerStyle={styles.catBarContent}
        >
          {/* "All" chip */}
          <TouchableOpacity
            onPress={() => setSelectedCat(null)}
            activeOpacity={0.7}
            style={[
              styles.catChip,
              { borderColor: !selectedCat ? '#3B82F6' : colors.border },
              !selectedCat && { backgroundColor: 'rgba(59,130,246,0.15)' },
            ]}
          >
            <Text style={[styles.catChipText, { color: !selectedCat ? '#3B82F6' : colors.mutedForeground }]}>
              All
            </Text>
          </TouchableOpacity>

          {categories.map((cat) => {
            const active = cat === selectedCat;
            return (
              <TouchableOpacity
                key={cat}
                onPress={() => setSelectedCat(active ? null : cat)}
                activeOpacity={0.7}
                style={[
                  styles.catChip,
                  { borderColor: active ? '#3B82F6' : colors.border },
                  active && { backgroundColor: 'rgba(59,130,246,0.15)' },
                ]}
              >
                <Text
                  style={[styles.catChipText, { color: active ? '#3B82F6' : colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Guide grid — onLayout measures the true available height */}
      <View
        style={[styles.grid, { paddingRight: insets.right }]}
        onLayout={(e) => setGridContainerH(e.nativeEvent.layout.height)}
      >
        {/* Left fixed channel column */}
        <View style={[styles.leftCol, { borderRightColor: colors.border }]}>
          {/* Corner cell aligns with time header */}
          <View style={[styles.cornerCell, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={[styles.cornerText, { color: colors.mutedForeground }]}>CH</Text>
          </View>
          {/* Channel names — flex:1 fills remaining leftCol height exactly */}
          <FlatList
            ref={leftListRef}
            data={filteredChannels}
            keyExtractor={(ch) => ch.id}
            renderItem={renderChannelCell}
            getItemLayout={getItemLayout}
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onLeftVertScroll}
            style={{ flex: 1 }}
            initialNumToRender={14}
            maxToRenderPerBatch={14}
          />
        </View>

        {/* Right scrollable area */}
        <View style={styles.rightArea}>
          {/* Time header — follows horizontal scroll */}
          <ScrollView
            ref={timeHeaderRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={{ height: TIME_H }}
          >
            <TimeHeader windowStart={windowStart} colors={colors} />
          </ScrollView>

          {/* Horizontal scroll for programs */}
          <ScrollView
            ref={gridHorizRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onGridHorizScroll}
            style={{ flex: 1 }}
          >
            {/* "Now" vertical indicator */}
            {nowX >= 0 && nowX <= TOTAL_W && listH > 0 && (
              <View
                pointerEvents="none"
                style={[styles.nowLine, { left: nowX, height: listH }]}
              />
            )}
            {/* Program rows — nestedScrollEnabled for correct Android scroll handling */}
            <FlatList
              ref={rightListRef}
              data={filteredChannels}
              keyExtractor={(ch) => ch.id}
              renderItem={renderProgramRow}
              getItemLayout={getItemLayout}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onRightVertScroll}
              nestedScrollEnabled
              style={{ width: TOTAL_W, height: listH }}
              initialNumToRender={14}
              maxToRenderPerBatch={14}
            />
          </ScrollView>
        </View>
      </View>

      {/* Program info modal */}
      {selected && (
        <ProgramModal
          program={selected.program}
          channel={selected.channel}
          colors={colors}
          onClose={() => setSelected(null)}
          onWatch={() => {
            setSelected(null);
            router.push({
              pathname: '/player',
              params: {
                url: selected.channel.streamUrl,
                title: `${selected.channel.name} — ${selected.program.title}`,
                type: 'live',
                logo: selected.channel.logo ?? '',
              },
            });
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  screenTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  nowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 99,
  },
  nowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
  nowLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
  loadingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  loadingLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  errBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  errText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#EF4444' },
  todayBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  todayBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },

  catBar: {
    height: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
    height: 40,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    borderWidth: 1,
  },
  catChipText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  grid: { flex: 1, flexDirection: 'row' },

  leftCol: {
    width: CHANNEL_W,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  cornerCell: {
    height: TIME_H,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cornerText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },

  channelCell: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chLogo: {
    width: 38,
    height: 28,
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { flex: 1, fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 14 },

  rightArea: { flex: 1, overflow: 'hidden' },

  timeHeader: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeSlot: {
    width: SLOT_W,
    height: TIME_H,
    justifyContent: 'center',
    paddingLeft: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  timeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },

  programRow: {
    height: ROW_H,
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  programCell: {
    position: 'absolute',
    top: 3,
    height: ROW_H - 6,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
    justifyContent: 'center',
    gap: 1,
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    backgroundColor: '#3B82F6',
    borderBottomLeftRadius: 5,
  },
  progTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  progTime: { fontSize: 9, fontFamily: 'Inter_400Regular' },
  noProg: {
    position: 'absolute',
    left: 4,
    top: 6,
    right: 4,
    bottom: 6,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  noProgText: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  nowLine: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: '#EF4444',
    opacity: 0.8,
    zIndex: 10,
  },

  // Modal
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: 480,
    maxWidth: '85%',
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 14,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  modalCh: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  modalLogo: {
    width: 56,
    height: 40,
    borderRadius: 8,
    overflow: 'hidden',
    flexShrink: 0,
  },
  metaRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  metaItem: { flex: 1, alignItems: 'center', gap: 3 },
  metaLabel: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  metaValue: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  metaDivider: { width: 1, marginVertical: 2 },
  modalDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  modalActions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
  closeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  closeBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  watchBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#3B82F6',
  },
  watchBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 60 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
