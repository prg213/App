---
name: GitHub source upload integrity
description: Safe API publishing rules for large source files when Git pushes are unavailable.
---

Never pass a large base64-encoded source file through a tool result before
creating a GitHub blob or tree. Upload it directly from the workspace process,
then compare the downloaded GitHub file's SHA-256 with the local source before
starting CI.

**Why:** A large player source was silently truncated during an intermediary
tool transfer. GitHub accepted the malformed blob, but the Android workflow
later failed ESLint at the first character because the remote file began in the
middle of the source.

**How to apply:** Use a direct streamed GitHub Contents API request for large
files and keep credentials out of model-visible output. Treat a byte-for-byte
hash match as the publishing completion check; a successful API response alone
is insufficient.

## Complete task-set parity

Before dispatching CI, compare every file changed by the completed local task
with its remote counterpart—not just the files edited in the current turn.

**Why:** A partial upload can leave new static assertions on GitHub while
companion implementation files remain old. Local tests pass against the
coherent workspace, but remote CI correctly fails against the mixed revision.

**How to apply:** Derive the task’s changed-file list from its local commit,
compare each local Git blob SHA with the remote file SHA, then stream/upload
only the mismatches and hash-verify the final whole set before dispatch.