/**
 * Core reschedule logic for programme reminders.
 *
 * Extracted from handleLeadTimeSelect so it can be unit-tested independently
 * of the Settings screen component.
 */

import {
  scheduleReminderNotification,
  cancelReminderNotification,
} from '@/services/notifications';
import { StorageService } from '@/services/storage';

/**
 * Re-schedules all future reminders using the currently-stored lead time.
 *
 * - Reminders whose start time is already in the past are left untouched.
 * - Each future reminder gets its old notification cancelled and a fresh one
 *   scheduled.  The new notificationId (or undefined when the start is too
 *   soon for the lead time to fire) is persisted back to AsyncStorage.
 *
 * @returns `tooSoon` — the number of future reminders whose start time is
 *   within the new lead time window and therefore could not be rescheduled.
 */
export async function rescheduleRemindersForLeadTime(): Promise<{ tooSoon: number }> {
  const all = await StorageService.getReminders();
  const now = Date.now();
  const upcoming = all.filter((r) => new Date(r.start).getTime() > now);
  if (upcoming.length === 0) return { tooSoon: 0 };

  // Read the current global lead-time preference so we can stamp it on every
  // rescheduled reminder.  This keeps reminder.leadMins in sync with the
  // global setting so the badge on reminder cards shows the correct value
  // even before the Reminders screen regains focus.
  const newLeadMins = await StorageService.getReminderLeadMins();

  let tooSoon = 0;
  const updated = await Promise.all(
    upcoming.map(async (r) => {
      await cancelReminderNotification(r.notificationId);
      const newId = (await scheduleReminderNotification(r)) ?? undefined;
      if (!newId) tooSoon++;
      return { ...r, notificationId: newId, leadMins: newLeadMins };
    }),
  );

  await StorageService.saveReminders([
    ...all.filter((r) => new Date(r.start).getTime() <= now),
    ...updated,
  ]);

  return { tooSoon };
}
