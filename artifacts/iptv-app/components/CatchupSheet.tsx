import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  findNodeHandle,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { Toast } from '@/components/Toast';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { getXtreamCatchupEpg, getXtreamCatchupUrls } from '@/services/xtreamApi';
import type { Channel, CatchupProgram, EpgProgram } from '@/types';
import { requestTvFocus } from '@/lib/tvFocus';
import { useTVRemote } from '@/hooks/useTVRemote';
import { useBackHandler } from '@/hooks/useBackHandler';

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
  /**
   * When set the sheet opens directly on the day that contains this programme.
   * Passed from the mini TV guide when the user presses OK on a past row.
   */
  initialProg?: EpgProgram;
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
  initialProg,
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

  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    // If opened from the mini guide with a specific programme, jump straight
    // to the day that contains it instead of always defaulting to today.
    if (initialProg) {
      const progDay = new Date(initialProg.start);
      progDay.setHours(0, 0, 0, 0);
      const match = days.find((d) => isSameDay(d, progDay));
      if (match) return match;
    }
    return days[0];
  });
  const [futureToast, setFutureToast] = useState(false);
  // Ref-based guard: prevents rapid taps from resetting the toast's hide timer.
  // A ref is used (rather than reading futureToast state) so the check is
  // synchronously accurate without stale-closure issues.
  const futureToastActiveRef = useRef(false);

  const handleFutureTap = useCallback(() => {
    // On TV the "Future" chip is already visible feedback; suppress the toast.
    if (Platform.isTV) return;
    // If the toast is already showing, ignore the tap — don't reset the timer.
    if (futureToastActiveRef.current) return;
    futureToastActiveRef.current = true;
    setFutureToast(true);
  }, []);

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
  // Keep nowTs in state (updated every 60 s) so that firstPlayableIndex /
  // lastPlayableIndex memos don't recompute on every render.  A plain
  // `Date.now()` call in the render body changes every millisecond, which
  // defeats useMemo caching and creates new inline ref-callback functions on
  // every render — a key contributor to the "Maximum update depth exceeded"
  // crash on TV when the sheet mounts.
  const [nowTs, setNowTs] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

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

  // Index of the first programme row the user can actually play.
  // Used to route initial D-pad focus away from the close button on TV.
  const firstPlayableIndex = useMemo<number>(() => {
    return programmes.findIndex((p) => {
      const isPast = p.end.getTime() < nowTs;
      const isCurrent = p.start.getTime() <= nowTs && nowTs < p.end.getTime();
      return isPast || isCurrent;
    });
  }, [programmes, nowTs]);

  // Index of the last programme row the user can play.
  // Used to set nextFocusDown so D-pad doesn't wrap back to the header.
  const lastPlayableIndex = useMemo<number>(() => {
    let last = -1;
    for (let i = 0; i < programmes.length; i++) {
      const p = programmes[i];
      const isPast = p.end.getTime() < nowTs;
      const isCurrent = p.start.getTime() <= nowTs && nowTs < p.end.getTime();
      if (isPast || isCurrent) last = i;
    }
    return last;
  }, [programmes, nowTs]);

  // Ref to the first day-strip pill — the desired focus target after the
  // last playable programme row so D-pad Down doesn't wrap to the header.
  const firstDayPillRef = useRef<View>(null);

  // Map from day-pill index → View node.  Populated by callback refs on each
  // pill so the post-mount effect can wire nextFocusLeft / nextFocusRight
  // between adjacent pills without needing a re-render.
  const dayPillRefs = useRef<Map<number, View | null>>(new Map());

  // Ref to the first playable programme row — used to programmatically route
  // D-pad focus after the user switches days in the day strip.
  const firstPlayableRowRef = useRef<View>(null);

  // Tracks whether the initial mount has passed so the day-change effect
  // doesn't double-fire on first open (Modal.onShow handles initial focus).
  const dayChangedRef = useRef(false);

  // True when the last day-change placed focus on the day pill because
  // programme data hadn't loaded yet.  The data-arrival effect watches this
  // flag and re-routes focus to the first playable row once data populates.
  const focusPlacedOnDayPillRef = useRef(false);

  // True when Modal.onShow placed focus on the close button because no
  // playable rows had loaded yet on initial open.  Cleared and re-routed to
  // the first programme row by the [firstPlayableIndex] data-arrival effect.
  const focusPlacedOnCloseRef = useRef(false);

  // TV: ref to the close button — used by Modal.onShow as the initial focus
  // target when programme data hasn't arrived yet.  Replaces the previous
  // hasTVPreferredFocus={firstPlayableIndex === -1} which fired requestFocus()
  // on every re-render while data was loading.
  const closeBtnRef = useRef<View>(null);

  // When the user selects a different day on TV, move focus to the first
  // playable row for that day.  If there are no playable rows yet (still
  // loading), fall back to the first day-strip pill and record the fallback
  // in focusPlacedOnDayPillRef so the data-arrival effect can re-route focus
  // once the programme list populates.
  //
  // IMPORTANT: the sentinel must be set *synchronously* (before the timeout)
  // so the data-arrival [firstPlayableIndex] effect can see it if data resolves
  // during the 100 ms mount delay.  The timeout then reads the ref's live value
  // (not the closure) to decide whether to focus the day pill — if data arrived
  // in the meantime the data-arrival effect will have cleared the flag and we
  // skip the day-pill focus to avoid overriding it.
  useEffect(() => {
    if (!Platform.isTV) return;
    if (!dayChangedRef.current) {
      // Skip the initial mount — Modal.onShow handles initial focus.
      dayChangedRef.current = true;
      return;
    }

    // Set the sentinel synchronously so the data-arrival effect sees it
    // even if the query resolves before the 100 ms callback fires.
    if (firstPlayableIndex !== -1) {
      focusPlacedOnDayPillRef.current = false;
    } else {
      focusPlacedOnDayPillRef.current = true;
    }

    // Allow the programme list to re-render before requesting focus.
    const id = setTimeout(() => {
      if (firstPlayableIndex !== -1) {
        // Data was already available when the effect ran — focus the row.
        requestTvFocus(firstPlayableRowRef.current);
      } else if (focusPlacedOnDayPillRef.current) {
        // Data is still loading — focus the day pill so the user isn't stuck.
        // If the data-arrival effect already cleared the flag (data resolved
        // during the delay), we skip this to avoid overriding it.
        requestTvFocus(firstDayPillRef.current);
      }
      // else: data arrived during the delay and the data-arrival effect has
      //       already routed focus to the programme row; nothing to do here.
    }, 100);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  // Wire nextFocusLeft / nextFocusRight between adjacent day-strip pills after
  // the strip mounts or the day list changes.  Using setNativeProps in a
  // post-mount effect (rather than passing handles as props during render)
  // ensures all callback refs have fired and every node handle is valid.
  // Native spatial navigation inside a horizontal ScrollView is unreliable on
  // Fire OS — explicit wiring makes LEFT/RIGHT between pills deterministic.
  useEffect(() => {
    if (!Platform.isTV) return;
    const count = days.length;
    const timer = setTimeout(() => {
      for (let i = 0; i < count; i++) {
        const node = dayPillRefs.current.get(i);
        if (!node) continue;
        const props: Record<string, number> = {};
        const leftNode = i > 0 ? dayPillRefs.current.get(i - 1) : null;
        const rightNode = i < count - 1 ? dayPillRefs.current.get(i + 1) : null;
        if (leftNode) {
          const h = findNodeHandle(leftNode);
          if (h != null) props.nextFocusLeft = h;
        }
        if (rightNode) {
          const h = findNodeHandle(rightNode);
          if (h != null) props.nextFocusRight = h;
        }
        if (Object.keys(props).length > 0) {
          (node as any).setNativeProps?.(props);
        }
      }
    }, 100);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // Re-route TV focus to the first playable row when programme data arrives
  // after either:
  //   (a) a day-switch that fell back to the day pill while loading, or
  //   (b) the initial modal open that fell back to the close button while loading.
  useEffect(() => {
    if (!Platform.isTV) return;
    if (!focusPlacedOnDayPillRef.current && !focusPlacedOnCloseRef.current) return;
    if (firstPlayableIndex === -1) return;
    focusPlacedOnDayPillRef.current = false;
    focusPlacedOnCloseRef.current = false;
    const id = setTimeout(() => {
      requestTvFocus(firstPlayableRowRef.current);
    }, 100);
    return () => clearTimeout(id);
  }, [firstPlayableIndex]);

  // ── TV navigation: BACK and LEFT both dismiss the sheet ──────────────────────
  //
  // BACK is already handled natively by the Modal's onRequestClose prop, but
  // on some Fire OS builds the Modal consumes the event before reaching the
  // parent screen's BackHandler, so we register a second handler here as
  // belt-and-suspenders.
  useBackHandler(() => {
    if (!Platform.isTV) return false;
    onClose();
    return true;
  });

  // LEFT key: when fired from a focusable element that has no nextFocusLeft
  // target (programme rows, leftmost day pill, close button), the spatial
  // engine can't route focus and the raw key event falls through to
  // onHWKeyEvent — which useTVRemote picks up here and uses to dismiss the
  // sheet, matching the "LEFT = go back one level" pattern used across all
  // other TV overlays in the app.
  useTVRemote({
    left: (e) => {
      // Fire on key-up only to avoid double-firing on held presses.
      if (e.eventKeyAction === 1) onClose();
    },
  });

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
      onShow={() => {
        // TV: move D-pad focus to the first playable row on open.  If data
        // hasn't arrived yet fall back to the close button and set a flag so
        // the [firstPlayableIndex] data-arrival effect re-routes to the row
        // once the query resolves.  Modal.onShow fires once per open —
        // avoids hasTVPreferredFocus re-firing requestFocus on every re-render
        // while loading state or firstPlayableIndex change.
        if (!Platform.isTV) return;
        setTimeout(() => {
          if (firstPlayableIndex !== -1 && firstPlayableRowRef.current) {
            requestTvFocus(firstPlayableRowRef.current);
          } else {
            focusPlacedOnCloseRef.current = true;
            requestTvFocus(closeBtnRef.current);
          }
        }, 100);
      }}
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
          <FocusablePressable
            ref={closeBtnRef}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 4 }}
            style={sheet.closeTouchable}
            focusedStyle={sheet.closeFocused}
          >
            <Text style={[sheet.closeIcon, { color: colors.mutedForeground }]}>✕</Text>
          </FocusablePressable>
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
              <FocusablePressable
                key={i}
                ref={(el: View | null) => {
                  // Populate the cross-pill ref map for nextFocusLeft/Right wiring.
                  if (el) dayPillRefs.current.set(i, el);
                  else dayPillRefs.current.delete(i);
                  // Forward to firstDayPillRef for existing day-change focus logic.
                  if (i === 0) {
                    (firstDayPillRef as React.MutableRefObject<View | null>).current = el;
                  }
                }}
                onPress={() => setSelectedDay(d)}
                style={[
                  sheet.dayPill,
                  { backgroundColor: colors.secondary },
                  sel && sheet.dayPillSelected,
                ]}
                focusedStyle={sheet.dayPillFocused}
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
              </FocusablePressable>
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
                <FocusablePressable
                  key={prog.id ?? i}
                  ref={
                    Platform.isTV && (i === firstPlayableIndex || i === lastPlayableIndex)
                      ? (r: View | null) => {
                          // Store the first playable row so the day-change
                          // effect can programmatically move focus to it.
                          if (i === firstPlayableIndex) {
                            (firstPlayableRowRef as React.MutableRefObject<View | null>).current = r;
                          }
                          // Wire D-pad Down on the last playable row to the
                          // first day-strip pill so the focus engine never
                          // wraps back to the close button.
                          if (i === lastPlayableIndex && r && firstDayPillRef.current) {
                            setTimeout(() => {
                              const handle = findNodeHandle(firstDayPillRef.current);
                              if (handle != null) {
                                (r as View).setNativeProps({ nextFocusDown: handle });
                              }
                            }, 50);
                          }
                        }
                      : undefined
                  }
                  onPress={() => (canPlay ? handlePlayCatchup(prog) : handleFutureTap())}
                  focusable={canPlay}
                  style={[
                    sheet.progRow,
                    { borderBottomColor: colors.border },
                    isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                  ]}
                  focusedStyle={sheet.progRowFocused}
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
                </FocusablePressable>
              );
            })}
          </ScrollView>
        )}
        <Toast
          message="Not yet available"
          visible={futureToast}
          duration={2500}
          onHide={() => {
            futureToastActiveRef.current = false;
            setFutureToast(false);
          }}
        />
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

  // ── TV / Fire TV remote focus styles (#248) ──
  closeFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
    borderRadius: 6,
  },
  dayPillFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
  /** Highlight the focused programme row with a left accent bar + tint */
  progRowFocused: {
    backgroundColor: 'rgba(0,229,255,0.10)',
    borderLeftWidth: 3,
    borderLeftColor: '#00E5FF',
  },
});
