/**
 * Unit tests for rescheduleRemindersForLeadTime.
 *
 * Covers the reschedule path invoked when the user changes their reminder
 * lead time in Settings:
 *   - All future reminders receive a new notificationId
 *   - Past-start reminders are left completely untouched in storage
 *   - Reminders whose start falls within the new lead window (scheduleReminderNotification
 *     returns null) are counted in `tooSoon`
 *   - Edge cases: zero upcoming reminders, all reminders too soon, mixed list
 */

import { rescheduleRemindersForLeadTime } from '../services/reminderReschedule';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// The `satisfies` annotation makes TypeScript verify that every key in this
// object actually exists on the real StorageService — if a method is renamed
// or removed the compiler will flag the stale mock key immediately.
jest.mock('../services/storage', () => ({
  StorageService: {
    getReminders: jest.fn(),
    saveReminders: jest.fn(),
    getReminderLeadMins: jest.fn(async () => 5),
  } satisfies Partial<typeof import('../services/storage').StorageService>,
}));

// #199: satisfies ensures TypeScript validates that every mocked key actually
// exists on the real module — if a function is renamed or removed, the compiler
// will flag the stale mock key immediately.
jest.mock('../services/notifications', () => ({
  scheduleReminderNotification: jest.fn(),
  cancelReminderNotification: jest.fn(),
} satisfies Partial<typeof import('../services/notifications')>));

// Suppress warnings from the notification service during tests
jest.spyOn(console, 'warn').mockImplementation(() => {});

import { StorageService } from '../services/storage';
import {
  scheduleReminderNotification,
  cancelReminderNotification,
} from '../services/notifications';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NOW = new Date('2024-06-01T12:00:00Z').getTime();

/** Build a minimal Reminder fixture. */
function makeReminder(
  id: string,
  startOffsetMs: number,
  notificationId = `notif-${id}`,
) {
  const start = new Date(NOW + startOffsetMs).toISOString();
  const end   = new Date(NOW + startOffsetMs + 30 * 60_000).toISOString();
  return {
    id,
    channelId: `ch-${id}`,
    channelName: `Channel ${id}`,
    programTitle: `Programme ${id}`,
    start,
    end,
    createdAt: new Date(NOW - 60_000).toISOString(),
    notificationId,
  };
}

const getReminders      = StorageService.getReminders      as jest.MockedFunction<typeof StorageService.getReminders>;
const saveReminders     = StorageService.saveReminders     as jest.MockedFunction<typeof StorageService.saveReminders>;
const schedule          = scheduleReminderNotification      as jest.MockedFunction<typeof scheduleReminderNotification>;
const cancel            = cancelReminderNotification        as jest.MockedFunction<typeof cancelReminderNotification>;

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Freeze time so all "is it in the future?" checks use the same reference.
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  saveReminders.mockResolvedValue(undefined);
  cancel.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('rescheduleRemindersForLeadTime', () => {
  test('returns tooSoon:0 and skips storage write when there are no reminders', async () => {
    getReminders.mockResolvedValue([]);

    const result = await rescheduleRemindersForLeadTime();

    expect(result.tooSoon).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(saveReminders).not.toHaveBeenCalled();
  });

  test('returns tooSoon:0 and skips storage write when all reminders are in the past', async () => {
    const past = [
      makeReminder('past1', -60 * 60_000),  // started 1 h ago
      makeReminder('past2', -30 * 60_000),  // started 30 min ago
    ];
    getReminders.mockResolvedValue(past);

    const result = await rescheduleRemindersForLeadTime();

    expect(result.tooSoon).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(saveReminders).not.toHaveBeenCalled();
  });

  test('cancels old notifications and assigns new IDs for all future reminders', async () => {
    const future1 = makeReminder('f1', 60 * 60_000, 'old-id-1');
    const future2 = makeReminder('f2', 90 * 60_000, 'old-id-2');
    getReminders.mockResolvedValue([future1, future2]);
    schedule
      .mockResolvedValueOnce('new-id-1')
      .mockResolvedValueOnce('new-id-2');

    const result = await rescheduleRemindersForLeadTime();

    // Both old notifications must be cancelled
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledWith('old-id-1');
    expect(cancel).toHaveBeenCalledWith('old-id-2');

    // Both reminders must be rescheduled
    expect(schedule).toHaveBeenCalledTimes(2);

    // tooSoon must be 0 — both rescheduled successfully
    expect(result.tooSoon).toBe(0);

    // saveReminders should persist the updated notificationIds
    expect(saveReminders).toHaveBeenCalledTimes(1);
    const saved = saveReminders.mock.calls[0][0];
    expect(saved).toHaveLength(2);
    expect(saved.find((r: any) => r.id === 'f1')?.notificationId).toBe('new-id-1');
    expect(saved.find((r: any) => r.id === 'f2')?.notificationId).toBe('new-id-2');
  });

  test('counts reminders in the lead window (schedule returns null) as tooSoon', async () => {
    const tooSoonReminder = makeReminder('ts1', 2 * 60_000, 'old-ts1');  // starts in 2 min
    const okReminder      = makeReminder('ok1', 30 * 60_000, 'old-ok1'); // starts in 30 min
    getReminders.mockResolvedValue([tooSoonReminder, okReminder]);
    // First reminder is too soon — schedule returns null; second succeeds
    schedule
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('new-ok1');

    const result = await rescheduleRemindersForLeadTime();

    expect(result.tooSoon).toBe(1);
    // The too-soon reminder should have notificationId: undefined in storage
    const saved = saveReminders.mock.calls[0][0];
    expect(saved.find((r: any) => r.id === 'ts1')?.notificationId).toBeUndefined();
    expect(saved.find((r: any) => r.id === 'ok1')?.notificationId).toBe('new-ok1');
  });

  test('counts all reminders as tooSoon when schedule always returns null', async () => {
    const r1 = makeReminder('a', 1 * 60_000, 'old-a');
    const r2 = makeReminder('b', 2 * 60_000, 'old-b');
    getReminders.mockResolvedValue([r1, r2]);
    schedule.mockResolvedValue(null);

    const result = await rescheduleRemindersForLeadTime();

    expect(result.tooSoon).toBe(2);
  });

  test('preserves past reminders unchanged in the saved list (mixed list)', async () => {
    const past   = makeReminder('past', -60 * 60_000, 'old-past');
    const future = makeReminder('fut',   60 * 60_000, 'old-fut');
    getReminders.mockResolvedValue([past, future]);
    schedule.mockResolvedValueOnce('new-fut');

    await rescheduleRemindersForLeadTime();

    const saved = saveReminders.mock.calls[0][0];

    // Past reminder must appear unchanged
    const savedPast = saved.find((r: any) => r.id === 'past');
    expect(savedPast).toBeDefined();
    expect(savedPast!.notificationId).toBe('old-past');

    // Future reminder must have the new ID
    const savedFuture = saved.find((r: any) => r.id === 'fut');
    expect(savedFuture).toBeDefined();
    expect(savedFuture!.notificationId).toBe('new-fut');

    // cancel should only have been called for the future reminder
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith('old-fut');
  });

  test('handles reminders with no existing notificationId gracefully', async () => {
    const noId = { ...makeReminder('noid', 60 * 60_000), notificationId: undefined };
    getReminders.mockResolvedValue([noId]);
    schedule.mockResolvedValueOnce('brand-new-id');

    const result = await rescheduleRemindersForLeadTime();

    // cancel should still be called (it's a no-op for undefined inside the service)
    expect(cancel).toHaveBeenCalledWith(undefined);
    expect(result.tooSoon).toBe(0);

    const saved = saveReminders.mock.calls[0][0];
    expect(saved[0].notificationId).toBe('brand-new-id');
  });

  test('single future reminder is rescheduled and persisted', async () => {
    const r = makeReminder('single', 120 * 60_000, 'old-single');
    getReminders.mockResolvedValue([r]);
    schedule.mockResolvedValueOnce('new-single');

    const result = await rescheduleRemindersForLeadTime();

    expect(result.tooSoon).toBe(0);
    expect(cancel).toHaveBeenCalledWith('old-single');
    expect(saveReminders).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'single', notificationId: 'new-single' }),
    ]);
  });
});
