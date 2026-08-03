/**
 * Module-level cache: credential-signature → last successful network
 * channel-list fetch timestamp.  Lives here (not in reminders.tsx) so both
 * the Reminders screen and the Settings logout handler can import it without
 * creating a circular dependency.
 */
export const lastNetworkRefreshByCredential = new Map<string, number>();
export const NETWORK_REFRESH_INTERVAL_MS = 15 * 60_000; // 15 minutes

/** #126: call on logout so the next account always gets a fresh URL check. */
export function clearReminderRefreshCache(): void {
  lastNetworkRefreshByCredential.clear();
}
