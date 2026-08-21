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