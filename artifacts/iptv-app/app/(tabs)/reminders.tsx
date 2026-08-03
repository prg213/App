import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
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
import { cancelReminderNotification } from '@/services/notifications';
import type { Reminder } from '@/types';
import { SIDEBAR_W } from './_layout';

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

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Starting now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `in ${hrs}h ${rem}m` : `in ${hrs}h`;
}

function ReminderCard({
  reminder,
  colors,
  onDelete,
  onWatchLive,
}: {
  reminder: Reminder;
  colors: any;
  onDelete: () => void;
  onWatchLive?: () => void;
}) {
  const now = Date.now();
  const startMs = new Date(reminder.start).getTime();
  const endMs = new Date(reminder.end).getTime();
  const isPast = startMs < now;
  const isOnAir = startMs <= now && now < endMs && !!reminder.streamUrl;

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
            <Text style={[styles.badge, { color: '#22C55E' }]}>  {timeUntil(reminder.start)}</Text>
          )}
          {isPast && !isOnAir && <Text style={{ color: '#EF4444' }}>  Past</Text>}
          {isOnAir && <Text style={{ color: '#3B82F6' }}>  On now</Text>}
        </Text>
        {reminder.programDescription ? (
          <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={2}>
            {reminder.programDescription}
          </Text>
        ) : null}

        {/* Watch Live button — only shown when programme is currently airing */}
        {isOnAir && onWatchLive && (
          <TouchableOpacity
            style={styles.watchLiveBtn}
            onPress={onWatchLive}
            activeOpacity={0.8}
          >
            <Text style={styles.watchLiveBtnText}>▶  Watch Live</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Right: delete button */}
      <TouchableOpacity
        style={[styles.deleteBtn, { borderColor: colors.border }]}
        onPress={onDelete}
        activeOpacity={0.7}
      >
        <Text style={styles.deleteBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function RemindersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const load = useCallback(() => {
    StorageService.getReminders().then((r) => {
      // Sort: upcoming first, then past
      const sorted = [...r].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
      );
      setReminders(sorted);
    });
  }, []);

  useFocusEffect(load);

  const handleDelete = (reminder: Reminder) => {
    Alert.alert('Remove Reminder', 'Remove this reminder?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await cancelReminderNotification(reminder.notificationId);
          await StorageService.removeReminder(reminder.id);
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
          load();
        },
      },
    ]);
  };

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
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 10 }}
          renderItem={({ item }) => (
            <ReminderCard
              reminder={item}
              colors={colors}
              onDelete={() => handleDelete(item)}
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
  deleteBtn: {
    width: 28, height: 28, borderRadius: 99,
    borderWidth: 1,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0, marginTop: 2,
  },
  deleteBtnText: { fontSize: 11, color: '#9CA3AF' },
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    padding: 40, gap: 12,
  },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
});
