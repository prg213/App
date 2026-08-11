/**
 * Type-safe notifications service mock factory.
 *
 * Builds a fully-stubbed jest mock where every exported function from
 * `services/notifications` defaults to a no-op that resolves to a sensible
 * empty value.  Pass `overrides` to replace only the functions a specific
 * test cares about.
 *
 * TypeScript enforces that every key in `overrides` matches a real export
 * from `services/notifications`, so a rename or removal in the real module
 * will surface as a compile error in any test using this helper.
 *
 * Usage in a test file:
 *
 *   import { makeNotificationsMock } from './helpers/notificationsMock';
 *
 *   jest.mock('../services/notifications', () => makeNotificationsMock({
 *     scheduleReminderNotification: jest.fn().mockResolvedValue('test-id'),
 *   }));
 */

import type * as NotificationsService from '../../services/notifications';

type NotificationsShape = typeof NotificationsService;

/**
 * Returns a jest.Mocked version of the notifications service.
 * Every function defaults to a harmless stub; pass overrides to customise.
 */
export function makeNotificationsMock(
  overrides: Partial<NotificationsShape> = {},
): jest.Mocked<NotificationsShape> {
  const base: jest.Mocked<NotificationsShape> = {
    setupNotifications:               jest.fn(),
    requestNotificationPermissions:   jest.fn().mockResolvedValue(true),
    scheduleReminderNotification:     jest.fn().mockResolvedValue('mock-notification-id'),
    rescheduleStaleReminders:         jest.fn().mockResolvedValue(undefined),
    cancelAndPruneExpiredReminders:   jest.fn().mockResolvedValue(0),
    cancelRemindersForActiveChannel:  jest.fn().mockResolvedValue(undefined),
    cancelReminderNotification:       jest.fn().mockResolvedValue(undefined),
    addNotificationTapListener:       jest.fn().mockReturnValue({ remove: jest.fn() }),
  };

  return { ...base, ...overrides } as jest.Mocked<NotificationsShape>;
}
