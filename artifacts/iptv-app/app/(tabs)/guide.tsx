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

// ─── Guide constants ────────────────────────────────────────────────────────
const PX_PER_MIN = 2;
const CHANNEL_W = 145;
const ROW_H = 58;
const TIME_H = 38;
const SLOT_MINS = 60;           // 1-hour time slots
const DAY_MINS = 24 * 60;       // full day
const SLOT_W = SLOT_MINS * PX_PER_MIN;   // 120px per hour
const TOTAL_DAY_W = DAY_MINS * PX_PER_MIN; // 2880px

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${ampm}`;
}

function fmtDayLabel(d: Date, index: number): { short: string; long: string } {
  if (index === 0) return { short: 'Today', long: 'Today' };
  if (index === 1) return { short: 'Tmrw', long: 'Tomorrow' };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    short: `${days[d.getDay()]} ${d.getDate()}`,
    long: `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`,
  };
}

/** Midnight (00:00) of a day offset from today */
function dayStart(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return { host: c!.host!, username: c!.username!, password: c!.password! };
}

// ─── Category grid card ─────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  news: '📰', sport: '⚽', sports: '⚽', movie: '🎬', movies: '🎬',
  film: '🎬', kids: '👶', children: '👶', music: '🎵', documentary: '🎥',
  docs: '🎥', entertainment: '🎭', comedy: '😄', drama: '🎭',
  science: '🔬', nature: '🌿', travel: '✈️', food: '🍽️', cooking: '🍽️',
  fitness: '💪', health: '💊', business: '💼', tech: '💻', gaming: '🎮',
  religion: '⛪', lifestyle: '🌟', reality: '📺', action: '💥',
};

function getCatIcon(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return '📺';
}

// ─── Time header ─────────────────────────────────────────────────────────────

function TimeHeader({ dayStartMs, colors }: { dayStartMs: number; colors: any }) {
  const slots = useMemo(() =>
    Array.from({ length: 24 }, (_, i) => ({
      label: fmtTime(new Date(dayStartMs + i * SLOT_MINS * 60_000)),
    })), [dayStartMs]);

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

// ─── Channel cell ─────────────────────────────────────────────────────────────

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

// ─── Program cell ─────────────────────────────────────────────────────────────

const ProgramCell = React.memo(function ProgramCell({
  program, left, width, now, colors, onPress,
}: {
  program: EpgProgram; left: number; width: number; now: number;
  colors: any; onPress: () => void;
}) {
  if (width < 6) return null;
  const isNow = program.start.getTime() <= now && now < program.end.getTime();
  const progress = isNow
    ? (now - program.start.getTime()) / (program.end.getTime() - program.start.getTime())
    : 0;

  return (
    <TouchableOpacity
      style={[styles.programCell, {
        left, width: width - 2,
        backgroundColor: isNow ? '#1A2A4A' : colors.secondary,
        borderColor: isNow ? '#3B82F6' : colors.border,
      }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {isNow && <View style={[styles.progressBar, { width: `${progress * 100}%` as any }]} />}
      {width > 30 && (
        <Text style={[styles.progTitle, { color: isNow ? '#F2F2F2' : colors.foreground }]} numberOfLines={1}>
          {program.title}
        </Text>
      )}
      {width > 80 && (
        <Text style={[styles.progTime, { color: isNow ? '#93C5FD' : colors.mutedForeground }]}>
          {fmtTime(program.start)} – {fmtTime(program.end)}
        </Text>
      )}
    </TouchableOpacity>
  );
});

// ─── Program row ─────────────────────────────────────────────────────────────

const ProgramRow = React.memo(function ProgramRow({
  channel, programs, dayStartMs, now, colors, onProgramPress,
}: {
  channel: Channel; programs: EpgProgram[]; dayStartMs: number; now: number;
  colors: any; onProgramPress: (p: EpgProgram, ch: Channel) => void;
}) {
  const dayEndMs = dayStartMs + DAY_MINS * 60_000;

  const visible = useMemo(() =>
    programs.filter((p) => p.end.getTime() > dayStartMs && p.start.getTime() < dayEndMs),
    [programs, dayStartMs, dayEndMs]);

  return (
    <View style={[styles.programRow, { borderBottomColor: colors.border }]}>
      {visible.map((prog, i) => {
        const rawLeft = (prog.start.getTime() - dayStartMs) / 60_000 * PX_PER_MIN;
        const rawRight = (prog.end.getTime() - dayStartMs) / 60_000 * PX_PER_MIN;
        const left = Math.max(0, rawLeft);
        const right = Math.min(TOTAL_DAY_W, rawRight);
        const width = right - left;
        return (
          <ProgramCell
            key={i} program={prog} left={left} width={width} now={now} colors={colors}
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
});

// ─── Program info modal ───────────────────────────────────────────────────────

function ProgramModal({ program, channel, onClose, onWatch, colors }: {
  program: EpgProgram; channel: Channel; onClose: () => void;
  onWatch: () => void; colors: any;
}) {
  const durationMins = Math.round((program.end.getTime() - program.start.getTime()) / 60_000);
  const isNow = program.start <= new Date() && new Date() < program.end;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity
          style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={1}
        >
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

          <View style={[styles.metaRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>START</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmtTime(program.start)}</Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>END</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>{fmtTime(program.end)}</Text>
            </View>
            <View style={[styles.metaDivider, { backgroundColor: colors.border }]} />
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground }]}>DURATION</Text>
              <Text style={[styles.metaValue, { color: colors.foreground }]}>
                {durationMins >= 60 ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m` : `${durationMins}m`}
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

          {program.description ? (
            <Text style={[styles.modalDesc, { color: colors.mutedForeground }]} numberOfLines={4}>
              {program.description}
            </Text>
          ) : null}

          <View style={styles.modalActions}>
            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={onClose} activeOpacity={0.7}
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

// ─── Category grid ────────────────────────────────────────────────────────────

function CategoryGrid({
  categories, channelCountByCategory, colors, insets, onSelect, epgLoading,
}: {
  categories: string[];
  channelCountByCategory: Record<string, number>;
  colors: any;
  insets: any;
  onSelect: (cat: string) => void;
  epgLoading: boolean;
}) {
  const { width } = useWindowDimensions();
  const availW = width - 190; // sidebar is 190px
  const numCols = Math.max(2, Math.floor(availW / 180));
  const colW = Math.floor((availW - (numCols + 1) * 12) / numCols);

  const renderItem = useCallback(({ item }: { item: string }) => {
    const icon = getCatIcon(item);
    const count = channelCountByCategory[item] ?? 0;
    return (
      <TouchableOpacity
        style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border, width: colW }]}
        onPress={() => onSelect(item)}
        activeOpacity={0.75}
      >
        {/* Icon bubble */}
        <View style={[styles.catIconBubble, { backgroundColor: colors.secondary }]}>
          <Text style={styles.catIcon}>{icon}</Text>
        </View>
        {/* Text */}
        <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={2}>{item}</Text>
        {/* Channel count badge */}
        <View style={[styles.catCountBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.catCount, { color: colors.mutedForeground }]}>{count} channels</Text>
        </View>
      </TouchableOpacity>
    );
  }, [colors, colW, channelCountByCategory, onSelect]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>TV Guide</Text>
        <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>Select a category to view the 7-day schedule</Text>
        {epgLoading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingLabel, { color: colors.mutedForeground }]}>Loading EPG…</Text>
          </View>
        )}
      </View>

      <FlatList
        data={categories}
        keyExtractor={(c) => c}
        numColumns={numCols}
        renderItem={renderItem}
        key={numCols}
        contentContainerStyle={[styles.catGrid, { paddingBottom: insets.bottom + 24 }]}
        columnWrapperStyle={numCols > 1 ? styles.catRow : undefined}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

// ─── Full 7-day guide ──────────────────────────────────────────────────────────

function FullGuide({
  channels, epgMap, epgLoading, epgError, refetchEpg, onBack, categoryName, colors, insets, router,
}: {
  channels: Channel[];
  epgMap: Map<string, EpgProgram[]> | undefined;
  epgLoading: boolean;
  epgError: any;
  refetchEpg: () => void;
  onBack: () => void;
  categoryName: string;
  colors: any;
  insets: any;
  router: any;
}) {
  const { height: screenH } = useWindowDimensions();
  const [gridContainerH, setGridContainerH] = useState(screenH);
  const [selectedDay, setSelectedDay] = useState(0);
  const [selected, setSelected] = useState<{ program: EpgProgram; channel: Channel } | null>(null);
  const [now, setNow] = useState(Date.now());

  // 7 day labels
  const days = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = dayStart(i);
      return { ...fmtDayLabel(d, i), date: d };
    }), []);

  const dayStartMs = useMemo(() => dayStart(selectedDay).getTime(), [selectedDay]);
  const nowX = ((now - dayStartMs) / 60_000) * PX_PER_MIN;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Refs for scroll sync
  const timeHeaderRef = useRef<ScrollView>(null);
  const gridHorizRef = useRef<ScrollView>(null);
  const leftListRef = useRef<FlatList>(null);
  const rightListRef = useRef<FlatList>(null);
  const isLeftScrolling = useRef(false);
  const isRightScrolling = useRef(false);

  // When day changes, scroll to current time (today) or start of day (other days)
  useEffect(() => {
    const scrollX = selectedDay === 0 ? Math.max(0, nowX - SLOT_W * 2) : 0;
    const timer = setTimeout(() => {
      gridHorizRef.current?.scrollTo({ x: scrollX, animated: false });
      timeHeaderRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedDay, nowX]);

  const onGridHorizScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    timeHeaderRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  }, []);

  const onRightVertScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (!isRightScrolling.current) {
      isLeftScrolling.current = true;
      leftListRef.current?.scrollToOffset({ offset: y, animated: false });
      setTimeout(() => { isLeftScrolling.current = false; }, 100);
    }
    isRightScrolling.current = false;
  }, []);

  const onLeftVertScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (!isLeftScrolling.current) {
      isRightScrolling.current = true;
      rightListRef.current?.scrollToOffset({ offset: y, animated: false });
      setTimeout(() => { isRightScrolling.current = false; }, 100);
    }
    isLeftScrolling.current = false;
  }, []);

  const listH = Math.max(0, gridContainerH - TIME_H);

  const renderChannelCell = useCallback(
    ({ item }: { item: Channel }) => <ChannelCell channel={item} colors={colors} />,
    [colors],
  );

  const renderProgramRow = useCallback(({ item }: { item: Channel }) => {
    const programs = epgMap?.get(item.epgId ?? item.id) ?? [];
    return (
      <ProgramRow
        channel={item} programs={programs} dayStartMs={dayStartMs}
        now={now} colors={colors}
        onProgramPress={(p, ch) => setSelected({ program: p, channel: ch })}
      />
    );
  }, [epgMap, dayStartMs, now, colors]);

  const getItemLayout = useCallback(
    (_: any, index: number) => ({ length: ROW_H, offset: ROW_H * index, index }),
    [],
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 4 }]}>
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          onPress={onBack}
          activeOpacity={0.7}
        >
          <Text style={[styles.backArrow, { color: colors.foreground }]}>←</Text>
          <Text style={[styles.backLabel, { color: colors.foreground }]}>Categories</Text>
        </TouchableOpacity>
        <Text style={[styles.screenTitle, { color: colors.foreground }]} numberOfLines={1}>{categoryName}</Text>

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

        {/* Now button */}
        {selectedDay === 0 && (
          <TouchableOpacity
            style={[styles.todayBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            onPress={() => {
              const scrollX = Math.max(0, nowX - SLOT_W * 2);
              gridHorizRef.current?.scrollTo({ x: scrollX, animated: true });
              timeHeaderRef.current?.scrollTo({ x: scrollX, animated: true });
            }}
            activeOpacity={0.7}
          >
            <View style={styles.nowDot} />
            <Text style={[styles.todayBtnText, { color: '#EF4444' }]}>Now</Text>
          </TouchableOpacity>
        )}

        <Text style={[styles.chCountLabel, { color: colors.mutedForeground }]}>
          {channels.length} channels
        </Text>
      </View>

      {/* 7-day tab strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.dayBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}
        contentContainerStyle={styles.dayBarContent}
      >
        {days.map((d, i) => (
          <TouchableOpacity
            key={i}
            style={[
              styles.dayTab,
              i === selectedDay
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: 'transparent', borderColor: colors.border },
            ]}
            onPress={() => setSelectedDay(i)}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.dayTabText,
              { color: i === selectedDay ? '#fff' : colors.mutedForeground },
            ]}>
              {d.short}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* EPG grid */}
      <View
        style={[styles.grid, { paddingRight: insets.right }]}
        onLayout={(e) => setGridContainerH(e.nativeEvent.layout.height)}
      >
        {/* Left channel column */}
        <View style={[styles.leftCol, { borderRightColor: colors.border }]}>
          <View style={[styles.cornerCell, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Text style={[styles.cornerText, { color: colors.mutedForeground }]}>CH</Text>
          </View>
          <FlatList
            ref={leftListRef}
            data={channels}
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

        {/* Right scrollable program area */}
        <View style={styles.rightArea}>
          <ScrollView
            ref={timeHeaderRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={{ height: TIME_H }}
          >
            <TimeHeader dayStartMs={dayStartMs} colors={colors} />
          </ScrollView>

          <ScrollView
            ref={gridHorizRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={onGridHorizScroll}
            style={{ flex: 1 }}
          >
            {/* "Now" line — only visible on today's view */}
            {selectedDay === 0 && nowX >= 0 && nowX <= TOTAL_DAY_W && listH > 0 && (
              <View pointerEvents="none" style={[styles.nowLine, { left: nowX, height: listH }]} />
            )}

            <FlatList
              ref={rightListRef}
              data={channels}
              keyExtractor={(ch) => ch.id}
              renderItem={renderProgramRow}
              getItemLayout={getItemLayout}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onRightVertScroll}
              nestedScrollEnabled
              style={{ width: TOTAL_DAY_W, height: listH }}
              initialNumToRender={14}
              maxToRenderPerBatch={14}
            />
          </ScrollView>
        </View>
      </View>

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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GuideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const isXtream = credentials?.type === 'xtream';

  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const creds = isXtream ? buildCreds(credentials) : null;

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['live-channels', null, credentials],
    queryFn: () => getXtreamLiveStreams(creds!),
    enabled: !!creds,
    staleTime: 5 * 60_000,
  });

  const xmltvUrl = creds ? getXtreamXmltvUrl(creds) : null;

  const { data: epgMap, isLoading: epgLoading, error: epgError, refetch: refetchEpg } =
    useQuery<Map<string, EpgProgram[]>>({
      queryKey: ['xmltv-epg', credentials],
      queryFn: ({ signal }) => fetchAndParseXmltv(xmltvUrl!, signal),
      enabled: !!xmltvUrl,
      staleTime: 30 * 60_000,
      gcTime: 60 * 60_000,
      retry: 1,
    });

  // Sorted unique categories from channels
  const categories = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const ch of channels) {
      if (ch.groupTitle && !seen.has(ch.groupTitle)) {
        seen.add(ch.groupTitle);
        list.push(ch.groupTitle);
      }
    }
    return list.sort((a, b) => a.localeCompare(b));
  }, [channels]);

  const channelCountByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ch of channels) {
      if (ch.groupTitle) map[ch.groupTitle] = (map[ch.groupTitle] ?? 0) + 1;
    }
    return map;
  }, [channels]);

  const filteredChannels = useMemo(
    () => (selectedCat ? channels.filter((c) => c.groupTitle === selectedCat) : channels),
    [channels, selectedCat],
  );

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

  if (selectedCat) {
    return (
      <FullGuide
        channels={filteredChannels}
        epgMap={epgMap}
        epgLoading={epgLoading}
        epgError={epgError}
        refetchEpg={refetchEpg}
        onBack={() => setSelectedCat(null)}
        categoryName={selectedCat}
        colors={colors}
        insets={insets}
        router={router}
      />
    );
  }

  return (
    <CategoryGrid
      categories={categories}
      channelCountByCategory={channelCountByCategory}
      colors={colors}
      insets={insets}
      onSelect={setSelectedCat}
      epgLoading={epgLoading}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  screenTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  screenSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  loadingBadge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  loadingLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  errBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  errText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#EF4444' },
  todayBtn: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  todayBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  chCountLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  backArrow: { fontSize: 16 },
  backLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  nowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },

  // ── Category grid ──
  catGrid: { padding: 12 },
  catRow: { gap: 12, marginBottom: 12 },
  catCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 12,
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
  },
  catIconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  catIcon: { fontSize: 28 },
  catName: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
    lineHeight: 18,
  },
  catCountBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 99,
    borderWidth: 1,
  },
  catCount: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  // ── Day tab bar ──
  dayBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  dayBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  dayTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  dayTabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // ── EPG grid ──
  grid: { flex: 1, flexDirection: 'row' },
  leftCol: { width: CHANNEL_W, borderRightWidth: StyleSheet.hairlineWidth },
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
    width: 38, height: 28, borderRadius: 4, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { flex: 1, fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 14 },
  rightArea: { flex: 1, overflow: 'hidden' },
  timeHeader: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  timeSlot: {
    width: SLOT_W, height: TIME_H, justifyContent: 'center',
    paddingLeft: 6, borderLeftWidth: StyleSheet.hairlineWidth,
  },
  timeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  programRow: {
    height: ROW_H, flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth, position: 'relative',
  },
  programCell: {
    position: 'absolute', top: 3, height: ROW_H - 6,
    borderRadius: 5, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 3,
    overflow: 'hidden', justifyContent: 'center', gap: 1,
  },
  progressBar: {
    position: 'absolute', left: 0, bottom: 0, height: 2,
    backgroundColor: '#3B82F6', borderBottomLeftRadius: 5,
  },
  progTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  progTime: { fontSize: 9, fontFamily: 'Inter_400Regular' },
  noProg: {
    position: 'absolute', left: 4, top: 6, right: 4, bottom: 6,
    borderRadius: 5, borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center',
  },
  noProgText: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  nowLine: {
    position: 'absolute', top: 0, width: 2,
    backgroundColor: '#EF4444', opacity: 0.8, zIndex: 10,
  },

  // ── Modal ──
  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center',
  },
  modalCard: {
    width: 480, maxWidth: '85%', borderRadius: 16,
    borderWidth: 1, padding: 20, gap: 14,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  modalCh: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  modalLogo: { width: 56, height: 40, borderRadius: 8, overflow: 'hidden', flexShrink: 0 },
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
  closeBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  closeBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  watchBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#3B82F6' },
  watchBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  // ── Empty state ──
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 60 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
