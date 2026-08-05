---
name: Task sweep methodology
description: How to efficiently audit all PROPOSED tasks in the StreamVault queue
---

## Pattern

1. Read snapshot task list (20 shown), then call `searchProjectTasks` + `getProjectTask` for refs 1–300 to find all PROPOSED tasks.
2. Dispatch parallel `subagent` sweeps (7-8 tasks/batch, `config: { $kind: 'explore' }`), each answering: fully implemented? primary file? key missing piece?
3. Any confirmed NO → implement immediately; batch independent edits into one response.
4. Commit after each implementation batch; push to origin/main at session end.

**Why:** Subagents read multiple files and grep in parallel without burning main-agent context. Batching 7-8 per call covers a full feature domain in one round-trip.

**How to apply:** Use this pattern at the start of any session that involves working through a PROPOSED task queue.

## Task ref scanning

`getProjectTask({ taskRef: ref })` accepts bare numbers (e.g. `"42"` not `"#42"`). Scan in batches of 10 with `Promise.all`. Refs beyond 300 returned 0 results for StreamVault.
