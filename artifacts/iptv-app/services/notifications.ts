/**
 * Local notification helpers for programme reminders.
 *
 * Expo Go on Android supports local notifications fully.
 * On iOS you need a built app (push entitlement) — the code is safe to call
 * but will silently no-op in Expo Go on iOS.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Reminder } from '@/types';
import { StorageService } from '@/services/storage';

/** Default lead time (minutes) before the programme starts the notification fires. */
const DEFAULT_LEAD_MINS = 5;

// ─── One-time setup ──────────────────────────────────────────────────────────

/**
 * Configure the foreground notification handler (shows banner + sound while
 * the app is open) and the Android default channel.  Call once at app start.
 */
export function setupNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('reminders', {
      name: 'Programme Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

// ─── Permissions ─────────────────────────────────────────────────────────────

/**
 * Request notification permissions.  Resolves to true if granted, false
 * otherwise.  Safe to call multiple times — won't re-prompt if already
 * granted/denied.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ─── Schedule / cancel ───────────────────────────────────────────────────────

/**
 * Schedule a local notification LEAD_MINS before the reminder's programme
 * start.  Returns the Expo notification identifier (store this on the
 * Reminder so it can be cancelled later), or null if the start time is
 * already too close / in the past, or if permissions weren't granted.
 */
export async function scheduleReminderNotification(
  reminder: Reminder,
  overrideLeadMins?: number,
): Promise<string | null> {
  try {
    const leadMins = overrideLeadMins ?? await StorageService.getReminderLeadMins();
    const triggerMs = new Date(reminder.start).getTime() - leadMins * 60_000;
    if (triggerMs <= Date.now()) return null;          // already past lead time

    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `📺 Starting in ${leadMins} min${leadMins === 1 ? '' : 's'}`,
        body: `${reminder.programTitle} on ${reminder.channelName}`,
        data: {
          reminderId: reminder.id,
          channelId: reminder.channelId,
          start: reminder.start,
        },
        sound: 'default',
        ...(Platform.OS === 'android' && { channelId: 'reminders' }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(triggerMs),
      },
    });

    return id;
  } catch (err) {
    console.warn('[notifications] scheduleReminderNotification failed', err);
    return null;
  }
}

/**
 * On app start, compare stored reminders that have a future trigger time
 * against the set of currently-scheduled Expo notifications.  Any reminder
 * whose notification is missing (e.g. because Android cancelled all alarms
 * after a device reboot) is rescheduled and its notificationId updated in
 * AsyncStorage.
 *
 * Safe to call multiple times — reminders that are already scheduled are
 * left untouched.
 */
export async function rescheduleStaleReminders(): Promise<void> {
  try {
    const reminders = await StorageService.getReminders();
    if (reminders.length === 0) return;

    const now = Date.now();
    const leadMins = await StorageService.getReminderLeadMins();

    // Fetch the identifiers of all currently-pending notifications once so we
    // can do O(1) lookups without hitting the native layer per reminder.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const scheduledIds = new Set(scheduled.map((n) => n.identifier));

    for (const reminder of reminders) {
      const triggerMs = new Date(reminder.start).getTime() - leadMins * 60_000;

      // Skip reminders whose lead time has already passed — they can't fire.
      if (triggerMs <= now) continue;

      // If the stored notificationId is still in the scheduled set, nothing to do.
      if (reminder.notificationId && scheduledIds.has(reminder.notificationId)) continue;

      // Notification is missing (lost after reboot, or never stored) — reschedule.
      const newId = await scheduleReminderNotification(reminder);
      if (newId) {
        // Persist the new notificationId back to AsyncStorage.
        await StorageService.addReminder({ ...reminder, notificationId: newId });
      }
    }
  } catch (err) {
    console.warn('[notifications] rescheduleStaleReminders failed', err);
  }
}

/**
 * On app start, cancel any pending notification for reminders whose programme
 * has already ended OR that the user already watched (detected via the
 * recently-watched channel list), then remove those reminders from AsyncStorage.
 *
 * Handles two cases:
 *   1. Device clock drift / long app-closed period — programme end has passed.
 *   2. User tuned to the channel during the programme window before the
 *      notification had a chance to fire.
 *
 * Returns the number of reminders removed because their programme already ended
 * (case 1 only) so the caller can notify the user if needed.
 *
 * Safe to call multiple times.
 */
export async function cancelAndPruneExpiredReminders(): Promise<number> {
  try {
    const reminders = await StorageService.getReminders();
    if (reminders.length === 0) return 0;

    const now = Date.now();

    // Build a quick-lookup map of recently-watched channel timestamps so we
    // can check O(1) per reminder whether the user tuned in during the window.
    const recentChannels = await StorageService.getRecentChannels();
    // Map channelId → watchedAt (Unix ms) for all recently-watched channels
    const recentWatchedAt = new Map<string, number>();
    for (const ch of recentChannels) {
      if (ch.id) recentWatchedAt.set(ch.id, ch.watchedAt);
    }

    // Track how many are pruned because the programme ended (not user-watched).
    let expiredCount = 0;

    const toPrune = reminders.filter((r) => {
      const startMs = new Date(r.start).getTime();
      const endMs   = new Date(r.end).getTime();

      // Case 1: programme has already ended.
      if (endMs <= now) {
        expiredCount++;
        return true;
      }

      // Case 2: user watched this channel during the programme's time window.
      const watchedAt = recentWatchedAt.get(r.channelId);
      if (watchedAt !== undefined && watchedAt >= startMs && watchedAt <= endMs) return true;

      return false;
    });

    if (toPrune.length === 0) return 0;

    // Cancel any lingering scheduled notifications, then remove from storage.
    await Promise.all(toPrune.map((r) => cancelReminderNotification(r.notificationId)));
    for (const r of toPrune) {
      await StorageService.removeReminder(r.id);
    }

    return expiredCount;
  } catch (err) {
    console.warn('[notifications] cancelAndPruneExpiredReminders failed', err);
    return 0;
  }
}

/**
 * When the user opens a live channel in the player, cancel and remove any
 * reminder for a programme currently airing on that channel.  This prevents
 * a "Starting soon" notification from firing for a programme the user is
 * already watching.
 *
 * Accepts both the raw channel ID (stored on the Reminder) and the EPG ID
 * (which may differ on some providers) so reminders are found regardless of
 * which identifier the player exposes.  Safe to call with all-undefined args
 * (no-op).
 */
export async function cancelRemindersForActiveChannel(opts: {
  channelId?: string | null;
  epgId?: string | null;
}): Promise<void> {
  const { channelId, epgId } = opts;
  if (!channelId && !epgId) return;
  try {
    const reminders = await StorageService.getReminders();
    const now = Date.now();

    // Build a set of identifiers to match against for O(1) lookups.
    const ids = new Set<string>();
    if (channelId) ids.add(channelId);
    if (epgId) ids.add(epgId);

    // Match reminders for this channel whose programme window overlaps now —
    // i.e. the user is watching the programme the reminder was set for.
    const active = reminders.filter((r) => {
      if (!ids.has(r.channelId)) return false;
      const startMs = new Date(r.start).getTime();
      const endMs   = new Date(r.end).getTime();
      // Programme is currently airing (or just ended — belt-and-suspenders)
      return now >= startMs && now <= endMs + 60_000; // 1-min grace window
    });

    if (active.length === 0) return;

    await Promise.all(active.map((r) => cancelReminderNotification(r.notificationId)));
    for (const r of active) {
      await StorageService.removeReminder(r.id);
    }
  } catch (err) {
    console.warn('[notifications] cancelRemindersForActiveChannel failed', err);
  }
}

/**
 * Cancel a previously scheduled notification.  Safe to call with a null /
 * undefined id (no-op).
 */
export async function cancelReminderNotification(
  notificationId: string | null | undefined,
): Promise<void> {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // notification may have already fired — ignore
  }
}

// ─── Tap listener ────────────────────────────────────────────────────────────

/**
 * Subscribe to notification-response events (user taps a notification).
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function addNotificationTapListener(
  handler: (data: { channelId?: string; start?: string }) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as {
      channelId?: string;
      start?: string;
      reminderId?: string;
    };
    handler({ channelId: data?.channelId, start: data?.start });
  });
  return () => sub.remove();
}
