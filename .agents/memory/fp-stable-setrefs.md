---
name: FocusablePressable stable setRefs
description: Root cause and fix for "Maximum update depth exceeded" crash when opening CatchupSheet on Firestick and mobile Android.
---

## Rule
`setRefs` in FocusablePressable MUST be a stable `useCallback(() => ..., [])` using the ref-in-ref pattern. **Never** define it as an inline function in the render body.

## Why
`setRefs` was `const setRefs = (node) => { ... }` — a new function on every render. React treats a changed callback ref as "detach then re-attach": it calls the old one with `null`, then the new one with the node, on **every** render cycle. When many FocusablePressables re-render simultaneously (day pills + programme rows + channel list items in TVLiveLayout), this null→node churn fires dozens of times within a single React commit phase, exceeding the 50-nested-update safety limit and throwing "Maximum update depth exceeded". Crash was confirmed on both Fire OS and mobile Android. The earlier `nowTs → useState` fix in CatchupSheet was a contributing factor (stabilising memos) but did NOT stop the crash; the inline `setRefs` was the primary cause.

## How to apply
```tsx
const forwardedRef = useRef(ref);
forwardedRef.current = ref; // always current, no deps needed

const setRefs = useCallback((node: View | null) => {
  innerRef.current = node;
  const fwd = forwardedRef.current;
  if (typeof fwd === 'function') fwd(node);
  else if (fwd) (fwd as React.MutableRefObject<View | null>).current = node;
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // stable — never recreated after mount
```
Any component that merges a forwarded ref with an inner ref should use this pattern. The stable identity means React never calls null/node churn on re-renders; only mount and unmount trigger the ref callbacks.
