---
name: Unified patch validation
description: Native dependency patches need exact hunk metadata and careful EOF validation in this workspace.
---

Generated unified diffs for patched native dependencies can be syntactically valid when tested from a temporary file but become corrupt after an editor-style workspace write, especially when the final hunk ends with a blank context line. Validate the committed patch with `git apply --check` against the actual installed package and ensure the patch ends in a normal diff record rather than an unterminated blank context line.

**Why:** A malformed patch can survive TypeScript and Jest checks while failing the clean CI dependency install, blocking the Android build.

**How to apply:** After changing a pnpm `patchedDependencies` file, validate both the patch and a frozen install before committing. Keep the lockfile change limited to the patch hash and package snapshot.