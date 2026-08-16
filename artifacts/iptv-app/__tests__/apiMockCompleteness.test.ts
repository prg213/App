/**
 * #422: API service mock completeness.
 *
 * Ensures the shared makeApiMock factory always covers every exported function
 * from `services/xtreamApi`.  If a developer adds a new function to xtreamApi
 * without updating apiMock.ts this test will fail at runtime.  TypeScript also
 * catches the drift at compile time via the `jest.Mocked<ApiShape>` annotation
 * in makeApiMock, but the runtime check acts as a belt-and-suspenders guard
 * that works even if the new export lacks type annotations.
 *
 * When this test fails:
 *   1. Add the missing function(s) to the `base` object in makeApiMock().
 *   2. Choose a sensible default return value (mockReturnValue('') for
 *      synchronous URL helpers, mockResolvedValue([]) for async list fetches,
 *      mockResolvedValue(null) for async nullable lookups).
 */

import { makeApiMock } from './helpers/apiMock';
import * as XtreamApi from '../services/xtreamApi';

describe('makeApiMock completeness (#422)', () => {
  it('provides a stub for every exported function in xtreamApi', () => {
    const mock = makeApiMock();

    const realFunctions = Object.entries(XtreamApi)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);

    const mockKeys = new Set(Object.keys(mock));
    const missing = realFunctions.filter((fn) => !mockKeys.has(fn));

    if (missing.length > 0) {
      throw new Error(
        `apiMock.ts is missing stubs for the following xtreamApi export(s):\n` +
          missing.map((fn) => `  • ${fn}`).join('\n') +
          '\n\nAdd them to the base object inside makeApiMock() in ' +
          '__tests__/helpers/apiMock.ts.',
      );
    }
  });

  it('every stub is a jest mock function', () => {
    const mock = makeApiMock();

    for (const [key, value] of Object.entries(mock)) {
      expect(
        typeof value === 'function' && typeof (value as jest.Mock).mock !== 'undefined',
      ).toBe(true);
      void key; // suppress unused-variable lint
    }
  });

  it('default async stubs resolve without throwing', async () => {
    const mock = makeApiMock();

    const creds = { host: 'http://example.com', username: 'u', password: 'p' };

    await expect(mock.getXtreamLiveCategories(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamLiveStreams(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamCatchupEpg(creds, '1')).resolves.toEqual([]);
    await expect(mock.getXtreamVodCategories(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamVodStreams(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamVodInfo(creds, '1')).resolves.toBeNull();
    await expect(mock.getXtreamSeriesCategories(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamSeries(creds)).resolves.toEqual([]);
    await expect(mock.getXtreamSeriesInfo(creds, '1')).resolves.toMatchObject({ seasons: [] });
    await expect(mock.getXtreamAccountInfo(creds)).resolves.toMatchObject({
      expDate: null,
      status: null,
    });
  });

  it('default sync stubs return without throwing', () => {
    const mock = makeApiMock();

    const creds = { host: 'http://example.com', username: 'u', password: 'p' };

    expect(mock.getXtreamCatchupUrls(creds, '1', '2026-01-01 10:00:00', 30, 0)).toEqual([]);
    expect(mock.getXtreamCatchupUrl(creds, '1', '2026-01-01 10:00:00', 30)).toBe('');
    expect(mock.getXtreamVodUrl(creds, '1', 'mp4')).toBe('');
    expect(mock.getXtreamSeriesUrl(creds, '1', 'mkv')).toBe('');
    expect(mock.getXtreamXmltvUrl(creds)).toBe('');
    expect(mock.parseXtreamCredsFromM3u('http://example.com/get.php')).toBeNull();
  });

  it('allows individual stubs to be overridden', async () => {
    const customStreams = jest.fn().mockResolvedValue([{ id: '1', name: 'BBC One' }]);
    const mock = makeApiMock({ getXtreamLiveStreams: customStreams });

    expect(mock.getXtreamLiveStreams).toBe(customStreams);
    // Other stubs remain the defaults
    expect(mock.getXtreamLiveCategories).toBeDefined();
    expect(mock.getXtreamVodStreams).toBeDefined();
  });
});
