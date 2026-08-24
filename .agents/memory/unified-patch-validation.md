---
name: Unified patch validation
description: Native dependency patches need exact hunk metadata and careful EOF validation in this workspace.
---

Generated unified diffs for patched native dependencies can be syntactically valid when tested from a temporary file but become corrupt after an editor-style workspace write, especially when the final hunk ends with a blank context line. Archive-supplied patches can also contain sequential hunks for the same file that only apply to an already-patched copy; reconstruct the combined diff against the pristine package. Every unchanged line in the patch must retain its leading unified-diff context space. Validate the committed patch with a clean pnpm install and inspect the resulting installed native source, not only a cached package copy.

**Why:** A malformed patch can survive TypeScript and Jest checks while failing the clean CI dependency install, blocking the Android build.

**How to apply:** After changing a pnpm `patchedDependencies` file, validate both the patch and a frozen install before committing. Confirm the patched class contains the intended code under the lockfile’s new patch hash. Keep the lockfile change limited to the patch hash and package snapshot.