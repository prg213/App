/**
 * Type-safe M3U parser service mock factory.
 *
 * Builds a fully-stubbed jest mock where every exported function from
 * `services/m3uParser` defaults to a no-op that resolves / returns a sensible
 * empty value.  Pass `overrides` to replace only the functions a specific
 * test cares about.
 *
 * TypeScript enforces that every key in `overrides` matches a real export
 * from `services/m3uParser`, so if a function is renamed or removed the
 * compiler will flag the stale override immediately.
 *
 * Usage in a test file:
 *
 *   import { makeM3uParserMock } from './helpers/m3uParserMock';
 *
 *   jest.mock('../services/m3uParser', () => makeM3uParserMock({
 *     fetchAndParseM3U: jest.fn().mockResolvedValue({ channels: [mockChannel], categories: [] }),
 *   }));
 */

import type * as M3uParser from '../../services/m3uParser';

type M3uParserShape = typeof M3uParser;

/**
 * Returns a jest.Mocked version of the m3uParser service module.
 * Every exported function defaults to a harmless stub; pass overrides to
 * customise individual methods for a specific test.
 *
 * The `overrides` parameter is typed as `Partial<M3uParserShape>`, which means
 * TypeScript will error if a caller supplies a key that does not exist on the
 * real m3uParser module — making the mock self-validating against the live
 * interface.
 */
export function makeM3uParserMock(
  overrides: Partial<M3uParserShape> = {},
): jest.Mocked<M3uParserShape> {
  const base: jest.Mocked<M3uParserShape> = {
    // ── Sync parsers ─────────────────────────────────────────────────────────
    parseM3U: jest.fn().mockReturnValue({ channels: [], categories: [] }),

    // ── Async fetchers ───────────────────────────────────────────────────────
    fetchAndParseM3U: jest.fn().mockResolvedValue({ channels: [], categories: [] }),
  };

  return { ...base, ...overrides } as jest.Mocked<M3uParserShape>;
}
