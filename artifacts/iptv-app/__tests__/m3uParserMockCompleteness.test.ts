/**
 * #424: M3U parser service mock completeness.
 *
 * Ensures the shared makeM3uParserMock factory always covers every exported
 * function from `services/m3uParser`.  If a developer adds a new helper to
 * m3uParser without updating m3uParserMock.ts this test will fail at runtime.
 * TypeScript also catches the drift at compile time via the
 * `jest.Mocked<M3uParserShape>` annotation in makeM3uParserMock, but the
 * runtime check acts as a belt-and-suspenders guard that works even if the new
 * export lacks type annotations.
 *
 * When this test fails:
 *   1. Add the missing function(s) to the `base` object in makeM3uParserMock().
 *   2. Choose a sensible default return value (mockReturnValue({channels:[],categories:[]})
 *      for sync helpers, mockResolvedValue({channels:[],categories:[]}) for async fetchers).
 */

import { makeM3uParserMock } from './helpers/m3uParserMock';
import * as M3uParser from '../services/m3uParser';

describe('makeM3uParserMock completeness (#424)', () => {
  it('provides a stub for every exported function in m3uParser', () => {
    const mock = makeM3uParserMock();

    const realFunctions = Object.entries(M3uParser)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => key);

    const mockKeys = new Set(Object.keys(mock));
    const missing = realFunctions.filter((fn) => !mockKeys.has(fn));

    if (missing.length > 0) {
      throw new Error(
        `m3uParserMock.ts is missing stubs for the following m3uParser export(s):\n` +
          missing.map((fn) => `  • ${fn}`).join('\n') +
          '\n\nAdd them to the base object inside makeM3uParserMock() in ' +
          '__tests__/helpers/m3uParserMock.ts.',
      );
    }
  });

  it('every stub is a jest mock function', () => {
    const mock = makeM3uParserMock();

    for (const [key, value] of Object.entries(mock)) {
      expect(
        typeof value === 'function' && typeof (value as jest.Mock).mock !== 'undefined',
      ).toBe(true);
      void key; // suppress unused-variable lint
    }
  });

  it('default sync stub returns without throwing', () => {
    const mock = makeM3uParserMock();

    const result = mock.parseM3U('#EXTM3U\n#EXTINF:-1,Test\nhttp://example.com/stream');
    expect(result).toEqual({ channels: [], categories: [] });
  });

  it('default async stub resolves without throwing', async () => {
    const mock = makeM3uParserMock();

    await expect(mock.fetchAndParseM3U('http://example.com/playlist.m3u')).resolves.toEqual({
      channels: [],
      categories: [],
    });
  });

  it('allows individual stubs to be overridden', async () => {
    const customFetch = jest.fn().mockResolvedValue({
      channels: [{ id: 'ch-1', name: 'BBC One', streamUrl: 'http://example.com/1' }],
      categories: [{ id: 'News', name: 'News', count: 1 }],
    });

    const mock = makeM3uParserMock({ fetchAndParseM3U: customFetch });

    expect(mock.fetchAndParseM3U).toBe(customFetch);
    // Other stubs remain the defaults
    expect(mock.parseM3U).toBeDefined();
    const result = await mock.fetchAndParseM3U('http://example.com/playlist.m3u');
    expect(result.channels).toHaveLength(1);
  });
});
