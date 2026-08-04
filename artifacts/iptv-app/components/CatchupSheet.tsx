import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { getXtreamCatchupEpg, getXtreamCatchupUrls } from '@/services/xtreamApi';
import type { Channel, CatchupProgram, EpgProgram } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Creds {
  host: string;
  username: string;
  password: string;
}

export interface CatchupSheetProps {
  visible: boolean;
  channel: Channel;
  creds: Creds;
  /** Already-loaded XMLTV EPG map — used for today's guide row */
  epgMap?: Map<string, EpgProgram[]>;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayLabel(date: Date, todayMidnight: Date): string {
  const diffMs = todayMidnight.getTime() - date.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** Convert a JS Date to the "YYYY-MM-DD HH:MM:SS" server-local string format. */
function toServerDateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// ─── CatchupSheet ─────────────────────────────────────────────────────────────

export function CatchupSheet({
  visible,
  channel,
  creds,
  epgMap,
  onClose,
}: CatchupSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Midnight of today — stable reference for the lifetime of this sheet render.
  const todayMidnight = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Days list: today + up to N past days (capped at 7)
  const archiveDays = Math.max(1, Math.min(channel.tvArchiveDuration ?? 7, 7));
  const days = useMemo<Date[]>(() => {
    const list: Date[] = [];
    for (let i = 0; i < archiveDays; i++) {
      const d = new Date(todayMidnight.getTime() - i * 86_400_000);
      list.push(d);
    }
    return list;
  }, [todayMidnight, archiveDays]);

  const [selectedDay, setSelectedDay] = useState<Date>(() => days[0]);

  // Fetch all catchup programmes from the Xtream API (includes past days).
  const { data: catchupPrograms, isLoading } = useQuery<CatchupProgram[]>({
    queryKey: ['catchup-epg', channel.id, creds.host],
    queryFn: () => getXtreamCatchupEpg(creds, channel.id),
    enabled: visible,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  const isToday = isSameDay(selectedDay, todayMidnight);
  const nowTs = Date.now();

  // Programmes for the selected day
  const programmes = useMemo<CatchupProgram[]>(() => {
    if (isToday) {
      // For "Today", derive CatchupPrograms from the existing XMLTV EPG map
      // so the display is consistent with the live TV guide.
      const progs = epgMap?.get(channel.epgId ?? channel.id) ?? [];
      const todayStart = todayMidnight.getTime();
      const todayEnd = todayStart + 86_400_000;
      return progs
        .filter((p) => p.start.getTime() < todayEnd && p.end.getTime() > todayStart)
        .map((p) => ({
          id: `${p.channelId}-${p.start.getTime()}`,
          title: p.title,
          description: p.description,
          start: p.start,
          end: p.end,
          hasArchive: true,
          serverStart: toServerDateStr(p.start),
          startTimestamp: Math.floor(p.start.getTime() / 1000),
        }));
    }

    // Past days — use the Xtream catch-up EPG
    if (!catchupPrograms) return [];
    return catchupPrograms.filter((p) => isSameDay(p.start, selectedDay));
  }, [catchupPrograms, selectedDay, isToday, epgMap, channel, todayMidnight]);

  const handlePlayCatchup = (prog: CatchupProgram) => {
    const durationMinutes = Math.max(
      1,
      Math.ceil((prog.end.getTime() - prog.start.getTime()) / 60_000),
    );
    const urls = getXtreamCatchupUrls(
      creds,
      channel.id,
      prog.serverStart,
      durationMinutes,
      prog.startTimestamp,
    );

    onClose();
    router.push({
      pathname: '/player',
      params: {
        url: urls[0],
        title: `${prog.title} — ${channel.name}`,
        type: 'catchup',
        logo: channel.logo ?? '',
        // Pass duration so the scrubber has a progress bar immediately
        // (timeshift HLS streams don't expose duration to expo-video).
        knownDuration: String(durationMinutes * 60),
        // Fields needed to regenerate the timeshift URL when the user seeks
        catchupStreamId: channel.id,
        catchupServerStart: prog.serverStart,
        catchupStartTimestamp: String(prog.startTimestamp),
      },
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[sheet.root, { backgroundColor: colors.background }]}>

        {/* ── Header ── */}
        <View
          style={[
            sheet.header,
            { paddingTop: insets.top + 12, borderBottomColor: colors.border },
          ]}
        >
          <Text
            style={[sheet.channelName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            📅 {channel.name}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 4 }}
            style={sheet.closeTouchable}
          >
            <Text style={[sheet.closeIcon, { color: colors.mutedForeground }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* ── Day strip ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[sheet.dayStrip, { borderBottomColor: colors.border }]}
          contentContainerStyle={sheet.dayStripContent}
        >
          {days.map((d, i) => {
            const sel = isSameDay(d, selectedDay);
            return (
              <Pressable
                key={i}
                onPress={() => setSelectedDay(d)}
                style={({ pressed }) => [
                  sheet.dayPill,
                  { backgroundColor: colors.secondary },
                  sel && sheet.dayPillSelected,
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text
                  style={[
                    sheet.dayPillText,
                    { color: colors.foreground },
                    sel && sheet.dayPillTextSelected,
                  ]}
                >
                  {dayLabel(d, todayMidnight)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Programme list ── */}
        {isLoading && !isToday ? (
          <View style={sheet.center}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={[sheet.emptyText, { color: colors.mutedForeground, marginTop: 12 }]}>
              Loading archive guide…
            </Text>
          </View>
        ) : programmes.length === 0 ? (
          <View style={sheet.center}>
            <Text style={sheet.emptyEmoji}>📭</Text>
            <Text style={[sheet.emptyText, { color: colors.foreground }]}>
              No guide data for this day
            </Text>
            <Text style={[sheet.emptySub, { color: colors.mutedForeground }]}>
              The provider doesn't have programme info available for this day.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
            showsVerticalScrollIndicator={false}
          >
            {programmes.map((prog, i) => {
              const isPast = prog.end.getTime() < nowTs;
              const isCurrent =
                prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
              const canPlay = isPast || isCurrent;

              return (
                <Pressable
                  key={prog.id ?? i}
                  onPress={() => (canPlay ? handlePlayCatchup(prog) : undefined)}
                  style={({ pressed }) => [
                    sheet.progRow,
                    { borderBottomColor: colors.border },
                    isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                    pressed && canPlay && { opacity: 0.7 },
                  ]}
                >
                  {/* Time + NOW badge */}
                  <View style={sheet.progTimeCol}>
                    <Text
                      style={[
                        sheet.progTime,
                        { color: isCurrent ? '#3B82F6' : colors.mutedForeground },
                      ]}
                    >
                      {fmtTime(prog.start)}
                    </Text>
                    {isCurrent && (
                      <View style={sheet.nowBadge}>
                        <Text style={sheet.nowBadgeText}>NOW</Text>
                      </View>
                    )}
                  </View>

                  {/* Title + description */}
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text
                      style={[sheet.progTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {prog.title}
                    </Text>
                    {prog.description ? (
                      <Text
                        style={[sheet.progDesc, { color: colors.mutedForeground }]}
                        numberOfLines={2}
                      >
                        {prog.description}
                      </Text>
                    ) : null}
                  </View>

                  {/* Play button indicator */}
                  {canPlay ? (
                    <View style={sheet.playChip}>
                      <Text style={sheet.playChipText}>▶</Text>
                    </View>
                  ) : (
                    <View style={[sheet.futureChip, { borderColor: colors.border }]}>
                      <Text style={[sheet.futureChipText, { color: colors.mutedForeground }]}>
                        Future
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const sheet = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  channelName: {
    flex: 1,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  closeTouchable: { paddingLeft: 12 },
  closeIcon: { fontSize: 18 },

  dayStrip: {
    maxHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  dayStripContent: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dayPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
  },
  dayPillSelected: { backgroundColor: '#3B82F6' },
  dayPillText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  dayPillTextSelected: { color: '#fff', fontFamily: 'Inter_600SemiBold' },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 4,
  },
  emptyEmoji: { fontSize: 40, marginBottom: 8 },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 4,
  },

  progRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  progTimeCol: { width: 68, alignItems: 'flex-start', gap: 4, flexShrink: 0 },
  progTime: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  nowBadge: {
    backgroundColor: '#3B82F6',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  nowBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  progTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  progDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 16 },

  playChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  playChipText: { color: '#fff', fontSize: 11 },

  futureChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  futureChipText: { fontSize: 10, fontFamily: 'Inter_500Medium' },
});
