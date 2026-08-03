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

/** How many minutes before the programme starts the notification fires. */
const LEAD_MINS = 5;

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
): Promise<string | null> {
  try {
    const triggerMs = new Date(reminder.start).getTime() - LEAD_MINS * 60_000;
    if (triggerMs <= Date.now()) return null;          // already past lead time

    const granted = await requestNotificationPermissions();
    if (!granted) return null;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `📺 Starting in ${LEAD_MINS} mins`,
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

    // Fetch the identifiers of all currently-pending notifications once so we
    // can do O(1) lookups without hitting the native layer per reminder.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const scheduledIds = new Set(scheduled.map((n) => n.identifier));

    for (const reminder of reminders) {
      const triggerMs = new Date(reminder.start).getTime() - LEAD_MINS * 60_000;

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
