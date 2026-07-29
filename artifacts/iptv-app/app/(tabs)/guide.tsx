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
import { getXtreamLiveCategories, getXtreamLiveStreams, getXtreamXmltvUrl } from '@/services/xtreamApi';
import { SIDEBAR_W } from './_layout';
import { fetchAndParseXmltv } from '@/services/epgService';
import type { Channel, EpgProgram } from '@/types';

// ─── Guide constants ────────────────────────────────────────────────────────
const PX_PER_MIN = 2;
const CHANNEL_W = 145;
const ROW_H = 72;
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

function ChannelCell({
  channel, nowTitle, nextTitle, colors,
}: {
  channel: Channel;
  nowTitle?: string | null;
  nextTitle?: string | null;
  colors: any;
}) {
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
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={[styles.chName, { color: colors.foreground }]} numberOfLines={1}>{channel.name}</Text>
        {nowTitle ? (
          <Text style={[styles.chNow, { color: '#3B82F6' }]} numberOfLines={1}>▶ {nowTitle}</Text>
        ) : nextTitle ? (
          <Text style={[styles.chNow, { color: colors.mutedForeground }]} numberOfLines={1}>Next: {nextTitle}</Text>
        ) : null}
      </View>
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
  categoryIds, categoryNameMap, channelCountByCategory, colors, insets, onSelect, epgLoading,
}: {
  categoryIds: string[];
  categoryNameMap: Record<string, string>;
  channelCountByCategory: Record<string, number>;
  colors: any;
  insets: any;
  onSelect: (catId: string) => void;
  epgLoading: boolean;
}) {
  const { width } = useWindowDimensions();
  const availW = width - 190; // sidebar is 190px
  const numCols = Math.max(2, Math.floor(availW / 180));
  const colW = Math.floor((availW - (numCols + 1) * 12) / numCols);

  const renderItem = useCallback(({ item: catId }: { item: string }) => {
    const name = categoryNameMap[catId] ?? catId;
    const icon = getCatIcon(name);
    const count = channelCountByCategory[catId] ?? 0;
    return (
      <TouchableOpacity
        style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border, width: colW }]}
        onPress={() => onSelect(catId)}
        activeOpacity={0.75}
      >
        {/* Icon bubble */}
        <View style={[styles.catIconBubble, { backgroundColor: colors.secondary }]}>
          <Text style={styles.catIcon}>{icon}</Text>
        </View>
        {/* Display name */}
        <Text style={[styles.catName, { color: colors.foreground }]} numberOfLines={2}>{name}</Text>
        {/* Channel count badge */}
        <View style={[styles.catCountBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
          <Text style={[styles.catCount, { color: colors.mutedForeground }]}>{count} channels</Text>
        </View>
      </TouchableOpacity>
    );
  }, [colors, colW, categoryNameMap, channelCountByCategory, onSelect]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>TV Guide</Text>
        <Text style={[styles.screenSub, { color: colors.mutedForeground }]}>Select a category to view the 3-day schedule</Text>
        {epgLoading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingLabel, { color: colors.mutedForeground }]}>Loading EPG…</Text>
          </View>
        )}
      </View>

      <FlatList
        data={categoryIds}
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
  const [selectedDay, setSelectedDay] = useState(0);
  const [selected, setSelected] = useState<{ program: EpgProgram; channel: Channel } | null>(null);
  const [now, setNow] = useState(Date.now());

  // 3 day labels
  const days = useMemo(() =>
    Array.from({ length: 3 }, (_, i) => {
      const d = dayStart(i);
      return { ...fmtDayLabel(d, i), date: d };
    }), []);

  // Find the latest programme end time across all channels so we can grey
  // out day tabs that fall entirely beyond the provider's EPG window.
  const latestEpgMs = useMemo(() => {
    if (!epgMap || epgMap.size === 0) return 0;
    let max = 0;
    for (const progs of epgMap.values()) {
      if (progs.length > 0) {
        const last = progs[progs.length - 1];
        if (last.end.getTime() > max) max = last.end.getTime();
      }
    }
    return max;
  }, [epgMap]);

  // True when the selected day has no programmes at all for any channel
  const selectedDayEmpty = useMemo(() => {
    if (!epgMap || epgMap.size === 0) return false;
    const ds = dayStart(selectedDay).getTime();
    const de = ds + DAY_MINS * 60_000;
    for (const progs of epgMap.values()) {
      if (progs.some((p) => p.end.getTime() > ds && p.start.getTime() < de)) return false;
    }
    return true;
  }, [epgMap, selectedDay]);

  const dayStartMs = useMemo(() => dayStart(selectedDay).getTime(), [selectedDay]);
  const nowX = ((now - dayStartMs) / 60_000) * PX_PER_MIN;
  // Height of the full programme column — used for the "Now" indicator line
  const nowLineH = channels.length * ROW_H;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Only one horizontal scroll ref is needed — the time header shadows it
  const timeHeaderRef = useRef<ScrollView>(null);
  const gridHorizRef  = useRef<ScrollView>(null);

  // When day changes scroll horizontally to current time (today) or day start
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

        {/* Jump-to-now button */}
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
        {days.map((d, i) => {
          const dayMs = dayStart(i).getTime();
          const noData = latestEpgMs > 0 && dayMs >= latestEpgMs;
          const isSelected = i === selectedDay;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.dayTab,
                isSelected
                  ? { backgroundColor: colors.primary, borderColor: colors.primary }
                  : noData
                  ? { backgroundColor: 'transparent', borderColor: colors.border, opacity: 0.35 }
                  : { backgroundColor: 'transparent', borderColor: colors.border },
              ]}
              onPress={() => setSelectedDay(i)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dayTabText, { color: isSelected ? '#fff' : colors.mutedForeground }]}>
                {d.short}
              </Text>
              {noData && !isSelected && (
                <View style={styles.noDataDot} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Full-screen empty state when provider has no EPG for this day ── */}
      {selectedDayEmpty && !epgLoading && (
        <View style={styles.dayEmpty}>
          <Text style={styles.dayEmptyIcon}>📅</Text>
          <Text style={[styles.dayEmptyTitle, { color: colors.foreground }]}>No guide data for this day</Text>
          <Text style={[styles.dayEmptySub, { color: colors.mutedForeground }]}>
            Your provider hasn't published EPG data for {days[selectedDay]?.long ?? 'this day'}.{'\n'}
            Most providers supply 3–7 days ahead.
          </Text>
        </View>
      )}

      {/* ── EPG grid ──────────────────────────────────────────────────────────
          Layout uses a SINGLE outer vertical ScrollView so the left channel
          column and right programme area always scroll together — no JS-based
          sync needed, no de-sync possible.
          ──────────────────────────────────────────────────────────────────── */}
      {!selectedDayEmpty && <View style={[styles.grid, { paddingRight: insets.right }]}>

        {/* Fixed header row: corner cell + time labels */}
        <View style={styles.headerRow}>
          <View style={[styles.cornerCell, { backgroundColor: colors.card, borderBottomColor: colors.border, borderRightColor: colors.border }]}>
            <Text style={[styles.cornerText, { color: colors.mutedForeground }]}>CH</Text>
          </View>
          <ScrollView
            ref={timeHeaderRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            <TimeHeader dayStartMs={dayStartMs} colors={colors} />
          </ScrollView>
        </View>

        {/* Scrollable body — single ScrollView moves both columns together */}
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          <View style={{ flexDirection: 'row' }}>

            {/* Left: channel name column */}
            <View style={[styles.leftCol, { borderRightColor: colors.border }]}>
              {channels.map((ch) => {
                const progs = epgMap?.get(ch.epgId ?? ch.id) ?? [];
                const nowIdx = progs.findIndex(
                  (p) => p.start.getTime() <= now && now < p.end.getTime(),
                );
                return (
                  <ChannelCell
                    key={ch.id}
                    channel={ch}
                    nowTitle={nowIdx >= 0 ? progs[nowIdx].title : null}
                    nextTitle={nowIdx >= 0 && progs[nowIdx + 1] ? progs[nowIdx + 1].title : null}
                    colors={colors}
                  />
                );
              })}
            </View>

            {/* Right: horizontal scroll area for programmes */}
            <ScrollView
              ref={gridHorizRef}
              horizontal
              showsHorizontalScrollIndicator
              scrollEventThrottle={16}
              onScroll={onGridHorizScroll}
              style={{ flex: 1 }}
            >
              {/* "Now" red indicator line */}
              {selectedDay === 0 && nowX >= 0 && nowX <= TOTAL_DAY_W && nowLineH > 0 && (
                <View pointerEvents="none" style={[styles.nowLine, { left: nowX, height: nowLineH }]} />
              )}
              <View style={{ width: TOTAL_DAY_W }}>
                {channels.map((ch) => {
                  const programs = epgMap?.get(ch.epgId ?? ch.id) ?? [];
                  return (
                    <ProgramRow
                      key={ch.id}
                      channel={ch}
                      programs={programs}
                      dayStartMs={dayStartMs}
                      now={now}
                      colors={colors}
                      onProgramPress={(p, c) => setSelected({ program: p, channel: c })}
                    />
                  );
                })}
              </View>
            </ScrollView>

          </View>
        </ScrollView>
      </View>}

      {selected && (
        <ProgramModal
          program={selected.program}
          channel={selected.channel}
          colors={colors}
          onClose={() => setSelected(null)}
          onWatch={() => {
            const chList = channels.map((ch) => ({
              url: ch.streamUrl,
              title: ch.name,
              epgId: ch.epgId ?? ch.id,
            }));
            const idx = channels.findIndex((ch) => ch.id === selected!.channel.id);
            setSelected(null);
            router.push({
              pathname: '/player',
              params: {
                url: selected!.channel.streamUrl,
                title: `${selected!.channel.name} — ${selected!.program.title}`,
                type: 'live',
                logo: selected!.channel.logo ?? '',
                epgId: selected!.channel.epgId ?? selected!.channel.id,
                channelsJson: JSON.stringify(chList),
                channelIndex: String(idx),
              },
            });
          }}
        />
      )}
    </View>
  );
}

// ─── EPG ID fuzzy normaliser ──────────────────────────────────────────────────
// Converts both XMLTV channel IDs and Xtream channel names to the same token
// so mismatches like "BBC Two HD" ↔ "BBC2.uk" resolve correctly.
function normalizeEpgId(s: string): string {
  return s
    .toLowerCase()
    // Strip TLD-style suffixes (.uk .com .net .tv .org)
    .replace(/\.(uk|com|net|tv|org|co)$/i, '')
    // Strip trailing quality labels (must be at word boundary / end)
    .replace(/[\s._-]*(fhd|uhd|4k|hd|sd|hi-?def|\+1|plus\s?1)[\s._-]*$/i, '')
    // Normalise number words → digits
    .replace(/\bone\b/g, '1')
    .replace(/\btwo\b/g, '2')
    .replace(/\bthree\b/g, '3')
    .replace(/\bfour\b/g, '4')
    .replace(/\bfive\b/g, '5')
    .replace(/\bsix\b/g, '6')
    .replace(/\bseven\b/g, '7')
    .replace(/\beight\b/g, '8')
    .replace(/\bnine\b/g, '9')
    // Collapse everything non-alphanumeric
    .replace(/[^a-z0-9]/g, '');
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function GuideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const isXtream = credentials?.type === 'xtream';

  // selectedCat stores the category_id (numeric string from groupTitle)
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const creds = isXtream ? buildCreds(credentials) : null;

  // Fetch named categories (id → name)
  const { data: liveCategories = [] } = useQuery({
    queryKey: ['live-categories', credentials],
    queryFn: () => getXtreamLiveCategories(creds!),
    enabled: !!creds,
    staleTime: 10 * 60_000,
  });

  // id → display name map
  const categoryNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const cat of liveCategories) map[cat.id] = cat.name;
    return map;
  }, [liveCategories]);

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

  // Category IDs in server order (same as Live TV), filtered to only those with channels
  const categoryIds = useMemo(() => {
    const withChannels = new Set(channels.map((ch) => ch.groupTitle).filter(Boolean));
    return liveCategories.map((c) => c.id).filter((id) => withChannels.has(id));
  }, [liveCategories, channels]);

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

  // Build a fuzzy-resolved copy of epgMap so channels whose epgId doesn't
  // exactly match any XMLTV key (e.g. "BBC Two HD" ↔ "BBC2.uk") still get
  // their programmes.  Only adds entries — never removes existing ones.
  const resolvedEpgMap = useMemo(() => {
    if (!epgMap || epgMap.size === 0) return epgMap;

    // Pre-build normalised → original-key index from XMLTV keys
    const normIndex = new Map<string, string>();
    for (const key of epgMap.keys()) {
      const norm = normalizeEpgId(key);
      if (norm && !normIndex.has(norm)) normIndex.set(norm, key);
    }

    let extended: Map<string, EpgProgram[]> | null = null;

    for (const ch of channels) {
      const id = ch.epgId ?? ch.id;
      if (!id || epgMap.has(id)) continue;          // already resolved

      const normId   = normalizeEpgId(id);
      const normName = normalizeEpgId(ch.name);

      // Try exact normalised match on epgId, then on channel display name
      const matchedKey =
        normIndex.get(normId) ??
        normIndex.get(normName) ??
        // Substring fallback: XMLTV key contains the channel token or vice-versa
        (() => {
          for (const [nk, ok] of normIndex) {
            const shorter = normName.length <= nk.length ? normName : nk;
            const longer  = normName.length <= nk.length ? nk : normName;
            if (shorter.length >= 3 && longer.startsWith(shorter)) return ok;
          }
          return undefined;
        })();

      if (matchedKey) {
        if (!extended) extended = new Map(epgMap);
        extended.set(id, epgMap.get(matchedKey)!);
      }
    }

    return extended ?? epgMap;
  }, [epgMap, channels]);

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
        epgMap={resolvedEpgMap}
        epgLoading={epgLoading}
        epgError={epgError}
        refetchEpg={refetchEpg}
        onBack={() => setSelectedCat(null)}
        categoryName={categoryNameMap[selectedCat] ?? selectedCat}
        colors={colors}
        insets={insets}
        router={router}
      />
    );
  }

  return (
    <CategoryGrid
      categoryIds={categoryIds}
      categoryNameMap={categoryNameMap}
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
    paddingLeft: 0,
    paddingRight: 12,
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
    width: SIDEBAR_W,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 0,
    borderRightWidth: 1,
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
    flexShrink: 0,
  },
  dayBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 16,
  },
  dayTab: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  dayTabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // ── EPG grid ──
  // grid is now a column: fixed headerRow on top, scrollable body below
  grid: { flex: 1, flexDirection: 'column' },
  headerRow: {
    flexDirection: 'row',
    flexShrink: 0,
  },
  leftCol: { width: CHANNEL_W },
  cornerCell: {
    width: CHANNEL_W,
    height: TIME_H,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  cornerText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  channelCell: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  chLogo: {
    width: 38, height: 28, borderRadius: 4, overflow: 'hidden',
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 11, fontFamily: 'Inter_500Medium', lineHeight: 14 },
  chNow:  { fontSize: 9,  fontFamily: 'Inter_400Regular', lineHeight: 12 },
  timeHeader: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  timeSlot: {
    width: SLOT_W, height: TIME_H, justifyContent: 'center',
    paddingLeft: 6, borderLeftWidth: StyleSheet.hairlineWidth,
  },
  timeLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  programRow: {
    height: ROW_H, flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth, position: 'relative',
    overflow: 'hidden',
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
    width: TOTAL_DAY_W - 8,
    height: ROW_H - 12,
    marginHorizontal: 4,
    marginVertical: 6,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
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

  // ── No-data day empty state ──
  dayEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10, paddingHorizontal: 60 },
  dayEmptyIcon: { fontSize: 44, marginBottom: 4 },
  dayEmptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  dayEmptySub: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, opacity: 0.7 },

  // ── Day tab no-data indicator ──
  noDataDot: {
    position: 'absolute',
    top: 4, right: 4,
    width: 5, height: 5, borderRadius: 99,
    backgroundColor: '#6B7280',
  },
});
