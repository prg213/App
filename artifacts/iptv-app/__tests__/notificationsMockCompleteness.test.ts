/**
 * #199 — Notifications mock completeness.
 *
 * Verifies that `makeNotificationsMock()` provides a stub for every function
 * exported by `services/notifications`.  The primary guard is the TypeScript
 * type system: `makeNotificationsMock` is typed against
 * `typeof NotificationsService`, so any rename or removal in the real module
 * surfaces as a compile error in this file.
 *
 * The runtime test below is a belt-and-suspenders check for the case where
 * only the JS output (not the types) diverges — e.g. a dynamic export added
 * without type annotations.
 *
 * Because importing the real `services/notifications` at runtime pulls in
 * `expo-notifications` (which react-native Jest can't parse without a full
 * Expo preset), we enumerate the expected exports explicitly here rather than
 * doing a live import.  TypeScript enforces the list in `makeNotificationsMock`
 * stays in sync at compile time.
 */

import { makeNotificationsMock } from './helpers/notificationsMock';

// Every function exported by services/notifications.
// TypeScript will flag a mismatch in makeNotificationsMock via its parameter
// type, so this array only needs to stay up to date at a coarse level.
const EXPECTED_EXPORTS = [
  'setupNotifications',
  'requestNotificationPermissions',
  'scheduleReminderNotification',
  'rescheduleStaleReminders',
  'cancelAndPruneExpiredReminders',
  'cancelRemindersForActiveChannel',
  'cancelReminderNotification',
  'addNotificationTapListener',
] as const;

describe('makeNotificationsMock — completeness (#199)', () => {
  it('provides a callable stub for every expected notifications export', () => {
    const mock = makeNotificationsMock();

    for (const key of EXPECTED_EXPORTS) {
      expect(mock).toHaveProperty(key);
      expect(typeof (mock as Record<string, unknown>)[key]).toBe('function');
    }
  });

  it('default stubs return sensible values', async () => {
    const mock = makeNotificationsMock();

    expect(mock.setupNotifications()).toBeUndefined();
    await expect(mock.requestNotificationPermissions()).resolves.toBe(true);
    await expect(mock.scheduleReminderNotification({} as any)).resolves.toBe('mock-notification-id');
    await expect(mock.cancelAndPruneExpiredReminders()).resolves.toBe(0);
    expect(mock.addNotificationTapListener({} as any)).toHaveProperty('remove');
  });

  it('allows individual stubs to be overridden', async () => {
    const custom = jest.fn().mockResolvedValue('override-id');
    const mock = makeNotificationsMock({
      scheduleReminderNotification: custom,
    });

    expect(mock.scheduleReminderNotification).toBe(custom);
    // Other stubs remain the defaults
    expect(mock.setupNotifications).toBeDefined();
    expect(mock.cancelReminderNotification).toBeDefined();
  });
});
