---
name: GitHub connector large-file publishing
description: Safe approach for publishing larger workspace files through the GitHub connector.
---

When publishing larger source files through the GitHub connector, read them with the durable workspace file callback and pass the text into a small `"use impure"` function. If the connection exposes an SDK client, prefer its authenticated repository methods for writes; otherwise base64-encode inside the impure function and use `proxyFetch`.

**Why:** Routing a large Base64 string through the CodeExecution shell callback can silently truncate the callback output despite a generous requested output budget. In this environment, low-level proxy write attempts also failed with a connector pattern error while leaving the branch unchanged; the authenticated SDK client published successfully.

**How to apply:** After any connector-based source upload, compare local and remote decoded SHA-256 hashes before considering the repository synchronized. Use durable `readFile` by default when fidelity matters, and check `hasClient` before choosing the SDK path.