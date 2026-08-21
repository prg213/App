---
name: EAS Build pnpm fix
description: How to get EAS Android builds to pass the install phase with this monorepo.
---

## The Problem
EAS image `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57` ships with pnpm **11.9.0**, which has a bug where `onlyBuiltDependencies` in `pnpm-workspace.yaml` is completely ignored. Result: `ERR_PNPM_IGNORED_BUILDS` for `@clerk/shared` and `esbuild`, always fatal, no config workaround.

Attempts that did NOT work:
- `onlyBuiltDependencies` in `pnpm-workspace.yaml` (any combination)
- `strictBuiltDependencies: false` in `pnpm-workspace.yaml`
- `settings.onlyBuiltDependencies` manually added to `pnpm-lock.yaml`
- `strict-built-dependencies=false` in root `.npmrc`
- `only-built-dependencies-file=.pnpm-allowed-builds.json` in root `.npmrc`
- `packageManager: "pnpm@9.15.9"` in root `package.json` (EAS does not use corepack)

## The Fix
Switch `eas.json` image to `ubuntu-24.04-jdk-17-ndk-r27b`. This image has an older pnpm (9 or 10) that allows build scripts without strict enforcement.

**Why:** pnpm 11.22.0 fixed the `onlyBuiltDependencies` bug, but pnpm 11.9.0 (on ubuntu-26.04 image) ignores the setting entirely. The ubuntu-24.04 image predates pnpm 11.

**How to apply:** In `artifacts/iptv-app/eas.json`, under the `preview` Android profile, keep `"image": "ubuntu-24.04-jdk-17-ndk-r27b"`. Do not upgrade back to the ubuntu-26.04-sdk-57 image unless EAS has updated it past pnpm 11.9.0.

## EAS Project Info
- Account: `prg123s-team`, project: `iptv-app`
- Keystore: `KYpC-gXKPE` (EAS-managed, differs from GitHub Actions keystore)
- Sideloading: requires uninstall first (different signing key from prior GitHub Actions APKs)

## Successful Build
First successful EAS build: `613f2e8c`, ~16 min, ubuntu-24.04 image.
APK delivered as `.tar.gz` — extract to get the `.apk`.
