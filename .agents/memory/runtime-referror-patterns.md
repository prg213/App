---
name: Runtime ReferenceError patterns in StreamVault IPTV
description: Two classes of runtime crashes that TypeScript TS2448/2454 doesn't always catch — and a third class that TS2304 does catch.
---

## Class 1 — Temporal Dead Zone (TDZ) in hook dep arrays
**Rule:** Any `const` declared via `useState`/`useMemo`/`useCallback`/`useRef` that appears in a *synchronously evaluated* hook dep array (`[x]`) before it is declared throws a `ReferenceError` on every render.

**Why TypeScript misses it:** TS2448 is only raised when TS can statically trace the declaration order. Closures inside `useCallback(fn, [x])` where `x` is inside `fn` body (not the dep array) are NOT flagged.

**How to apply:** Audit every hook dep array to verify the variable it references is declared *above* that hook call in the function body. If not, either move the declaration up, or convert the dep-array reference to a ref (for values that don't gate re-runs).

Files fixed (for reference only — check current code):
- `app/(tabs)/index.tsx` — `channels`, `filteredChannels`
- `app/(tabs)/guide.tsx` — `guideFavIds`/`setGuideFavIds` scope
- `app/(tabs)/reminders.tsx` — `handleUndo`
- `app/player.tsx` — `player`
- `app/series/[id].tsx` — `displayCover`
- `components/ContinueWatchingRail.tsx` — `loadHistory`

## Class 2 — Missing prop destructure (TS2304 catches this)
**Rule:** Props listed in a component's *interface* but omitted from its *destructure parameter* are `undefined` at runtime. When used in JSX attributes or expressions they behave like undeclared variables (ReferenceError in Hermes strict mode) or silently produce `undefined`.

**Why:** Interface and destructure are separate; it's easy to add a prop to the type but forget to add it to the `{ a, b, c }` parameter list.

**Files fixed:**
- `components/MovieCard.tsx` — `year` missing from destructure, `title` used instead of `name` in accessibilityLabel
- `app/(tabs)/index.tsx` — `ChannelRow` missing `onLongPress` in destructure

**How to apply:** Run `npx tsc --noEmit` and treat every `error TS2304: Cannot find name` in a component file as a likely crash — undeclared names in JSX are runtime ReferenceErrors.

## Class 3 — StyleSheet.absoluteFillObject (removed in newer RN types)
`StyleSheet.absoluteFillObject` is valid at runtime in the RN version used but missing from the TS types. Replace with `{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }` in `StyleSheet.create` spreads, and `StyleSheet.absoluteFill` in JSX style arrays.

## Class 4 — Hook declared after conditional early return ("Rendered more hooks than during the previous render")
**Rule:** Any `useCallback`/`useState`/`useEffect`/`useMemo`/`useRef` declared *after* an `if (...) return null` inside a component body causes React to see a different hook count between the first render (took the early return) and the second (didn't). React throws "Rendered more hooks than during the previous render."

**Why TypeScript misses it:** TS has no rule about hook call ordering relative to early returns. The linter rule `react-hooks/rules-of-hooks` would catch it, but it's not enforced in CI for this project.

**Pattern to watch for:** Components that load async data (useState = []) and guard `if (data.length === 0) return null` — any hook declared after that guard is a ticking bomb.

**Files fixed:**
- `components/RecentChannelsRail.tsx` — `handleClearAll` useCallback was after `if (recent.length === 0) return null`
- `components/ContinueWatchingRail.tsx` — `handleClearAll` useCallback was after `if (history.length === 0) return null`

**How to apply:** Grep for `return null` inside component functions, then check whether any hook call appears below it in the same function body. All hooks must be declared before any conditional return.

## Fixing a wrong property name can ACTIVATE dormant behavior
`scrubbingModeOptions = { isEnabled }` was invalid and silently ignored; renaming it to the real `scrubbingModeEnabled` turned scrubbing mode ON permanently — which on Android SUPPRESSES playback (broke VOD autoplay). Rule: when a typecheck fix renames a property to the correct API name, verify what the now-effective option actually does at runtime; never leave `scrubbingModeEnabled` set outside an active seek-bar drag.
