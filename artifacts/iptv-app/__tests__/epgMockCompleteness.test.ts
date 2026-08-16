/**
 * #423: EPG service mock completeness.
 *
 * Ensures the shared makeEpgServiceMock factory always covers every exported
 * function from `services/epgService`.  If a developer adds a new function to
 * epgService without updating epgMock.ts this test will fail at runtime.
 * TypeScript also catches the drift at compile time via the
 * `jest.Mocked<EpgShape>` annotation in makeEpgServiceMock, but the runtime
 * check acts as a belt-and-suspenders guard that works even if the new export
 * lacks type annotations.
 *
 * When this test fails:
 *   1. Add the missing function(s) to the `base` object in makeEpgServiceMock().
 *   2. Choose a sensible default return value (mockReturnValue('') for
 *      synchronous helpers, mockResolvedValue(new Map()) for async parsers).
 */

import { makeEpgServiceMock } from './helpers/epgMock';
import * as EpgService from '../services/epgService';

describe('makeEpgServiceMock completeness (#423)', () => {
  it('provides a stub for every exported function in epgService', () => {
    const mock = makeEpgServiceMock();

    const realFunctions = Object.entries(EpgService)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);

    const mockKeys = new Set(Object.keys(mock));
    const missing = realFunctions.filter((fn) => !mockKeys.has(fn));

    if (missing.length > 0) {
      throw new Error(
        `epgMock.ts is missing stubs for the following epgService export(s):\n` +
          missing.map((fn) => `  • ${fn}`).join('\n') +
          '\n\nAdd them to the base object inside makeEpgServiceMock() in ' +
          '__tests__/helpers/epgMock.ts.',
      );
    }
  });

  it('every stub is a jest mock function', () => {
    const mock = makeEpgServiceMock();

    for (const [key, value] of Object.entries(mock)) {
      expect(
        typeof value === 'function' && typeof (value as jest.Mock).mock !== 'undefined',
      ).toBe(true);
      void key; // suppress unused-variable lint
    }
  });

  it('default async stubs resolve without throwing', async () => {
    const mock = makeEpgServiceMock();

    await expect(
      mock.parseXmltvAsync('<tv></tv>'),
    ).resolves.toBeInstanceOf(Map);

    await expect(
      mock.fetchAndParseXmltv('http://example.com/epg.xml'),
    ).resolves.toBeInstanceOf(Map);
  });

  it('default sync stubs return without throwing', () => {
    const mock = makeEpgServiceMock();

    expect(mock.tryDecodeBase64('aGVsbG8=')).toBe('');
  });

  it('allows individual stubs to be overridden', async () => {
    const customMap = new Map([['ch1', []]]);
    const customFetch = jest.fn().mockResolvedValue(customMap);
    const mock = makeEpgServiceMock({ fetchAndParseXmltv: customFetch });

    expect(mock.fetchAndParseXmltv).toBe(customFetch);
    // Other stubs remain the defaults
    expect(mock.parseXmltvAsync).toBeDefined();
    expect(mock.tryDecodeBase64).toBeDefined();
  });
});
