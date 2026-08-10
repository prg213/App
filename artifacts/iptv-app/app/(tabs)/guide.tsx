import { FocusablePressable } from '@/components/FocusablePressable';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DeviceEventEmitter,
  findNodeHandle,
  FlatList,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Toast } from '@/components/Toast';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { getXtreamLiveCategories, getXtreamLiveStreams, getXtreamXmltvUrl } from '@/services/xtreamApi';
import { SIDEBAR_W } from './_layout';
import { fetchAndParseXmltv } from '@/services/epgService';
import { StorageService } from '@/services/storage';
import {
  cancelReminderNotification,
  scheduleReminderNotification,
} from '@/services/notifications';
import type { Channel, EpgProgram, Reminder } from '@/types';
import { normaliseStr } from '@/utils/normalise';

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
  channel, nowTitle, nextTitle, colors, isFav, onFavPress, onPress,
}: {
  channel: Channel;
  nowTitle?: string | null;
  nextTitle?: string | null;
  colors: any;
  isFav?: boolean;
  onFavPress?: () => void;
  onPress?: () => void;
}) {
  return (
    <FocusablePressable
      onPress={onPress}
      onLongPress={onFavPress}
      delayLongPress={400}
      focusedStyle={styles.tvFocused}
      style={[
        styles.channelCell,
        { borderBottomColor: colors.border, backgroundColor: colors.card },
      ]}
    >
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.chName, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{channel.name}</Text>
          {nowTitle && <View style={styles.chLiveDot} />}
        </View>
        {nowTitle ? (
          <Text style={[styles.chNow, { color: '#3B82F6' }]} numberOfLines={1}>▶ {nowTitle}</Text>
        ) : nextTitle ? (
          <Text style={[styles.chNow, { color: colors.mutedForeground }]} numberOfLines={1}>Next: {nextTitle}</Text>
        ) : null}
      </View>
      {isFav && <Text style={{ position: 'absolute', right: 4, top: 4, fontSize: 10, color: '#EF4444' }}>♥</Text>}
    </FocusablePressable>
  );
}

// ─── Program cell ─────────────────────────────────────────────────────────────

const ProgramCell = React.memo(function ProgramCell({
  program, left, width, now, colors, hasReminder, onPress, onLongPress,
}: {
  program: EpgProgram; left: number; width: number; now: number;
  colors: any; hasReminder?: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  if (width < 6) return null;
  const isNow = program.start.getTime() <= now && now < program.end.getTime();
  const progress = isNow
    ? (now - program.start.getTime()) / (program.end.getTime() - program.start.getTime())
    : 0;

  return (
    <FocusablePressable
      style={[styles.programCell, {
        left, width: width - 2,
        backgroundColor: isNow ? '#1A2A4A' : colors.secondary,
        borderColor: isNow ? '#3B82F6' : colors.border,
      }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
    >
      {isNow && <View style={[styles.progressBar, { width: `${progress * 100}%` as any }]} />}
      {hasReminder && width > 20 && (
        <View style={styles.reminderBadge} pointerEvents="none">
          <Text style={styles.reminderBadgeIcon}>🔔</Text>
        </View>
      )}
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
    </FocusablePressable>
  );
});

// ─── Program row ─────────────────────────────────────────────────────────────

const ProgramRow = React.memo(function ProgramRow({
  channel, programs, dayStartMs, now, colors, reminderIds, onProgramPress, onProgramLongPress,
}: {
  channel: Channel; programs: EpgProgram[]; dayStartMs: number; now: number;
  colors: any; reminderIds?: Set<string>;
  onProgramPress: (p: EpgProgram, ch: Channel) => void;
  onProgramLongPress?: (p: EpgProgram, ch: Channel) => void;
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
            hasReminder={reminderIds?.has(`${channel.id}_${prog.start.toISOString()}`)}
            onPress={() => onProgramPress(prog, channel)}
            onLongPress={onProgramLongPress ? () => onProgramLongPress(prog, channel) : undefined}
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

// ─── TV / Fire TV EPG grid ────────────────────────────────────────────────────
// FlatList-based layout so every programme cell is D-pad focusable.
// Only rendered when Platform.isTV is true.

const TV_CELL_GAP = 2;   // horizontal gap between cells
const TV_CH_W    = 160;  // fixed channel-info column width

interface TVProgItem {
  prog: EpgProgram;
  width: number;   // rendered pixel width
  offset: number;  // cumulative offset from day start (for getItemLayout)
}

const TVEpgRow = React.memo(function TVEpgRow({
  channel, programs, dayStartMs, now, isToday, isFirst, colors, reminderIds,
  onProgramPress, onWatchChannel, firstChannelRef, lastFocusedProgRef,
  jumpToNowRef,
}: {
  channel: Channel;
  programs: EpgProgram[];
  dayStartMs: number;
  now: number;
  isToday: boolean;
  /** True for the first row — gives hasTVPreferredFocus so the remote lands on it immediately */
  isFirst?: boolean;
  colors: any;
  reminderIds?: Set<string>;
  onProgramPress: (p: EpgProgram, ch: Channel) => void;
  onWatchChannel: (ch: Channel) => void;
  /** Ref forwarded from FullGuide so it can focus the first channel cell after a category change */
  firstChannelRef?: React.Ref<View>;
  /**
   * Shared mutable ref owned by FullGuide. Set to the View of whichever
   * programme cell was last pressed so focus can be restored when the
   * ProgramModal closes.
   */
  lastFocusedProgRef?: React.MutableRefObject<View | null>;
  /**
   * Populated by this row (only when isFirst) with a fn that scrolls the
   * horizontal list to the current programme and focuses it.
   * FullGuide calls it via the global onHWKeyEvent Play/Pause listener.
   */
  jumpToNowRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const flatRef = useRef<FlatList>(null);
  // Ref to the first programme cell — used by the channel-press auto-advance
  const progFirstRef = useRef<View>(null);
  // Ref to the cell at initialIdx — used to restore focus after the initial scroll
  const initialProgRef = useRef<View>(null);
  // Map of FlatList index → cell View node so we can hand the pressed node to
  // lastFocusedProgRef for post-modal focus restoration.
  const progRefs = useRef<Map<number, View | null>>(new Map());
  // Tracks the last horizontal scroll offset so it can be restored after an
  // orientation change or window resize causes the FlatList to remount.
  // null = no user scroll recorded yet for this day (use initialIdx instead).
  // A saved value of 0 is valid (user explicitly scrolled back to the left edge)
  // and must be restored faithfully, so we need null as a distinct sentinel.
  const scrollOffsetRef = useRef<number | null>(null);
  // Detect window width changes (landscape ↔ portrait, split-screen resize).
  const { width: windowWidth } = useWindowDimensions();
  const dayEndMs = dayStartMs + DAY_MINS * 60_000;

  // Pre-compute widths + cumulative offsets so getItemLayout is O(1)
  const items: TVProgItem[] = useMemo(() => {
    const result: TVProgItem[] = [];
    let cum = 0;
    for (const p of programs) {
      if (p.end.getTime() <= dayStartMs || p.start.getTime() >= dayEndMs) continue;
      const startMs = Math.max(p.start.getTime(), dayStartMs);
      const endMs   = Math.min(p.end.getTime(), dayEndMs);
      const width   = Math.max(60, ((endMs - startMs) / 60_000) * PX_PER_MIN);
      result.push({ prog: p, width, offset: cum });
      cum += width + TV_CELL_GAP;
    }
    return result;
  }, [programs, dayStartMs, dayEndMs]);

  // Index of the current/upcoming programme — scroll there on mount
  const initialIdx = useMemo(() => {
    if (!isToday || items.length === 0) return undefined;
    const idx = items.findIndex((it) => it.prog.end.getTime() > now);
    return idx > 0 ? idx - 1 : idx >= 0 ? idx : undefined;
  }, [items, now, isToday]);

  // Reset the saved scroll offset whenever the selected day changes so that a
  // stale offset from the previous day is never applied to a new day's content.
  // Rows are keyed by channel id and retained across day switches, so we need
  // this explicit reset rather than relying on component remount.
  useEffect(() => {
    scrollOffsetRef.current = null;
  }, [dayStartMs]);

  useEffect(() => {
    if (!flatRef.current) return;
    // Snapshot the saved offset SYNCHRONOUSLY before scheduling the timer.
    // When a FlatList remounts after a resize it commonly emits an onScroll
    // event with x=0 (the reset position) before the 150 ms timer fires.
    // Reading scrollOffsetRef inside the timer would see that overwritten value
    // rather than the user's real position.  Capturing it here, at effect-run
    // time, avoids that race — matching the pattern used by the phone path.
    const savedOffset = scrollOffsetRef.current;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const scrollTimer = setTimeout(() => {
      // Restore the user's saved offset when one exists — including a real
      // value of 0 (user explicitly scrolled back to the left edge).
      // null means no scroll has been recorded yet for this day.
      if (savedOffset !== null) {
        try {
          flatRef.current?.scrollToOffset({ offset: savedOffset, animated: false });
        } catch (_) {}
        return; // No focus change needed — D-pad focus is preserved by TV framework
      }
      // No saved offset (initial mount or just after a day change): scroll to the
      // current/upcoming programme and optionally restore D-pad focus.
      if (initialIdx == null) return;
      try {
        flatRef.current?.scrollToIndex({ index: initialIdx, animated: false, viewPosition: 0 });
      } catch (_) {}
      // Only restore D-pad focus on the first row (hasTVPreferredFocus owner).
      // Every other row would compete and steal focus from the intended cell.
      if (Platform.isTV && isFirst) {
        focusTimer = setTimeout(() => {
          initialProgRef.current?.focus();
        }, 80);
      }
    }, 150);
    return () => {
      clearTimeout(scrollTimer);
      if (focusTimer !== null) clearTimeout(focusTimer);
    };
    // windowWidth is intentionally included: an orientation change or split-screen
    // resize triggers a FlatList remount that resets scroll to 0, so this effect
    // must re-run to restore the saved offset.
  }, [initialIdx, isFirst, windowWidth]);

  // Populate jumpToNowRef (first row only) with a fn FullGuide can call to
  // scroll the horizontal list to the current programme and focus it.
  useEffect(() => {
    if (!jumpToNowRef) return;
    jumpToNowRef.current = () => {
      if (initialIdx == null || !flatRef.current) return;
      try {
        flatRef.current.scrollToIndex({ index: initialIdx, animated: true, viewPosition: 0 });
      } catch (_) {}
      setTimeout(() => {
        initialProgRef.current?.focus();
      }, 80);
    };
    return () => {
      // Only clear if this row still owns the ref
      if (jumpToNowRef) jumpToNowRef.current = null;
    };
  }, [jumpToNowRef, initialIdx]);

  const getItemLayout = useCallback((_: any, index: number) => {
    const it = items[index];
    return { length: (it?.width ?? 0) + TV_CELL_GAP, offset: it?.offset ?? 0, index };
  }, [items]);

  return (
    <View style={[styles.tvRow, { borderBottomColor: colors.border }]}>
      {/* Channel info cell — OK/Select advances focus to first programme;
          long-press watches the channel live (matches catchup auto-advance pattern) */}
      <FocusablePressable
        ref={firstChannelRef}
        focusedStyle={styles.tvFocused}
        hasTVPreferredFocus={isFirst}
        style={[styles.tvChCell, { backgroundColor: colors.card, borderRightColor: colors.border }]}
        onPress={() => {
          // Auto-advance D-pad focus to the current/upcoming programme cell
          // (initialProgRef), falling back to the first cell when there is no
          // initialIdx (e.g. a future day where every programme is upcoming).
          setTimeout(() => {
            (initialProgRef.current ?? progFirstRef.current)?.focus();
          }, 80);
        }}
        onLongPress={() => onWatchChannel(channel)}
        delayLongPress={400}
      >
        {channel.logo ? (
          <Image source={{ uri: channel.logo }} style={styles.tvChLogo} resizeMode="contain" />
        ) : (
          <Text style={[styles.tvChInitials, { color: colors.primary }]}>
            {channel.name.slice(0, 3).toUpperCase()}
          </Text>
        )}
        <Text style={[styles.tvChName, { color: colors.foreground }]} numberOfLines={2}>
          {channel.name}
        </Text>
      </FocusablePressable>

      {/* Programme cells */}
      {items.length === 0 ? (
        <View style={styles.tvNoProg}>
          <Text style={[styles.tvNoProgText, { color: colors.mutedForeground }]}>No guide data</Text>
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={items}
          horizontal
          keyExtractor={(it) => it.prog.start.toISOString()}
          getItemLayout={getItemLayout}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          scrollEventThrottle={16}
          onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
            scrollOffsetRef.current = e.nativeEvent.contentOffset.x;
          }}
          renderItem={({ item: it, index }) => {
            const isNow = it.prog.start.getTime() <= now && now < it.prog.end.getTime();
            const progress = isNow
              ? (now - it.prog.start.getTime()) / (it.prog.end.getTime() - it.prog.start.getTime())
              : 0;
            const hasReminder = reminderIds?.has(`${channel.id}_${it.prog.start.toISOString()}`);
            // Callback ref: assigns progFirstRef (index 0, used by channel-cell press
            // auto-advance), initialProgRef (initialIdx, used for post-scroll focus
            // restoration), and progRefs map (every index, used for post-modal restore).
            const cellRef = (el: View | null) => {
              progRefs.current.set(index, el);
              if (index === 0) (progFirstRef as React.MutableRefObject<View | null>).current = el;
              if (index === initialIdx) (initialProgRef as React.MutableRefObject<View | null>).current = el;
            };
            return (
              <FocusablePressable
                ref={cellRef}
                focusedStyle={styles.tvFocused}
                style={[
                  styles.tvProgCell,
                  {
                    width: it.width,
                    backgroundColor: isNow ? '#1A2A4A' : colors.secondary,
                    borderColor: isNow ? '#3B82F6' : colors.border,
                  },
                ]}
                onPress={() => {
                  // Record the pressed cell so focus can be restored after the modal closes
                  if (lastFocusedProgRef) {
                    lastFocusedProgRef.current = progRefs.current.get(index) ?? null;
                  }
                  onProgramPress(it.prog, channel);
                }}
              >
                {isNow && (
                  <View style={[styles.progressBar, { width: `${progress * 100}%` as any }]} />
                )}
                {/* #249: wrap the bell in a dark pill so it stays readable even
                    when the cell gets the focus ring (borderWidth shrinks inner
                    space and the emoji needs contrast against any background). */}
                {hasReminder && (
                  <View style={styles.tvReminderBadge} pointerEvents="none">
                    <Text style={styles.tvReminderDot}>🔔</Text>
                  </View>
                )}
                <Text
                  style={[styles.tvProgTitle, { color: isNow ? '#F2F2F2' : colors.foreground }]}
                  numberOfLines={1}
                >
                  {it.prog.title}
                </Text>
                {it.width > 80 && (
                  <Text style={[styles.tvProgTime, { color: isNow ? '#93C5FD' : colors.mutedForeground }]}>
                    {fmtTime(it.prog.start)} – {fmtTime(it.prog.end)}
                  </Text>
                )}
              </FocusablePressable>
            );
          }}
        />
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
  const now = new Date();
  const isNow = program.start <= now && now < program.end;
  const isFuture = program.start > now;
  const reminderId = `${channel.id}_${program.start.toISOString()}`;
  const [hasReminder, setHasReminder] = React.useState(false);
  const [leadMins, setLeadMins] = React.useState<number>(10);

  // Initial load
  React.useEffect(() => {
    StorageService.getReminderLeadMins().then(setLeadMins);
    if (isFuture) {
      StorageService.hasReminder(reminderId).then(setHasReminder);
    }
  }, [reminderId, isFuture]);

  // #125/#128: stay in sync when a reminder is set/cancelled from another screen
  React.useEffect(() => {
    if (!isFuture) return;
    const sub = DeviceEventEmitter.addListener('reminders:changed', () => {
      StorageService.hasReminder(reminderId).then(setHasReminder);
    });
    return () => sub.remove();
  }, [reminderId, isFuture]);

  // #136: keep lead time label current if user changes it in Settings while modal is open
  React.useEffect(() => {
    const sub = DeviceEventEmitter.addListener('leadtime:changed', () => {
      StorageService.getReminderLeadMins().then(setLeadMins);
    });
    return () => sub.remove();
  }, []);

  const handleToggleReminder = async () => {
    if (hasReminder) {
      // Cancel the scheduled notification before removing the reminder
      const nid = await StorageService.getReminderNotificationId(reminderId);
      await cancelReminderNotification(nid);
      await StorageService.removeReminder(reminderId);
      setHasReminder(false);
      DeviceEventEmitter.emit('reminders:changed');
    } else {
      // Read lead time once so it is stored on the reminder (card can display it)
      const leadMins = await StorageService.getReminderLeadMins();
      const reminder = {
        id: reminderId,
        channelId: channel.id,
        channelName: channel.name,
        channelLogo: channel.logo,
        streamUrl: channel.streamUrl,
        programTitle: program.title,
        programDescription: program.description,
        start: program.start.toISOString(),
        end: program.end.toISOString(),
        createdAt: new Date().toISOString(),
        leadMins,
      };
      // Schedule notification first so we can attach the id to the stored reminder
      const notificationId = await scheduleReminderNotification(reminder, leadMins) ?? undefined;
      await StorageService.addReminder({ ...reminder, notificationId });
      setHasReminder(true);
      DeviceEventEmitter.emit('reminders:changed');
    }
  };

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
            <FocusablePressable
              style={[styles.closeBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              onPress={onClose}
              hasTVPreferredFocus
            >
              <Text style={[styles.closeBtnText, { color: colors.foreground }]}>Close</Text>
            </FocusablePressable>
            {isFuture && (
              <FocusablePressable
                style={[styles.watchBtn, hasReminder && { backgroundColor: '#6B7280' }]}
                onPress={handleToggleReminder}
              >
                <Text style={styles.watchBtnText}>
                  {hasReminder ? '🔔 Remove Reminder' : `🔔 Set Reminder · ${leadMins} min before`}
                </Text>
              </FocusablePressable>
            )}
            {isNow && (
              <FocusablePressable style={styles.watchBtn} onPress={onWatch} hasTVPreferredFocus>
                <Text style={styles.watchBtnText}>▶  Watch Live</Text>
              </FocusablePressable>
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

  // ── TV / Fire TV: D-pad cross-row wrapping ───────────────────────────────
  // On Fire TV a multi-column FlatList does not automatically carry D-pad
  // focus across row boundaries. We wire nextFocusRight / nextFocusLeft per
  // card *at mount time* so that cells virtualised into view while scrolling
  // are wired as they appear — not just during a one-off post-render sweep.
  //
  // TV_WIRE_DELAY_MS — how long to wait after a ref callback fires before
  // calling findNodeHandle.  The native node must be attached to the view
  // hierarchy before findNodeHandle returns a valid integer handle; if it is
  // called too early the call returns null and the cross-row wire is silently
  // skipped, leaving the D-pad stuck at the row boundary.
  //
  // Benchmarks:
  //   Firestick 4K (2nd gen, 1.7 GHz)  — handle ready in ~40–70 ms
  //   Firestick 4K Max                  — handle ready in ~30–50 ms
  //   Firestick Lite (1.0 GHz)          — handle ready in ~150–220 ms
  //
  // 250 ms gives ≥ 30 ms headroom above the worst-case Lite measurement and
  // is imperceptible to the user (the grid is already visible before focus
  // wires are needed). Do not lower this without retesting on a Lite unit.
  const TV_WIRE_DELAY_MS = 250;

  const cardRefs = useRef<(View | null)[]>([]);
  // Tracks the pending setTimeout handle for each card index so we can cancel
  // the timer when the same cell re-mounts (e.g. scroll virtualisation) before
  // the previous timer fires.
  const wireTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // ── Layout generation counter ────────────────────────────────────────────
  // Incremented *synchronously during render* when numCols changes — before
  // React runs any ref callbacks for the new layout.  Each 250 ms wire timer
  // captures the generation at scheduling time and self-cancels if the counter
  // has advanced, preventing stale handles from a prior column layout from
  // being written to the new layout's nodes.
  //
  // Why not useEffect / useLayoutEffect?  Both run *after* ref callbacks, so
  // any reset inside them would destroy the freshly-scheduled timers for the
  // new layout rather than the old layout's stale ones.
  const layoutGenRef = useRef(0);
  const prevNumColsRef = useRef(numCols);
  if (prevNumColsRef.current !== numCols) {
    prevNumColsRef.current = numCols;
    layoutGenRef.current += 1;
  }

  // Called from the ref callback each time a card mounts.
  // It pairs the newly-mounted card with its already-mounted row neighbours
  // (and reciprocally updates those neighbours to point back at this card).
  const wireCard = useCallback((index: number) => {
    if (!Platform.isTV) return;
    const total = categoryIds.length;
    const col   = index % numCols;
    const isFirstInRow = col === 0;
    const isLastInRow  = col === numCols - 1 || index === total - 1;
    const self = cardRefs.current[index];
    if (!self) return;

    // ── Pair with the last card of the previous row ──────────────────────
    if (isFirstInRow && index > 0) {
      const prev = cardRefs.current[index - 1];
      if (prev) {
        const selfHandle = findNodeHandle(self);
        const prevHandle = findNodeHandle(prev);
        // last card of prev row → right → this card
        if (selfHandle != null) prev.setNativeProps({ nextFocusRight: selfHandle });
        // this card → left → last card of prev row
        if (prevHandle != null) self.setNativeProps({ nextFocusLeft: prevHandle });
      }
    }

    // ── Pair with the first card of the next row ─────────────────────────
    if (isLastInRow && index + 1 < total) {
      const next = cardRefs.current[index + 1];
      if (next) {
        const selfHandle = findNodeHandle(self);
        const nextHandle = findNodeHandle(next);
        // this card → right → first card of next row
        if (nextHandle != null) self.setNativeProps({ nextFocusRight: nextHandle });
        // first card of next row → left → this card
        if (selfHandle != null) next.setNativeProps({ nextFocusLeft: selfHandle });
      }
    }
  }, [categoryIds.length, numCols]);

  const renderItem = useCallback(({ item: catId, index }: { item: string; index: number }) => {
    const name = categoryNameMap[catId] ?? catId;
    const icon = getCatIcon(name);
    const count = channelCountByCategory[catId] ?? 0;
    return (
      <FocusablePressable
        ref={(r) => {
          cardRefs.current[index] = r as View | null;
          // Cancel any previously-scheduled wire for this index (can happen
          // when a cell re-mounts during scroll virtualisation).
          const prev = wireTimers.current.get(index);
          if (prev != null) clearTimeout(prev);
          if (r) {
            // Capture the current layout generation so the timer can detect
            // if numCols changed between scheduling and firing.  If it has,
            // the new layout's own ref callbacks will schedule fresh timers
            // with the updated generation — we just no-op.
            const gen = layoutGenRef.current;
            // Wire cross-row D-pad focus as soon as this cell's native node is
            // ready. The tiny timeout lets the Pressable finish measuring before
            // findNodeHandle is called — required on all RN TV targets.
            const t = setTimeout(() => {
              wireTimers.current.delete(index);
              if (layoutGenRef.current !== gen) return;
              wireCard(index);
            }, TV_WIRE_DELAY_MS);
            wireTimers.current.set(index, t);
          } else {
            wireTimers.current.delete(index);
          }
        }}
        focusedStyle={styles.tvFocused}
        hasTVPreferredFocus={index === 0}
        style={[styles.catCard, { backgroundColor: colors.card, borderColor: colors.border, width: colW }]}
        onPress={() => onSelect(catId)}
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
      </FocusablePressable>
    );
  }, [colors, colW, categoryNameMap, channelCountByCategory, onSelect, wireCard]);

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
  channels, epgMap, epgLoading, epgError, refetchEpg, onBack, categoryName,
  categoryIds, categoryNameMap, selectedCat, onChangeCat,
  colors, insets, router, guideFavIds, setGuideFavIds,
}: {
  channels: Channel[];
  epgMap: Map<string, EpgProgram[]> | undefined;
  epgLoading: boolean;
  epgError: any;
  refetchEpg: () => void;
  onBack: () => void;
  categoryName: string;
  /** All category IDs in display order — used for ‹ › prev/next navigation */
  categoryIds: string[];
  categoryNameMap: Record<string, string>;
  selectedCat: string;
  onChangeCat: (catId: string) => void;
  colors: any;
  insets: any;
  router: any;
  guideFavIds: Set<string>;
  setGuideFavIds: (s: Set<string>) => void;
}) {
  const [selectedDay, setSelectedDay] = useState(0);
  const [selected, setSelected] = useState<{ program: EpgProgram; channel: Channel } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [guideToast, setGuideToast] = useState<string | null>(null);
  const [guideReminderIds, setGuideReminderIds] = useState<Set<string>>(new Set());
  const [chFilter, setChFilter] = useState('');
  const [debouncedChFilter, setDebouncedChFilter] = useState('');

  // ── Auto-advance D-pad focus between columns (TV / Fire TV only) ───────────
  // Ref attached to the first channel cell so we can programmatically focus it.
  const firstChannelRef = useRef<View>(null);
  // Ref to the programme cell that was last pressed — written by each TVEpgRow
  // on programme-cell press, read on ProgramModal close to restore D-pad focus.
  const lastFocusedProgViewRef = useRef<View | null>(null);
  // ── Jump-to-now hardware shortcut (Play/Pause key on Fire TV) ────────────
  // The first TVEpgRow populates this ref with a fn that scrolls its horizontal
  // FlatList to the current programme and focuses that cell.  FullGuide calls
  // it after switching back to today so the user lands on "now" instantly.
  const jumpToNowCallbackRef = useRef<(() => void) | null>(null);

  const jumpToNow = useCallback(() => {
    if (!Platform.isTV) return;
    if (selectedDay !== 0) {
      // Switch to today first; TVEpgRow's initialIdx useEffect will scroll
      // automatically, but we also call the explicit callback for focus.
      setSelectedDay(0);
      setTimeout(() => { jumpToNowCallbackRef.current?.(); }, 220);
    } else {
      // Already on today — directly scroll to now and focus the cell
      jumpToNowCallbackRef.current?.();
    }
  }, [selectedDay]);

  // Ref mirror of `selected` so the onHWKeyEvent handler can check whether a
  // modal is open without capturing stale closure state.
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // ── Play/Pause hardware shortcut — Fire TV / Android TV ──────────────────
  // React Native emits onHWKeyEvent as a global DeviceEventEmitter event
  // (not a View prop). We subscribe here so the shortcut works from any
  // focused cell anywhere in the EPG grid. Key-action 0 = key-down only.
  useEffect(() => {
    if (!Platform.isTV) return;
    const sub = DeviceEventEmitter.addListener(
      'onHWKeyEvent',
      (e: { eventType: string; eventKeyAction: number }) => {
        if (e.eventType === 'playPause' && e.eventKeyAction === 0 && !selectedRef.current) {
          jumpToNow();
        }
      },
    );
    return () => sub.remove();
  }, [jumpToNow]);

  // Focus the first channel cell whenever the selected category changes (covers
  // both the initial mount from CategoryGrid and ‹ › prev/next navigation).
  useEffect(() => {
    if (!Platform.isTV) return;
    const timer = setTimeout(() => { firstChannelRef.current?.focus(); }, 100);
    return () => clearTimeout(timer);
  }, [selectedCat]);

  // Debounce chFilter so rapid keystrokes don't thrash visibleChannels useMemo
  useEffect(() => {
    const t = setTimeout(() => setDebouncedChFilter(chFilter), 180);
    return () => clearTimeout(t);
  }, [chFilter]);

  // Load current reminder IDs so ProgramCells can show 🔔 badge
  const refreshGuideReminderIds = useCallback(() => {
    StorageService.getReminders().then((rs) => setGuideReminderIds(new Set(rs.map((r) => r.id))));
  }, []);
  useEffect(() => { refreshGuideReminderIds(); }, [refreshGuideReminderIds]);
  // Stay in sync when reminders change (from long-press or modal)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('reminders:changed', refreshGuideReminderIds);
    return () => sub.remove();
  }, [refreshGuideReminderIds]);

  const handleProgramLongPress = useCallback(async (prog: EpgProgram, ch: Channel) => {
    const isFuture = prog.start > new Date();
    if (!isFuture) return; // can only set reminders for future programmes
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const reminderId = `${ch.id}_${prog.start.toISOString()}`;
    const hasReminder = await StorageService.hasReminder(reminderId);
    if (hasReminder) {
      Alert.alert(
        'Remove Reminder',
        `Remove reminder for "${prog.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              const reminder = (await StorageService.getReminders()).find((r) => r.id === reminderId);
              if (reminder?.notificationId) await cancelReminderNotification(reminder.notificationId);
              await StorageService.removeReminder(reminderId);
              DeviceEventEmitter.emit('reminders:changed');
              setGuideToast(`Reminder removed for "${prog.title}"`);
            },
          },
        ],
      );
    } else {
      const leadMins = await StorageService.getReminderLeadMins();
      // Build the reminder object first so scheduleReminderNotification gets a
      // typed Reminder (its first argument) rather than a raw notification payload.
      const newReminder: Reminder = {
        id: reminderId,
        channelId: ch.id,
        channelName: ch.name,
        channelLogo: ch.logo,
        programTitle: prog.title,
        programDescription: prog.description,
        start: prog.start.toISOString(),
        end: prog.end.toISOString(),
        streamUrl: ch.streamUrl,
        createdAt: new Date().toISOString(),
        leadMins,
      };
      const notifTime = new Date(prog.start.getTime() - leadMins * 60_000);
      const notificationId = notifTime > new Date()
        ? (await scheduleReminderNotification(newReminder, leadMins)) ?? undefined
        : undefined;
      await StorageService.addReminder({ ...newReminder, notificationId });
      DeviceEventEmitter.emit('reminders:changed');
      setGuideToast(`🔔 Reminder set for "${prog.title}"`);
    }
  }, []);

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

  // Animated value for the NOW line so position transitions smoothly each minute
  const nowXAnim = useRef(new Animated.Value(nowX)).current;
  useEffect(() => {
    Animated.timing(nowXAnim, { toValue: nowX, duration: 800, useNativeDriver: false }).start();
  }, [nowX]);

  // Channel filter — applied on top of the already-filtered channels prop
  const visibleChannels = useMemo(() => {
    const q = normaliseStr(debouncedChFilter.trim());
    return q ? channels.filter((c) => normaliseStr(c.name).includes(q)) : channels;
  }, [channels, debouncedChFilter]);

  // Height of the full programme column — used for the "Now" indicator line
  const nowLineH = visibleChannels.length * ROW_H;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Only one horizontal scroll ref is needed — the time header shadows it
  const timeHeaderRef = useRef<ScrollView>(null);
  const gridHorizRef  = useRef<ScrollView>(null);
  // Vertical ScrollView ref — needed to restore vertical position after
  // an orientation change remounts the view and resets offset to 0.
  const gridVertRef   = useRef<ScrollView>(null);

  // Tracks the latest horizontal scroll offset so it can be restored after an
  // orientation change or split-screen resize resets the ScrollView position.
  const gridScrollOffsetRef = useRef<number>(0);
  // Tracks the latest vertical scroll offset for the same reason.
  const gridVertOffsetRef = useRef<number>(0);
  // Tracks the previous window width so the orientation-change restore effect
  // can tell the difference between a real resize and the initial mount.
  const { width: windowWidth } = useWindowDimensions();
  const prevWindowWidthRef = useRef<number | null>(null);

  // When day changes scroll horizontally to current time (today) or day start
  useEffect(() => {
    const scrollX = selectedDay === 0 ? Math.max(0, nowX - SLOT_W * 2) : 0;
    // Keep the offset ref in sync with the programmatic scroll so that an
    // orientation change immediately after a day change restores the right position.
    gridScrollOffsetRef.current = scrollX;
    const timer = setTimeout(() => {
      gridHorizRef.current?.scrollTo({ x: scrollX, animated: false });
      timeHeaderRef.current?.scrollTo({ x: scrollX, animated: false });
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedDay, nowX]);

  // After an orientation change or split-screen resize the horizontal ScrollViews
  // remount and their content offset resets to 0.  This effect detects that by
  // watching windowWidth and restores both views to the saved offset.
  // The vertical ScrollView is restored here too — its content height is fixed
  // (channel count × ROW_H) and its position is equally invalidated on remount.
  // The initial mount is intentionally skipped (prevWindowWidthRef is null) so
  // this doesn't race with the day-change effect above.
  useEffect(() => {
    if (Platform.isTV) return; // TV rows handle their own restoration in TVEpgRow
    if (prevWindowWidthRef.current === null) {
      prevWindowWidthRef.current = windowWidth;
      return;
    }
    if (prevWindowWidthRef.current === windowWidth) return;
    prevWindowWidthRef.current = windowWidth;
    const x = gridScrollOffsetRef.current;
    const y = gridVertOffsetRef.current;
    const timer = setTimeout(() => {
      gridHorizRef.current?.scrollTo({ x, animated: false });
      timeHeaderRef.current?.scrollTo({ x, animated: false });
      gridVertRef.current?.scrollTo({ y, animated: false });
    }, 150);
    return () => clearTimeout(timer);
  }, [windowWidth]);

  const onGridHorizScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    gridScrollOffsetRef.current = x;
    timeHeaderRef.current?.scrollTo({ x, animated: false });
  }, []);

  const onGridVertScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    gridVertOffsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Top bar */}
      <View style={[styles.topBar, { borderBottomColor: colors.border, paddingTop: insets.top + 4 }]}>
        {/* ‹ Category Name › prev/next navigation */}
        {(() => {
          const catIndex = categoryIds.indexOf(selectedCat);
          const hasPrev = catIndex > 0;
          const hasNext = catIndex >= 0 && catIndex < categoryIds.length - 1;
          return (
            <>
              <FocusablePressable
                style={[styles.catNavBtn, { opacity: hasPrev ? 1 : 0.25 }]}
                onPress={() => hasPrev ? onChangeCat(categoryIds[catIndex - 1]) : onBack()}
              >
                <Text style={[styles.catNavArrow, { color: colors.foreground }]}>‹</Text>
              </FocusablePressable>
              <Text style={[styles.screenTitle, { color: colors.foreground, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
                {categoryName}
              </Text>
              <FocusablePressable
                style={[styles.catNavBtn, { opacity: hasNext ? 1 : 0.25 }]}
                onPress={() => { if (hasNext) onChangeCat(categoryIds[catIndex + 1]); }}
                disabled={!hasNext}
              >
                <Text style={[styles.catNavArrow, { color: colors.foreground }]}>›</Text>
              </FocusablePressable>
            </>
          );
        })()}
        <Text style={[styles.guideClockText, { color: colors.mutedForeground }]}>
          {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>

        {epgLoading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.loadingLabel, { color: colors.mutedForeground }]}>Loading EPG…</Text>
          </View>
        )}
        {epgError && !epgLoading && (
          <FocusablePressable style={[styles.errBadge, { borderColor: '#EF4444' }]} onPress={() => refetchEpg()}>
            <Text style={styles.errText}>EPG failed — tap to retry</Text>
          </FocusablePressable>
        )}

        {/* Refresh EPG button */}
        <FocusablePressable
          style={[styles.todayBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          onPress={() => refetchEpg()}
        >
          <Text style={[styles.todayBtnText, { color: colors.mutedForeground }]}>↺</Text>
        </FocusablePressable>

        {/* Jump-to-now button — always visible so the user can navigate back to Today */}
        <FocusablePressable
          style={[styles.todayBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
          onPress={() => {
            // If on a future day, snap back to Today first
            setSelectedDay(0);
            const scrollX = Math.max(0, nowX - SLOT_W * 2);
            // Use a small delay so the day-change effect fires first and repositions the scroll
            setTimeout(() => {
              gridHorizRef.current?.scrollTo({ x: scrollX, animated: true });
              timeHeaderRef.current?.scrollTo({ x: scrollX, animated: true });
            }, 50);
          }}
        >
          <View style={styles.nowDot} />
          <Text style={[styles.todayBtnText, { color: '#EF4444' }]}>
            {selectedDay === 0 ? 'Now' : 'Today'}
          </Text>
        </FocusablePressable>

        <TextInput
          value={chFilter}
          onChangeText={setChFilter}
          placeholder={
            chFilter.trim()
              ? `${visibleChannels.length} / ${channels.length} channels`
              : `Filter ${channels.length} channels…`
          }
          placeholderTextColor={colors.mutedForeground}
          style={[styles.guideChFilter, { backgroundColor: colors.secondary, color: colors.foreground, borderColor: colors.border }]}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Day navigation: prev/next arrows + tab strip */}
      <View style={[styles.dayBar, { borderBottomColor: colors.border, backgroundColor: colors.card, flexDirection: 'row', alignItems: 'center' }]}>
        <FocusablePressable
          style={[styles.dayNavArrow, { opacity: selectedDay === 0 ? 0.25 : 1 }]}
          onPress={() => setSelectedDay((d) => Math.max(0, d - 1))}
          disabled={selectedDay === 0}
        >
          <Text style={[styles.dayNavArrowText, { color: colors.foreground }]}>‹</Text>
        </FocusablePressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={styles.dayBarContent}
        >
          {days.map((d, i) => {
            const dayMs = dayStart(i).getTime();
            const noData = latestEpgMs > 0 && dayMs >= latestEpgMs;
            const isSelected = i === selectedDay;
            return (
              <FocusablePressable
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
              >
                <Text style={[styles.dayTabText, { color: isSelected ? '#fff' : colors.mutedForeground }]}>
                  {d.short}
                </Text>
                {noData && !isSelected && (
                  <View style={styles.noDataDot} />
                )}
              </FocusablePressable>
            );
          })}
        </ScrollView>
        <FocusablePressable
          style={[styles.dayNavArrow, { opacity: selectedDay === days.length - 1 ? 0.25 : 1 }]}
          onPress={() => setSelectedDay((d) => Math.min(days.length - 1, d + 1))}
          disabled={selectedDay === days.length - 1}
        >
          <Text style={[styles.dayNavArrowText, { color: colors.foreground }]}>›</Text>
        </FocusablePressable>
      </View>

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
      {visibleChannels.length === 0 && chFilter.trim() ? (
        <View style={[styles.empty, { paddingTop: 64 }]}>
          <Text style={{ fontSize: 36 }}>🔍</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No channels match</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Try a different channel name.
          </Text>
          <FocusablePressable
            style={[styles.clearFilterBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
            onPress={() => {
              setChFilter('');
              // Also scroll back to the current time
              const scrollX = Math.max(0, nowX - SLOT_W * 2);
              gridHorizRef.current?.scrollTo({ x: scrollX, animated: true });
              timeHeaderRef.current?.scrollTo({ x: scrollX, animated: true });
            }}
          >
            <Text style={[styles.clearFilterBtnText, { color: colors.primary }]}>✕ Clear filter</Text>
          </FocusablePressable>
        </View>
      ) : null}
      {/* EPG loading overlay — semi-transparent spinner over the grid */}
      {epgLoading && visibleChannels.length > 0 && (
        <View style={[StyleSheet.absoluteFill, styles.epgLoadingOverlay]} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.epgLoadingText, { color: colors.mutedForeground }]}>Loading guide data…</Text>
        </View>
      )}
      {!selectedDayEmpty && visibleChannels.length > 0 && (
        Platform.isTV ? (
          /* ── TV / Fire TV: FlatList rows — every cell is D-pad focusable ── */
          <FlatList
            data={visibleChannels}
            keyExtractor={(ch) => ch.id}
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item: ch, index }) => (
              <TVEpgRow
                channel={ch}
                programs={epgMap?.get(ch.epgId ?? ch.id) ?? []}
                dayStartMs={dayStartMs}
                now={now}
                isToday={selectedDay === 0}
                isFirst={index === 0}
                colors={colors}
                reminderIds={guideReminderIds}
                onProgramPress={(p, c) => setSelected({ program: p, channel: c })}
                firstChannelRef={index === 0 ? firstChannelRef : undefined}
                lastFocusedProgRef={lastFocusedProgViewRef}
                jumpToNowRef={index === 0 ? jumpToNowCallbackRef : undefined}
                onWatchChannel={(c) => {
                  const chList = channels.map((x) => ({
                    url: x.streamUrl, title: x.name,
                    epgId: x.epgId ?? x.id, logo: x.logo ?? '', channelId: x.id,
                  }));
                  const idx = channels.findIndex((x) => x.id === c.id);
                  router.push({
                    pathname: '/player',
                    params: {
                      url: c.streamUrl, title: c.name, type: 'live',
                      logo: c.logo ?? '', epgId: c.epgId ?? c.id,
                      channelId: c.id, channelsJson: JSON.stringify(chList),
                      channelIndex: String(idx), stopOnBack: 'true',
                    },
                  });
                }}
              />
            )}
          />
        ) : (
          /* ── Phone / tablet: original nested-ScrollView grid ── */
          <View style={[styles.grid, { paddingRight: insets.right }]}>

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

            {/* Scrollable body — single ScrollView keeps columns in sync */}
            <ScrollView
              ref={gridVertRef}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={onGridVertScroll}
            >
              <View style={{ flexDirection: 'row' }}>

                {/* Left: channel name column */}
                <View style={[styles.leftCol, { borderRightColor: colors.border }]}>
                  {visibleChannels.map((ch) => {
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
                        isFav={guideFavIds.has(ch.id)}
                        onFavPress={async () => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                          const updated = await StorageService.toggleFavorite({ id: ch.id, name: ch.name, logo: ch.logo ?? '', streamUrl: ch.streamUrl, groupTitle: ch.groupTitle ?? '', epgId: ch.epgId ?? '' });
                          const isFaved = updated.some((f) => f.id === ch.id);
                          setGuideFavIds(new Set(updated.map((f) => f.id)));
                          setGuideToast(isFaved ? `♥ ${ch.name} added to Favourites` : `${ch.name} removed from Favourites`);
                        }}
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
                  {selectedDay === 0 && nowX >= 0 && nowX <= TOTAL_DAY_W && nowLineH > 0 && (
                    <Animated.View pointerEvents="none" style={[styles.nowLine, { left: nowXAnim, height: nowLineH }]} />
                  )}
                  <View style={{ width: TOTAL_DAY_W }}>
                    {visibleChannels.map((ch) => {
                      const programs = epgMap?.get(ch.epgId ?? ch.id) ?? [];
                      return (
                        <ProgramRow
                          key={ch.id}
                          channel={ch}
                          programs={programs}
                          dayStartMs={dayStartMs}
                          now={now}
                          colors={colors}
                          reminderIds={guideReminderIds}
                          onProgramPress={(p, c) => setSelected({ program: p, channel: c })}
                          onProgramLongPress={handleProgramLongPress}
                        />
                      );
                    })}
                  </View>
                </ScrollView>

              </View>
            </ScrollView>
          </View>
        )
      )}

      {guideToast !== null && (
        <Toast message={guideToast} visible duration={2500} onHide={() => setGuideToast(null)} />
      )}

      {selected && (
        <ProgramModal
          program={selected.program}
          channel={selected.channel}
          colors={colors}
          onClose={() => {
            setSelected(null);
            // Restore D-pad focus to the programme cell that opened the modal.
            if (Platform.isTV) {
              setTimeout(() => { lastFocusedProgViewRef.current?.focus(); }, 80);
            }
          }}
          onWatch={() => {
            const chList = channels.map((ch) => ({
              url: ch.streamUrl,
              title: ch.name,
              epgId: ch.epgId ?? ch.id,
              logo: ch.logo ?? '',
              channelId: ch.id,
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
                channelId: selected!.channel.id,
                channelsJson: JSON.stringify(chList),
                channelIndex: String(idx),
                // Launched from Guide — no mini-player to collapse to on this
                // tab, so pause the shared player and go back cleanly instead
                // of leaving audio running in the background.
                stopOnBack: 'true',
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
  // Receive channelId from notification deep-links (passed by _layout.tsx)
  const { channelId: notifChannelId } = useLocalSearchParams<{ channelId?: string }>();

  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  // Channel to auto-highlight after notification tap
  const [pendingHighlightId, setPendingHighlightId] = useState<string | null>(notifChannelId ?? null);
  // Favourite channels — loaded once so the guide can show ♥ badge and toggle
  const [guideFavIds, setGuideFavIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    StorageService.getFavorites().then((favs) => setGuideFavIds(new Set(favs.map((f) => f.id))));
  }, []);

  // #128: When the Guide tab comes back into focus (e.g. user just cancelled a
  // reminder from the Reminders screen), broadcast reminders:changed so any
  // open ProgramModal refreshes its bell-icon state immediately.
  useFocusEffect(
    useCallback(() => {
      DeviceEventEmitter.emit('reminders:changed');
    }, []),
  );

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

  // Category IDs in server order (same as Live TV), filtered to only those with channels.
  //
  // PERF: Do NOT wait for `channels` to be non-empty before showing categories.
  // `liveCategories` is a lightweight list that loads in ~200 ms; `channels` is
  // the full live-stream catalogue (potentially thousands of entries / several MB)
  // and can take several seconds.  Blocking categoryIds on channels makes the
  // CategoryGrid sit blank the entire time channels are loading.
  //
  // Instead: surface all categories as soon as liveCategories arrives.  Once
  // channels loads, quietly filter out any that have no streams (rare in
  // practice — providers almost never have orphaned category entries).
  // The count badges naturally update from 0 → N when channels resolves.
  const categoryIds = useMemo(() => {
    if (channels.length === 0) {
      // Channels still loading — show every category so the grid is immediately
      // usable. If the user selects one, filteredChannels will be empty and they
      // will see the guide grid with no channels; that's an acceptable brief state.
      return liveCategories.map((c) => c.id);
    }
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

  // Auto-select the channel's category when opened from a notification deep-link
  useEffect(() => {
    if (!pendingHighlightId || channels.length === 0) return;
    const ch = channels.find((c) => c.id === pendingHighlightId || c.epgId === pendingHighlightId);
    if (!ch) return;
    setPendingHighlightId(null);
    if (ch.groupTitle) setSelectedCat(ch.groupTitle);
  }, [pendingHighlightId, channels]);

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
        categoryIds={categoryIds}
        categoryNameMap={categoryNameMap}
        selectedCat={selectedCat}
        onChangeCat={(catId) => setSelectedCat(catId)}
        colors={colors}
        insets={insets}
        router={router}
        guideFavIds={guideFavIds}
        setGuideFavIds={setGuideFavIds}
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
  guideChFilter: { flex: 1, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 5, fontSize: 12, fontFamily: 'Inter_400Regular' },
  epgLoadingOverlay: { justifyContent: 'center', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 10 },
  epgLoadingText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  guideClockText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, textAlign: 'right' },
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

  // ── Category prev/next arrows ──
  catNavBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catNavArrow: {
    fontSize: 26,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 30,
  },

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
  dayNavArrow: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayNavArrowText: { fontSize: 22, fontFamily: 'Inter_600SemiBold', lineHeight: 26 },
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
  chLiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#EF4444' },
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
  reminderBadge: { position: 'absolute', top: 2, right: 3 },
  reminderBadgeIcon: { fontSize: 8 },
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
  clearFilterBtn: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  clearFilterBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
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

  // ── TV / Fire TV remote focus highlight ──
  tvFocused: {
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderRadius: 6,
  },

  // ── TV EPG grid ──
  tvRow: {
    flexDirection: 'row',
    height: ROW_H,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tvChCell: {
    width: TV_CH_W,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    gap: 3,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  tvChLogo: { width: 52, height: 32, borderRadius: 4 },
  tvChInitials: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  tvChName: {
    fontSize: 9, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 12,
  },
  tvNoProg: {
    flex: 1, justifyContent: 'center', paddingHorizontal: 16,
  },
  tvNoProgText: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  tvProgCell: {
    height: ROW_H - 1,
    marginRight: TV_CELL_GAP,
    borderRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
    overflow: 'hidden',
    justifyContent: 'center',
    gap: 2,
  },
  tvProgTitle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  tvProgTime: { fontSize: 9, fontFamily: 'Inter_400Regular' },
  /** Dark pill that wraps the 🔔 so it's readable regardless of cell background or focus border. */
  tvReminderBadge: {
    position: 'absolute',
    top: 2,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.50)',
    borderRadius: 3,
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  tvReminderDot: { fontSize: 8 },
});
