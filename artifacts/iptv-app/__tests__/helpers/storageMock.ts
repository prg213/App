/**
 * Type-safe StorageService mock factory.
 *
 * Builds a fully-stubbed jest mock where every method defaults to a no-op
 * that resolves to a sensible empty value.  Pass `overrides` to replace only
 * the methods a specific test cares about.
 *
 * TypeScript enforces that every key in `overrides` exists on the real
 * StorageService — so if a method is renamed or removed the compiler will
 * flag the stale override immediately.
 *
 * Usage in a test file:
 *
 *   import { makeStorageMock } from './helpers/storageMock';
 *
 *   jest.mock('../services/storage', () => ({
 *     StorageService: makeStorageMock({
 *       getReminders: jest.fn().mockResolvedValue([]),
 *     }),
 *   }));
 *
 * Or, when you only need a single method and want a minimal inline mock, add
 * `satisfies Partial<typeof import('../services/storage').StorageService>` to
 * the mock object so TypeScript validates the keys without importing this
 * helper.
 */

import type { StorageService as _StorageService } from '../../services/storage';

type StorageServiceShape = typeof _StorageService;

/**
 * Builds a jest.Mocked<StorageService> with safe default stubs for every
 * method, merged with the caller-supplied overrides.
 *
 * The `overrides` parameter is typed as `Partial<StorageServiceShape>`, which
 * means TypeScript will error if a caller supplies a key that does not exist
 * on the real StorageService — making the mock self-validating against the
 * live interface.
 */
export function makeStorageMock(
  overrides: Partial<StorageServiceShape> = {},
): jest.Mocked<StorageServiceShape> {
  // `satisfies` (TS 4.9+) gives a precise "Property X is missing" error at the
  // declaration site rather than a generic assignability error at the return.
  // The explicit `: jest.Mocked<StorageServiceShape>` annotation is kept too so
  // that the inferred type of `base` stays narrowed for `{ ...base, ...overrides }`.
  const base = {
    // ── Credentials ──────────────────────────────────────────────────────────
    saveCredentials:           jest.fn().mockResolvedValue(undefined),
    getCredentials:            jest.fn().mockResolvedValue(null),
    clearCredentials:          jest.fn().mockResolvedValue(undefined),

    // ── PIN ──────────────────────────────────────────────────────────────────
    setPin:                    jest.fn().mockResolvedValue(undefined),
    getPin:                    jest.fn().mockResolvedValue(null),
    clearPin:                  jest.fn().mockResolvedValue(undefined),
    verifyPin:                 jest.fn().mockResolvedValue(false),

    // ── Parental ─────────────────────────────────────────────────────────────
    getParentalSettings:       jest.fn().mockResolvedValue({
      maxRating: 'all',
      lockEnabled: false,
      blockedChannels: [],
      blockedCategories: [],
    }),
    saveParentalSettings:      jest.fn().mockResolvedValue(undefined),

    // ── Channel favourites ────────────────────────────────────────────────────
    getFavorites:              jest.fn().mockResolvedValue([]),
    saveFavorites:             jest.fn().mockResolvedValue(undefined),
    toggleFavorite:            jest.fn().mockResolvedValue([]),

    // ── Movie favourites ──────────────────────────────────────────────────────
    getMovieFavorites:         jest.fn().mockResolvedValue([]),
    saveMovieFavorites:        jest.fn().mockResolvedValue(undefined),
    toggleMovieFavorite:       jest.fn().mockResolvedValue([]),
    moveMovieToTop:            jest.fn().mockResolvedValue(null),

    // ── Series favourites ─────────────────────────────────────────────────────
    getSeriesFavorites:        jest.fn().mockResolvedValue([]),
    saveSeriesFavorites:       jest.fn().mockResolvedValue(undefined),
    toggleSeriesFavorite:      jest.fn().mockResolvedValue([]),
    moveSeriesToTop:           jest.fn().mockResolvedValue(null),

    // ── Watch history ─────────────────────────────────────────────────────────
    getWatchHistory:              jest.fn().mockResolvedValue([]),
    addToHistory:                 jest.fn().mockResolvedValue(undefined),
    removeFromHistory:            jest.fn().mockResolvedValue(undefined),
    removeSeriesFromHistory:      jest.fn().mockResolvedValue(undefined),
    clearHistory:                 jest.fn().mockResolvedValue(undefined),

    // ── Recent channels ───────────────────────────────────────────────────────
    getRecentChannels:         jest.fn().mockResolvedValue([]),
    addRecentChannel:          jest.fn().mockResolvedValue(undefined),
    removeFromRecentChannels:  jest.fn().mockResolvedValue(undefined),
    clearRecentChannels:       jest.fn().mockResolvedValue(undefined),

    // ── Reminders ─────────────────────────────────────────────────────────────
    getReminders:              jest.fn().mockResolvedValue([]),
    addReminder:               jest.fn().mockResolvedValue(undefined),
    saveReminders:             jest.fn().mockResolvedValue(undefined),
    removeReminder:            jest.fn().mockResolvedValue(undefined),
    updateReminder:            jest.fn().mockResolvedValue(undefined),
    hasReminder:               jest.fn().mockResolvedValue(false),
    pruneExpiredReminders:     jest.fn().mockResolvedValue([]),
    getReminderNotificationId: jest.fn().mockResolvedValue(null),

    // ── Preferences ───────────────────────────────────────────────────────────
    getPrefAudioLanguage:      jest.fn().mockResolvedValue(null),
    setPrefAudioLanguage:      jest.fn().mockResolvedValue(undefined),
    clearPrefAudioLanguage:    jest.fn().mockResolvedValue(undefined),

    getPrefSubtitleLang:       jest.fn().mockResolvedValue(null),
    setPrefSubtitleLang:       jest.fn().mockResolvedValue(undefined),
    clearPrefSubtitleLang:     jest.fn().mockResolvedValue(undefined),

    getReminderLeadMins:       jest.fn().mockResolvedValue(5),
    setReminderLeadMins:       jest.fn().mockResolvedValue(undefined),

    getPrefSearchType:         jest.fn().mockResolvedValue('all' as const),
    setPrefSearchType:         jest.fn().mockResolvedValue(undefined),

    getPrefSearchQuery:        jest.fn().mockResolvedValue(''),
    setPrefSearchQuery:        jest.fn().mockResolvedValue(undefined),

    // ── Pending remote-fav push queue (#21) ──────────────────────────────────
    getPendingMoviesPush:      jest.fn().mockResolvedValue(null),
    setPendingMoviesPush:      jest.fn().mockResolvedValue(undefined),
    getPendingSeriesPush:      jest.fn().mockResolvedValue(null),
    setPendingSeriesPush:      jest.fn().mockResolvedValue(undefined),

    // ── Persisted MAC failure count (#267) ───────────────────────────────────
    getStartupFailCount:       jest.fn().mockResolvedValue(0),
    saveStartupFailCount:      jest.fn().mockResolvedValue(undefined),
    clearStartupFailCount:     jest.fn().mockResolvedValue(undefined),

    // ── Logout reason ─────────────────────────────────────────────────────────
    saveLogoutReason:          jest.fn().mockResolvedValue(undefined),
    consumeLogoutReason:       jest.fn().mockResolvedValue(null),

    // ── Backfill timestamp ────────────────────────────────────────────────────
    getLastBackfillTs:         jest.fn().mockResolvedValue(0),
    setLastBackfillTs:         jest.fn().mockResolvedValue(undefined),

    // ── Recent searches ───────────────────────────────────────────────────────
    getRecentSearches:         jest.fn().mockResolvedValue([]),
    addRecentSearch:           jest.fn().mockResolvedValue(undefined),
    clearRecentSearches:       jest.fn().mockResolvedValue(undefined),
    removeRecentSearch:        jest.fn().mockResolvedValue(undefined),

    // ── UI preferences (device-scoped, not cleared on logout) ────────────────
    getPrefMovieSort:          jest.fn().mockResolvedValue(null),
    setPrefMovieSort:          jest.fn().mockResolvedValue(undefined),
    getPrefSeriesSort:         jest.fn().mockResolvedValue(null),
    setPrefSeriesSort:         jest.fn().mockResolvedValue(undefined),
    getPrefLiveCat:            jest.fn().mockResolvedValue(null),
    setPrefLiveCat:            jest.fn().mockResolvedValue(undefined),
    getPrefPlaybackSpeed:      jest.fn().mockResolvedValue(null),
    setPrefPlaybackSpeed:      jest.fn().mockResolvedValue(undefined),
  } satisfies jest.Mocked<StorageServiceShape>;

  return { ...base, ...overrides } as jest.Mocked<StorageServiceShape>;
}
