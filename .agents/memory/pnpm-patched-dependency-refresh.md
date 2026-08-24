---
name: pnpm patched dependency refresh
description: How pnpm selects patched package-store entries after a patch file changes.
---

After changing a file listed in `patchedDependencies`, run `pnpm install --lockfile-only --force` before a clean install and native-source inspection.

**Why:** `pnpm install --force` can still select the package-store copy addressed by the old patch hash in `pnpm-lock.yaml`. A valid edited patch file may therefore appear to install successfully while the dependency on disk still contains the previous source.

**How to apply:** Refresh the lockfile hash, reinstall, then inspect a distinctive changed line in the resolved patched package before treating a native build or test as validation.