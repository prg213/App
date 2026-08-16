/**
 * Type-safe EPG service mock factory.
 *
 * Builds a fully-stubbed jest mock where every exported function from
 * `services/epgService` defaults to a no-op that resolves / returns a sensible
 * empty value.  Pass `overrides` to replace only the functions a specific
 * test cares about.
 *
 * TypeScript enforces that every key in `overrides` matches a real export
 * from `services/epgService`, so if a function is renamed or removed the
 * compiler will flag the stale override immediately.
 *
 * Usage in a test file:
 *
 *   import { makeEpgServiceMock } from './helpers/epgMock';
 *
 *   jest.mock('../services/epgService', () => makeEpgServiceMock({
 *     fetchAndParseXmltv: jest.fn().mockResolvedValue(new Map([['ch1', []]])),
 *   }));
 */

import type * as EpgService from '../../services/epgService';

type EpgShape = typeof EpgService;

/**
 * Returns a jest.Mocked version of the epgService module.
 * Every exported function defaults to a harmless stub; pass overrides to
 * customise individual methods for a specific test.
 *
 * The `overrides` parameter is typed as `Partial<EpgShape>`, which means
 * TypeScript will error if a caller supplies a key that does not exist on the
 * real epgService module — making the mock self-validating against the live
 * interface.
 */
export function makeEpgServiceMock(
  overrides: Partial<EpgShape> = {},
): jest.Mocked<EpgShape> {
  const base: jest.Mocked<EpgShape> = {
    // ── XMLTV parsing ────────────────────────────────────────────────────────
    parseXmltvAsync:      jest.fn().mockResolvedValue(new Map()),

    // ── Fetch + parse ────────────────────────────────────────────────────────
    fetchAndParseXmltv:   jest.fn().mockResolvedValue(new Map()),

    // ── Helpers ──────────────────────────────────────────────────────────────
    tryDecodeBase64:      jest.fn().mockReturnValue(''),
  };

  return { ...base, ...overrides } as jest.Mocked<EpgShape>;
}
