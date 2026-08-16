/**
 * Type-safe Xtream API service mock factory.
 *
 * Builds a fully-stubbed jest mock where every exported function from
 * `services/xtreamApi` defaults to a no-op that resolves / returns a sensible
 * empty value.  Pass `overrides` to replace only the functions a specific
 * test cares about.
 *
 * TypeScript enforces that every key in `overrides` matches a real export
 * from `services/xtreamApi`, so if a function is renamed or removed the
 * compiler will flag the stale override immediately.
 *
 * Usage in a test file:
 *
 *   import { makeApiMock } from './helpers/apiMock';
 *
 *   jest.mock('../services/xtreamApi', () => makeApiMock({
 *     getXtreamLiveStreams: jest.fn().mockResolvedValue([mockChannel]),
 *   }));
 */

import type * as XtreamApi from '../../services/xtreamApi';

type ApiShape = typeof XtreamApi;

/**
 * Returns a jest.Mocked version of the xtreamApi service module.
 * Every exported function defaults to a harmless stub; pass overrides to
 * customise individual methods for a specific test.
 *
 * The `overrides` parameter is typed as `Partial<ApiShape>`, which means
 * TypeScript will error if a caller supplies a key that does not exist on the
 * real xtreamApi module — making the mock self-validating against the live
 * interface.
 */
export function makeApiMock(
  overrides: Partial<ApiShape> = {},
): jest.Mocked<ApiShape> {
  const base: jest.Mocked<ApiShape> = {
    // ── Live TV ─────────────────────────────────────────────────────────────
    getXtreamLiveCategories:    jest.fn().mockResolvedValue([]),
    getXtreamLiveStreams:        jest.fn().mockResolvedValue([]),

    // ── Catch-up / Archive ──────────────────────────────────────────────────
    getXtreamCatchupEpg:        jest.fn().mockResolvedValue([]),
    getXtreamCatchupUrls:       jest.fn().mockReturnValue([]),
    /** @deprecated */
    getXtreamCatchupUrl:        jest.fn().mockReturnValue(''),

    // ── VOD / Movies ────────────────────────────────────────────────────────
    getXtreamVodCategories:     jest.fn().mockResolvedValue([]),
    getXtreamVodStreams:         jest.fn().mockResolvedValue([]),
    getXtreamVodInfo:           jest.fn().mockResolvedValue(null),
    getXtreamVodUrl:            jest.fn().mockReturnValue(''),

    // ── Series ──────────────────────────────────────────────────────────────
    getXtreamSeriesCategories:  jest.fn().mockResolvedValue([]),
    getXtreamSeries:            jest.fn().mockResolvedValue([]),
    getXtreamSeriesInfo:        jest.fn().mockResolvedValue({ series: {}, seasons: [] }),
    getXtreamSeriesUrl:         jest.fn().mockReturnValue(''),

    // ── EPG ─────────────────────────────────────────────────────────────────
    getXtreamXmltvUrl:          jest.fn().mockReturnValue(''),

    // ── Account ─────────────────────────────────────────────────────────────
    getXtreamAccountInfo:       jest.fn().mockResolvedValue({
      expDate: null,
      status: null,
      maxConnections: null,
      activeConnections: null,
    }),

    // ── Helpers ─────────────────────────────────────────────────────────────
    parseXtreamCredsFromM3u:    jest.fn().mockReturnValue(null),
  };

  return { ...base, ...overrides } as jest.Mocked<ApiShape>;
}
