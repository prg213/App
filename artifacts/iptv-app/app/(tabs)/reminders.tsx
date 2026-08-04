import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  FlatList,
  Image,
  LayoutAnimation,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useColors } from '@/hooks/useColors';
import { StorageService } from '@/services/storage';
import {
  cancelReminderNotification,
  scheduleReminderNotification,
} from '@/services/notifications';
import { useAppContext } from '@/context/AppContext';
import { getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import { lastNetworkRefreshByCredential, NETWORK_REFRESH_INTERVAL_MS } from '@/services/reminderUrlCache';
import type { Reminder, Channel } from '@/types';
import { SIDEBAR_W } from './_layout';

function credentialSig(c: ReturnType<typeof useAppContext>['credentials']): string {
  // Xtream accounts are identified by host + username.
  // M3U accounts have no host/username — use the playlist URL as the unique key.
  if (c?.type === 'm3u' || (!c?.host && !c?.username && c?.m3uUrl)) {
    return JSON.stringify({ type: 'm3u', m3uUrl: c?.m3uUrl ?? '' });
  }
  return JSON.stringify({ type: 'xtream', host: c?.host ?? '', username: c?.username ?? '' });
}

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
        {/* #119: warn when channel couldn't be resolved after URL backfill */}
        {!isOnAir && !reminder.streamUrl && (
          <Text style={styles.channelWarning}>⚠️ Channel not in current list</Text>
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
  const queryClient = useQueryClient();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const [rescheduleTarget, setRescheduleTarget] = useState<Reminder | null>(null);
  // #100/#114: global lead time, reloaded on every focus
  const [reminderLeadMins, setReminderLeadMins] = useState(5);

  // #135: update the lead-time badge immediately when Settings changes the value,
  // even when the Reminders tab is already visible (e.g. tablet split-view).
  // #145: also reload reminders so each card's reminder.leadMins reflects the
  // value stamped by rescheduleRemindersForLeadTime (storage is already updated
  // by the time this event fires).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('leadtime:changed', () => {
      StorageService.getReminderLeadMins().then(setReminderLeadMins);
      StorageService.getReminders().then((r) => {
        const sorted = [...r].sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
        );
        setReminders(sorted);
      });
    });
    return () => sub.remove();
  }, []);

  // #116: undo banner shown after a deletion
  const [undoBanner, setUndoBanner] = useState<{ reminder: Reminder; timerId: ReturnType<typeof setTimeout> } | null>(null);
  const undoBannerRef = useRef(undoBanner);
  useEffect(() => { undoBannerRef.current = undoBanner; }, [undoBanner]);
  // #121: brief auto-removed notice
  const [autoRemovedCount, setAutoRemovedCount] = useState(0);
  const autoRemovedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #117: dedup prune alert so it only fires once per unique set of removed reminders
  const prunedKeyRef = useRef('');
  useFocusEffect(
    useCallback(() => {
      StorageService.getReminderLeadMins().then(setReminderLeadMins);
    }, []),
  );

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
          ended.forEach((r) => {
            cancelReminderNotification(r.notificationId);
            StorageService.removeReminder(r.id);
          });
          DeviceEventEmitter.emit('reminders:changed');
          // #120: animate cards sliding out
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          // #121: show brief "X reminder(s) ended" notice
          setAutoRemovedCount(ended.length);
          if (autoRemovedTimerRef.current) clearTimeout(autoRemovedTimerRef.current);
          autoRemovedTimerRef.current = setTimeout(() => setAutoRemovedCount(0), 3500);
          return prev.filter((r) => new Date(r.end).getTime() > now);
        });
      }, 30_000);
      return () => clearInterval(id);
    }, []),
  );

  /**
   * Build a channelId → streamUrl map for the CURRENT credentials.
   * Strategy (#105):
   *   1. Merge all React Query 'live-channels' cache entries that belong to the
   *      current credential set — any category key, including per-category keys
   *      written by the Live TV tab — into a single map. This is free (no network
   *      call). Cache entries from other accounts are ignored.
   *   2. If no matching cached channels exist, fall back to a live network fetch
   *      and record the per-credential timestamp so the staleness gate works
   *      correctly after account switches.
   * Returns null when credentials are missing or every path fails.
   */
  const fetchChannelUrlMap = useCallback(
    async (): Promise<{ map: Map<string, string>; fromCache: boolean } | null> => {
      if (!credentials) return null;

      const mySig = credentialSig(credentials);

      // 1. Merge cached live-channels entries that belong to the current account.
      //    Keys have the shape ['live-channels', categoryId, credentialsObject].
      //    We match by comparing a stable credential signature (host + username)
      //    rather than object identity so across-render reference changes still hit.
      const allCachedEntries = queryClient.getQueriesData<Channel[]>({
        queryKey: ['live-channels'],
      });
      const mergedMap = new Map<string, string>();
      for (const [key, channels] of allCachedEntries) {
        if (!channels || channels.length === 0) continue;
        // key = ['live-channels', categoryId, credentials]
        const entryCreds = (key as unknown[])[2];
        if (credentialSig(entryCreds as typeof credentials) !== mySig) continue;
        for (const ch of channels) mergedMap.set(ch.id, ch.streamUrl);
      }
      if (mergedMap.size > 0) {
        return { map: mergedMap, fromCache: true };
      }

      // 2. Cache cold for this account — fetch from the network.
      try {
        let channels: Channel[] = [];
        if (credentials.type === 'xtream') {
          channels = await getXtreamLiveStreams(buildCreds(credentials));
          // Seed the React Query cache so the next Reminders focus (and Live TV /
          // Catch-Up) can read a warm cache without another network round-trip.
          // Key matches the Live TV convention: category = null means "all".
          if (channels.length > 0) {
            queryClient.setQueryData(['live-channels', null, credentials], channels);
          }
        } else if (credentials.m3uUrl) {
          const parsed = await fetchAndParseM3U(credentials.m3uUrl);
          channels = parsed.channels;
          // Seed the React Query cache so the next Reminders focus (and Live TV)
          // can read a warm cache without another network round-trip.
          // Key matches the Xtream/Catch-Up convention: category = null means "all".
          if (channels.length > 0) {
            queryClient.setQueryData(['live-channels', null, credentials], channels);
          }
        }
        const map = new Map<string, string>();
        for (const ch of channels) map.set(ch.id, ch.streamUrl);
        // Record per-credential timestamp so other accounts don't borrow this window.
        lastNetworkRefreshByCredential.set(mySig, Date.now());
        return { map, fromCache: false };
      } catch {
        return null;
      }
    },
    [credentials, queryClient],
  );

  /**
   * #104: Backfill streamUrl for ALL reminders that are missing one
   * (on-air AND upcoming), so Watch Live works as soon as they start.
   * #105: Refresh stored URLs that may have changed on the server
   * (stream IDs rotate when the provider updates or the user switches servers).
   *
   * Cost policy (all scoped to current credentials):
   * - Cache warm (any matching live-channels entry): always refresh all active
   *   reminder URLs at zero network cost.
   * - Cache cold + URLs all present + within NETWORK_REFRESH_INTERVAL_MS for
   *   this credential: skip (URLs are probably still valid).
   * - Cache cold + any URL missing OR per-credential gate has expired: do one
   *   network fetch so rotated IDs are caught even when the user hasn't visited
   *   Live TV or Catch-Up in the current session.
   */
  const backfillStreamUrls = useCallback(
    async (loaded: Reminder[]): Promise<Reminder[]> => {
      const now = Date.now();
      const active = loaded.filter((r) => new Date(r.end).getTime() > now);
      if (active.length === 0) return loaded;

      const mySig = credentialSig(credentials);
      const lastRefresh = lastNetworkRefreshByCredential.get(mySig) ?? 0;
      const gateExpired = now - lastRefresh > NETWORK_REFRESH_INTERVAL_MS;
      const hasMissingUrls = active.some((r) => !r.streamUrl);

      // Peek at the cache — scoped to current credentials.
      const allCachedEntries = queryClient.getQueriesData<Channel[]>({
        queryKey: ['live-channels'],
      });
      const cacheIsWarm = allCachedEntries.some(([key, ch]) => {
        if (!ch || ch.length === 0) return false;
        const entryCreds = (key as unknown[])[2];
        return credentialSig(entryCreds as typeof credentials) === mySig;
      });

      // Skip only when: cache is cold AND all URLs present AND gate hasn't expired.
      if (!cacheIsWarm && !hasMissingUrls && !gateExpired) return loaded;

      const result = await fetchChannelUrlMap();
      if (!result) return loaded;
      const { map: urlMap } = result;

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
    [credentials, fetchChannelUrlMap, queryClient],
  );

  const load = useCallback(() => {
    // #95/#101: prune reminders older than 24 h, then notify if any were removed
    StorageService.pruneExpiredReminders().then((removed) => {
      if (removed.length > 0) {
        // #117: dedup — only show the Alert once per unique batch of pruned reminders
        const key = [...removed].sort().join('\x00');
        if (prunedKeyRef.current !== key) {
          prunedKeyRef.current = key;
          const names = removed.slice(0, 3).join(', ') + (removed.length > 3 ? ` + ${removed.length - 3} more` : '');
          Alert.alert(
            'Reminders Cleared',
            `${removed.length} expired reminder${removed.length > 1 ? 's were' : ' was'} automatically removed:\n${names}`,
            [{ text: 'OK' }],
          );
        }
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

  // #139: if the user navigates away while the undo banner is live, restore the
  // reminder automatically — they can always delete again from the new screen.
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (undoBannerRef.current) {
          clearTimeout(undoBannerRef.current.timerId);
          handleUndo(); // fire-and-forget; restores to storage + reschedules notification
        }
      };
    }, [handleUndo]),
  );

  const handleDelete = useCallback((reminder: Reminder) => {
    // #116: commit deletion immediately, show 5-second undo banner instead of Alert dialog
    if (undoBannerRef.current) {
      clearTimeout(undoBannerRef.current.timerId);
      setUndoBanner(null);
    }
    // Optimistically remove from local state with animation (#120)
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReminders((prev) => prev.filter((r) => r.id !== reminder.id));
    cancelReminderNotification(reminder.notificationId);
    StorageService.removeReminder(reminder.id);
    DeviceEventEmitter.emit('reminders:changed');
    const timerId = setTimeout(() => setUndoBanner(null), 5000);
    setUndoBanner({ reminder, timerId });
  }, []);

  const handleUndo = useCallback(async () => {
    const banner = undoBannerRef.current;
    if (!banner) return;
    clearTimeout(banner.timerId);
    setUndoBanner(null);
    // Re-persist and re-schedule the deleted reminder
    await StorageService.addReminder(banner.reminder);
    const lead = banner.reminder.leadMins ?? reminderLeadMins;
    await scheduleReminderNotification(banner.reminder, lead);
    DeviceEventEmitter.emit('reminders:changed');
    load();
  }, [reminderLeadMins, load]);

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
        // #131: pass channelId so the player can re-resolve a stale stream URL
        // from the current channel list before surfacing an error screen.
        channelId: reminder.channelId,
        channelsJson: '[]',
        channelIndex: '-1',
      },
    });
  }, [router]);

  // #118: use nowTs so cards move between sections when the 30 s ticker fires
  const upcoming = reminders.filter((r) => new Date(r.start).getTime() > nowTs);
  const onAirReminders = reminders.filter((r) => new Date(r.start).getTime() <= nowTs && new Date(r.end).getTime() > nowTs);
  const pastReminders = reminders.filter((r) => new Date(r.end).getTime() <= nowTs);
  const hasPast = pastReminders.length > 0;

  // Build a flat list with injected section-header rows
  type FlatItem = { kind: 'divider'; label: string } | { kind: 'reminder'; item: Reminder };
  const flatItems: FlatItem[] = [];
  const hasMultipleSections =
    (onAirReminders.length > 0 && (upcoming.length > 0 || pastReminders.length > 0)) ||
    (upcoming.length > 0 && pastReminders.length > 0);
  if (onAirReminders.length > 0) {
    if (hasMultipleSections) flatItems.push({ kind: 'divider', label: 'ON NOW' });
    onAirReminders.forEach((r) => flatItems.push({ kind: 'reminder', item: r }));
  }
  if (upcoming.length > 0) {
    if (hasMultipleSections) flatItems.push({ kind: 'divider', label: 'UPCOMING' });
    upcoming.forEach((r) => flatItems.push({ kind: 'reminder', item: r }));
  }
  if (pastReminders.length > 0) {
    flatItems.push({ kind: 'divider', label: 'PAST' });
    pastReminders.forEach((r) => flatItems.push({ kind: 'reminder', item: r }));
  }

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
          data={flatItems}
          keyExtractor={(item) => item.kind === 'divider' ? `hdr-${item.label}` : item.item.id}
          extraData={nowTs}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />
          }
          renderItem={({ item }) => {
            if (item.kind === 'divider') {
              return (
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                  {item.label}
                </Text>
              );
            }
            return (
              <ReminderCard
                reminder={item.item}
                colors={colors}
                nowTs={nowTs}
                leadMins={reminderLeadMins}
                onDelete={() => handleDelete(item.item)}
                onReschedule={() => setRescheduleTarget(item.item)}
                onWatchLive={() => handleWatchLive(item.item)}
              />
            );
          }}
        />
      )}

      {/* #121: brief notice when the ticker auto-removes ended reminders */}
      {autoRemovedCount > 0 && (
        <View style={[styles.autoRemovedBanner, { backgroundColor: 'rgba(59,130,246,0.10)', borderColor: 'rgba(59,130,246,0.25)' }]}>
          <Text style={[styles.autoRemovedText, { color: '#3B82F6' }]}>
            ⏰ {autoRemovedCount} reminder{autoRemovedCount > 1 ? 's' : ''} ended
          </Text>
        </View>
      )}

      {/* #116: undo banner shown for 5 s after a deletion */}
      {undoBanner && (
        <View style={[styles.undoBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.undoText, { color: colors.foreground }]}>Reminder removed</Text>
          <TouchableOpacity onPress={handleUndo} style={styles.undoBtn} activeOpacity={0.8}>
            <Text style={styles.undoBtnText}>UNDO</Text>
          </TouchableOpacity>
        </View>
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
  channelWarning: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#F59E0B', marginTop: 3 },
  // ── Undo banner (#116) ────────────────────────────────────────────────────
  undoBanner: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  undoText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  undoBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  undoBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  // ── Auto-removed notice (#121) ────────────────────────────────────────────
  autoRemovedBanner: {
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  autoRemovedText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
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
