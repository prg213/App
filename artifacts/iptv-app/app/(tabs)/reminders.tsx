import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import {
  cancelReminderNotification,
  scheduleReminderNotification,
} from '@/services/notifications';
import { useAppContext } from '@/context/AppContext';
import { getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Reminder, Channel } from '@/types';
import { SIDEBAR_W } from './_layout';

function buildCreds(c: ReturnType<typeof useAppContext>['credentials']) {
  return {
    host: c?.host ?? '',
    username: c?.username ?? '',
    password: c?.password ?? '',
  };
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
  const h = d.getHours(), m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  return `${dayLabel} · ${h % 12 || 12}:${String(m).padStart(2, '0')}${ampm}`;
}

// #102: accept nowTs so the countdown re-renders with the parent's 30 s tick
function timeUntil(iso: string, nowTs: number): string {
  const diff = new Date(iso).getTime() - nowTs;
  if (diff <= 0) return 'Starting now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
}

const LEAD_OPTIONS: { label: string; value: number }[] = [
  { label: '5 min before', value: 5 },
  { label: '10 min before', value: 10 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
];

function RescheduleModal({
  reminder,
  colors,
  visible,
  onClose,
  onSelect,
}: {
  reminder: Reminder | null;
  colors: any;
  visible: boolean;
  onClose: () => void;
  onSelect: (leadMins: number) => void;
}) {
  if (!reminder) return null;
  const currentLeadMins = reminder.leadMins ?? null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>
            ⏰  Reschedule Reminder
          </Text>
          <Text style={[styles.modalSub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {reminder.programTitle}
          </Text>
          <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />
          {LEAD_OPTIONS.map((opt) => {
            const isCurrent = currentLeadMins === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.modalOption,
                  isCurrent && { backgroundColor: colors.secondary },
                ]}
                onPress={() => onSelect(opt.value)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modalOptionText, { color: isCurrent ? colors.primary : colors.foreground }]}>
                  {opt.label}
                </Text>
                {isCurrent && (
                  <Text style={[styles.modalOptionCheck, { color: colors.primary }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={styles.modalCancel} onPress={onClose} activeOpacity={0.7}>
            <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ReminderCard({
  reminder,
  colors,
  nowTs,
  leadMins,
  onDelete,
  onReschedule,
  onWatchLive,
}: {
  reminder: Reminder;
  colors: any;
  nowTs: number;
  /** #100: current global notification lead time to display on the card */
  leadMins: number;
  onDelete: () => void;
  onReschedule: () => void;
  onWatchLive?: () => void;
}) {
  const startMs = new Date(reminder.start).getTime();
  const endMs = new Date(reminder.end).getTime();
  const isPast = startMs < nowTs;
  // isOnAir is decoupled from streamUrl so the "On now" badge and blue border
  // show even when we are still backfilling the stream URL for old reminders.
  const isOnAir = startMs <= nowTs && nowTs < endMs;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: isOnAir ? '#3B82F6' : colors.border, opacity: isPast && !isOnAir ? 0.5 : 1 }]}>
      {/* Left: channel logo */}
      <View style={[styles.logoWrap, { backgroundColor: colors.secondary }]}>
        {reminder.channelLogo ? (
          <Image source={{ uri: reminder.channelLogo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <Text style={styles.logoFallback}>📺</Text>
        )}
      </View>

      {/* Centre: info */}
      <View style={styles.info}>
        <Text style={[styles.progTitle, { color: colors.foreground }]} numberOfLines={1}>
          {reminder.programTitle}
        </Text>
        <Text style={[styles.chName, { color: colors.primary }]} numberOfLines={1}>
          {reminder.channelName}
        </Text>
        <Text style={[styles.time, { color: colors.mutedForeground }]}>
          {fmtDate(reminder.start)}
          {!isPast && (
            <Text style={[styles.badge, { color: '#22C55E' }]}>  {timeUntil(reminder.start, nowTs)}</Text>
          )}
          {isPast && !isOnAir && <Text style={{ color: '#EF4444' }}>  Past</Text>}
          {isOnAir && <Text style={{ color: '#3B82F6' }}>  On now</Text>}
        </Text>
        {/* #100: show when the notification will fire */}
        {!isPast && !isOnAir && leadMins > 0 && (
          <Text style={[styles.leadBadge, { color: colors.mutedForeground }]}>
            ⏰ Notifies {reminder.leadMins ?? leadMins}min before
          </Text>
        )}
        {reminder.programDescription ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
            {reminder.programDescription}
          </Text>
        ) : null}

        {/* Watch Live button — shown when programme is currently airing */}
        {isOnAir && reminder.streamUrl && onWatchLive && (
          <TouchableOpacity
            style={styles.watchLiveBtn}
            onPress={onWatchLive}
            activeOpacity={0.8}
          >
            <Text style={styles.watchLiveBtnText}>▶  Watch Live</Text>
          </TouchableOpacity>
        )}
        {/* Graceful fallback when on-air but channel URL could not be resolved */}
        {isOnAir && !reminder.streamUrl && (
          <View style={[styles.watchLiveBtn, styles.watchLiveBtnDisabled]}>
            <Text style={[styles.watchLiveBtnText, styles.watchLiveBtnTextDisabled]}>▶  Watch Live</Text>
          </View>
        )}
      </View>

      {/* Right: edit + delete buttons */}
      <View style={styles.actions}>
        {!isPast && (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.border }]}
            onPress={onReschedule}
            activeOpacity={0.7}
          >
            <Text style={styles.actionBtnText}>✎</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, { borderColor: colors.border }]}
          onPress={onDelete}
          activeOpacity={0.7}
        >
          <Text style={styles.actionBtnText}>✕</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function RemindersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { credentials } = useAppContext();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [rescheduleTarget, setRescheduleTarget] = useState<Reminder | null>(null);
  // #100: load the global lead time so cards can display "Notifies X min before"
  const [reminderLeadMins, setReminderLeadMins] = useState(5);
  useEffect(() => {
    StorageService.getReminderLeadMins().then(setReminderLeadMins);
  }, []);

  // Ticker: re-evaluate on-air status every 30 s while screen is focused.
  // #103: also auto-remove reminders whose programme has now ended.
  useFocusEffect(
    useCallback(() => {
      setNowTs(Date.now());
      const id = setInterval(() => {
        const now = Date.now();
        setNowTs(now);
        setReminders((prev) => {
          const ended = prev.filter((r) => new Date(r.end).getTime() <= now);
          if (ended.length === 0) return prev;
          // Remove ended reminders from storage (fire-and-forget)
          ended.forEach((r) => {
            cancelReminderNotification(r.notificationId);
            StorageService.removeReminder(r.id);
          });
          DeviceEventEmitter.emit('reminders:changed');
          return prev.filter((r) => new Date(r.end).getTime() > now);
        });
      }, 30_000);
      return () => clearInterval(id);
    }, []),
  );

  /**
   * Fetch all channels once (Xtream or M3U) and return a map of channelId → streamUrl.
   * Returns null if credentials are unavailable or the fetch fails.
   */
  const fetchChannelUrlMap = useCallback(async (): Promise<Map<string, string> | null> => {
    if (!credentials) return null;
    try {
      let channels: Channel[] = [];
      if (credentials.type === 'xtream') {
        channels = await getXtreamLiveStreams(buildCreds(credentials));
      } else if (credentials.m3uUrl) {
        const parsed = await fetchAndParseM3U(credentials.m3uUrl);
        channels = parsed.channels;
      }
      const map = new Map<string, string>();
      for (const ch of channels) {
        map.set(ch.id, ch.streamUrl);
      }
      return map;
    } catch {
      return null;
    }
  }, [credentials]);

  /**
   * #104: Backfill streamUrl for ALL reminders that are missing one
   * (on-air AND upcoming), so Watch Live works as soon as they start.
   * #105: Also refresh any stored URL that has changed on the server
   * (for on-air and upcoming only — past reminders don't need playback).
   * Fetches the channel list once and persists any updates atomically.
   */
  const backfillStreamUrls = useCallback(
    async (loaded: Reminder[]): Promise<Reminder[]> => {
      const now = Date.now();
      // Only work on active/upcoming reminders (past ones don't need URLs)
      const active = loaded.filter((r) => new Date(r.end).getTime() > now);
      const needsWork = active.some(
        (r) => !r.streamUrl || true, // always refresh URLs to catch #105 changes
      );
      if (!needsWork || active.length === 0) return loaded;

      const urlMap = await fetchChannelUrlMap();
      if (!urlMap) return loaded;

      let anyUpdated = false;
      const updated = loaded.map((r) => {
        const isActive = new Date(r.end).getTime() > now;
        if (!isActive) return r; // leave past reminders untouched
        const fresh = urlMap.get(r.channelId);
        if (!fresh) return r;
        if (r.streamUrl !== fresh) {
          anyUpdated = true;
          return { ...r, streamUrl: fresh };
        }
        return r;
      });

      if (anyUpdated) {
        await StorageService.saveReminders(updated);
      }
      return updated;
    },
    [fetchChannelUrlMap],
  );

  const load = useCallback(() => {
    // #95/#101: prune reminders older than 24 h, then notify if any were removed
    StorageService.pruneExpiredReminders().then((removed) => {
      if (removed.length > 0) {
        const names = removed.slice(0, 3).join(', ') + (removed.length > 3 ? ` + ${removed.length - 3} more` : '');
        Alert.alert(
          'Reminders Cleared',
          `${removed.length} expired reminder${removed.length > 1 ? 's were' : ' was'} automatically removed:\n${names}`,
          [{ text: 'OK' }],
        );
      }
      return StorageService.getReminders();
    }).then(async (r) => {
      // #104/#105: backfill missing URLs and refresh stale ones for all active reminders
      const backfilled = await backfillStreamUrls(r);
      const sorted = [...backfilled].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
      setReminders(sorted);
      // #109: let the tab bar badge update immediately after load
      DeviceEventEmitter.emit('reminders:changed');
    });
  }, [backfillStreamUrls]);

  useFocusEffect(load);

  const handleDelete = (reminder: Reminder) => {
    Alert.alert('Remove Reminder', 'Remove this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await cancelReminderNotification(reminder.notificationId);
          await StorageService.removeReminder(reminder.id);
          DeviceEventEmitter.emit('reminders:changed'); // #109
          load();
        },
      },
    ]);
  };

  const handleClearPast = () => {
    const past = reminders.filter((r) => new Date(r.end) < new Date());
    if (past.length === 0) return;
    Alert.alert('Clear Past', `Remove ${past.length} past reminder${past.length > 1 ? 's' : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          for (const r of past) {
            await cancelReminderNotification(r.notificationId);
            await StorageService.removeReminder(r.id);
          }
          DeviceEventEmitter.emit('reminders:changed'); // #109
          load();
        },
      },
    ]);
  };

  const handleReschedule = useCallback(async (leadMins: number) => {
    const reminder = rescheduleTarget;
    if (!reminder) return;
    setRescheduleTarget(null);

    // Cancel the existing notification
    await cancelReminderNotification(reminder.notificationId);

    // Schedule a new notification at the chosen lead time
    const newNotificationId = await scheduleReminderNotification(reminder, leadMins) ?? undefined;

    // Persist the updated leadMins and new notificationId
    await StorageService.updateReminder(reminder.id, { leadMins, notificationId: newNotificationId });

    load();
  }, [rescheduleTarget, load]);

  const handleWatchLive = useCallback((reminder: Reminder) => {
    if (!reminder.streamUrl) return;
    router.push({
      pathname: '/player',
      params: {
        url: reminder.streamUrl,
        title: reminder.channelName,
        type: 'live',
        logo: reminder.channelLogo ?? '',
        epgId: reminder.channelId,
        channelsJson: '[]',
        channelIndex: '-1',
      },
    });
  }, [router]);

  const upcoming = reminders.filter((r) => new Date(r.start) >= new Date());
  const past = reminders.filter((r) => new Date(r.start) < new Date());
  const hasPast = past.length > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>🔔  Reminders</Text>
        {hasPast && (
          <TouchableOpacity onPress={handleClearPast} style={styles.clearBtn} activeOpacity={0.7}>
            <Text style={[styles.clearBtnText, { color: '#EF4444' }]}>Clear past</Text>
          </TouchableOpacity>
        )}
      </View>

      {reminders.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No reminders</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Open the TV Guide, tap a future programme, and tap "Set Reminder".
          </Text>
        </View>
      ) : (
        <FlatList
          data={reminders}
          keyExtractor={(r) => r.id}
          extraData={nowTs}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 10 }}
          renderItem={({ item }) => (
            <ReminderCard
              reminder={item}
              colors={colors}
              nowTs={nowTs}
              leadMins={reminderLeadMins}
              onDelete={() => handleDelete(item)}
              onReschedule={() => setRescheduleTarget(item)}
              onWatchLive={() => handleWatchLive(item)}
            />
          )}
          ListHeaderComponent={
            upcoming.length > 0 && past.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>UPCOMING</Text>
              </>
            ) : null
          }
        />
      )}

      <RescheduleModal
        reminder={rescheduleTarget}
        colors={colors}
        visible={rescheduleTarget !== null}
        onClose={() => setRescheduleTarget(null)}
        onSelect={handleReschedule}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  clearBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  clearBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 4,
  },
  card: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 12,
    alignItems: 'flex-start',
  },
  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  logoFallback: { fontSize: 22 },
  info: { flex: 1, gap: 2 },
  progTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  chName: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  time: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  badge: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  desc: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 4, lineHeight: 16 },
  leadBadge: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  watchLiveBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  watchLiveBtnText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  watchLiveBtnDisabled: {
    backgroundColor: '#374151',
  },
  watchLiveBtnTextDisabled: {
    color: '#6B7280',
  },
  actions: {
    flexShrink: 0,
    gap: 6,
    alignItems: 'center',
    marginTop: 2,
  },
  actionBtn: {
    width: 28, height: 28, borderRadius: 99,
    borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
  },
  actionBtnText: { fontSize: 11, color: '#9CA3AF' },
  // ── Reschedule modal ──────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalSheet: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  modalDivider: { height: 1 },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalOptionText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  modalOptionCheck: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  modalCancel: {
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  modalCancelText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 40, gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
