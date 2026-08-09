/**
 * #200: Storage mock completeness.
 *
 * Ensures the shared makeStorageMock factory always covers every method on the
 * live StorageService.  If a developer adds a new method to StorageService
 * without updating storageMock.ts, this test will fail at runtime (TypeScript
 * also catches this at compile time via the jest.Mocked<StorageServiceShape>
 * return type, but the runtime test acts as a double safety-net in CI).
 *
 * When this test fails:
 *   1. Add the missing method(s) to the `base` object in makeStorageMock().
 *   2. Choose a sensible default resolved value (undefined for mutations, null
 *      or empty array for reads).
 */

// Mock native modules so storage.ts can be imported in a Jest (Node) environment.
jest.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
    multiRemove: jest.fn().mockResolvedValue(undefined),
    multiGet: jest.fn().mockResolvedValue([]),
  },
}));

// expo-secure-store uses ESM syntax; mock it so Jest (CJS) can load storage.ts
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import { makeStorageMock } from './helpers/storageMock';
import { StorageService } from '../services/storage';

describe('makeStorageMock completeness (#200)', () => {
  it('provides a stub for every public method on StorageService', () => {
    const mock = makeStorageMock();

    const realMethods = Object.keys(StorageService).filter(
      (k) => typeof (StorageService as Record<string, unknown>)[k] === 'function',
    );

    const mockKeys = new Set(Object.keys(mock));
    const missing = realMethods.filter((m) => !mockKeys.has(m));

    if (missing.length > 0) {
      throw new Error(
        `storageMock.ts is missing stubs for the following StorageService method(s):\n` +
          missing.map((m) => `  • ${m}`).join('\n') +
          '\n\nAdd them to the base object inside makeStorageMock() in ' +
          '__tests__/helpers/storageMock.ts.',
      );
    }
  });
});
