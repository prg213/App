---
name: GitHub connector large-file publishing
description: Safe approach for publishing larger workspace files through the GitHub connector.
---

When a GitHub Contents API update needs a larger source file, read it with the durable workspace file callback and pass the text into a small `"use impure"` function. Base64-encode inside that function, then call the connector's `proxyFetch`.

**Why:** Routing a large Base64 string through the CodeExecution shell callback can silently truncate the callback output despite a generous requested output budget. GitHub accepts the truncated payload as a valid file, resulting in a successful-looking but incomplete source upload.

**How to apply:** After any connector-based source upload, compare the local and remote decoded SHA-256 hashes before considering the repository synchronized. For small files the shell approach may work, but use durable `readFile` by default when fidelity matters.