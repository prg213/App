/**
 * ESLint configuration for the StreamVault IPTV app.
 *
 * KEY RULE: no direct AsyncStorage writes outside services/storage.ts
 * ─────────────────────────────────────────────────────────────────────
 * All AsyncStorage.setItem / multiSet / mergeItem / multiMerge calls —
 * including those made via the `AS` dynamic-import alias — are banned in
 * every file except services/storage.ts.
 *
 * WHY: when a developer passes a variable or template literal as the key
 * argument the in-memory-only guard (scripts/check-inmemory-not-persisted.py)
 * cannot match it against the forbidden-identifier catalogue, silently missing
 * violations.  Routing all writes through StorageService's typed wrappers
 * makes dynamic keys structurally impossible outside that one file.
 *
 * HOW TO ADD A NEW PERSISTED VALUE:
 *   1. Add a constant to the KEYS object in services/storage.ts.
 *   2. Add a typed get/set method pair to StorageService.
 *   3. Call the new method from your feature code.
 *   Never call AsyncStorage write methods directly from app/hooks/context/components.
 *
 * ACTIVATING ESLINT:
 *   ESLint is not currently installed as a dev dependency.  To activate this
 *   config add eslint + @typescript-eslint/parser to the project:
 *
 *     pnpm add -D --filter @workspace/iptv-app eslint @typescript-eslint/parser
 *
 *   Then run:  pnpm --filter @workspace/iptv-app exec eslint .
 *   Or via the npm script:  pnpm --filter @workspace/iptv-app run lint
 */

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  // Plugins are declared so that inline eslint-disable comments referencing
  // their rules (e.g. react-hooks/exhaustive-deps, @typescript-eslint/no-unused-vars)
  // are recognised and don't produce "Definition for rule not found" errors.
  // The rules themselves are not enabled here — this config's sole purpose is
  // the AsyncStorage write ban below.
  plugins: ['react-hooks', '@typescript-eslint'],
  overrides: [
    {
      // Apply the ban to every app source file EXCEPT services/storage.ts,
      // which is the single authorised location for direct AsyncStorage writes.
      files: [
        'app/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
        'context/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'services/!(storage).ts',
        'services/!(storage).tsx',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          // ── canonical import name ──────────────────────────────────────
          {
            selector:
              "CallExpression[callee.object.name='AsyncStorage'][callee.property.name='setItem']",
            message:
              'Direct AsyncStorage.setItem is banned outside services/storage.ts. ' +
              'Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AsyncStorage'][callee.property.name='multiSet']",
            message:
              'Direct AsyncStorage.multiSet is banned outside services/storage.ts. ' +
              'Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AsyncStorage'][callee.property.name='mergeItem']",
            message:
              'Direct AsyncStorage.mergeItem is banned outside services/storage.ts. ' +
              'Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AsyncStorage'][callee.property.name='multiMerge']",
            message:
              'Direct AsyncStorage.multiMerge is banned outside services/storage.ts. ' +
              'Add a typed wrapper to StorageService instead.',
          },
          // ── AS dynamic-import alias ────────────────────────────────────
          // Pattern used in player.tsx and tab screens:
          //   import('@react-native-async-storage/async-storage')
          //     .then(({ default: AS }) => AS.setItem(...))
          {
            selector:
              "CallExpression[callee.object.name='AS'][callee.property.name='setItem']",
            message:
              'Direct AS.setItem (AsyncStorage dynamic-import alias) is banned outside ' +
              'services/storage.ts. Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AS'][callee.property.name='multiSet']",
            message:
              'Direct AS.multiSet (AsyncStorage dynamic-import alias) is banned outside ' +
              'services/storage.ts. Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AS'][callee.property.name='mergeItem']",
            message:
              'Direct AS.mergeItem (AsyncStorage dynamic-import alias) is banned outside ' +
              'services/storage.ts. Add a typed wrapper to StorageService instead.',
          },
          {
            selector:
              "CallExpression[callee.object.name='AS'][callee.property.name='multiMerge']",
            message:
              'Direct AS.multiMerge (AsyncStorage dynamic-import alias) is banned outside ' +
              'services/storage.ts. Add a typed wrapper to StorageService instead.',
          },
        ],
      },
    },
  ],
};
