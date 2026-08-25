---
name: GitHub connector large-file publishing
description: Safe approach for publishing larger workspace files through the GitHub connector.
---

When publishing larger source files through the GitHub connector, read them with the durable workspace file callback and pass the text into a small `"use impure"` function. If the connection exposes an SDK client, prefer its authenticated repository methods for writes; otherwise base64-encode inside the impure function and use `proxyFetch`.

**Why:** Routing a large Base64 string through the CodeExecution shell callback can silently truncate the callback output despite a generous requested output budget. In this environment, low-level proxy write attempts also failed with a connector pattern error while leaving the branch unchanged; the authenticated SDK client published successfully.

**How to apply:** After any connector-based source upload, compare local and remote decoded SHA-256 hashes before considering the repository synchronized. Use durable `readFile` by default when fidelity matters, and check `hasClient` before choosing the SDK path.

For a signed CI build, verify the remote default branch contains every local
source file referenced by the changed test contract, not only a hand-picked
list of recently edited files.

**Why:** A local test can pass against a supporting layout file while the remote
build still has an older version, causing static source assertions to fail
before packaging begins.

**How to apply:** Before dispatch, compare the local and remote blob hashes for
the full committed change set and any directly asserted companion files. Treat
an unsynchronized dependency as a build blocker.