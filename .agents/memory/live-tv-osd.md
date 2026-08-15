---
name: Live TV OSD Architecture
description: Professional IPTV OSD patterns in player.tsx and TVLiveLayout.tsx — auto-dismiss, zap preview EPG, Audio/CC in info bar, progress bars.
---

## Rules and Patterns

**showInfoBarRef pattern** — `switchChannel` is declared before `showInfoBar` in player.tsx, creating a forward-reference problem. Solved by `const showInfoBarRef = useRef<(() => void) | null>(null)` declared near the other state, and `showInfoBarRef.current = showInfoBar` as a render-time assignment immediately after `showInfoBar`'s `useCallback`. `switchChannel` calls `showInfoBarRef.current?.()`.

**Why:** useCallback hooks can't forward-reference each other across the component's declaration order without stale closures. The ref update-on-render pattern is safe and idiomatic (same pattern as `activeUrlRef.current = entry.url` etc.).

**OSD auto-dismiss on TV** — `showInfoBar` schedules `infoTimer` for 6 000 ms when `Platform.isTV && isLive`. Each call resets the timer. Entry useEffect also starts this 6 s timer on TV (instead of starting hidden). On phone/tablet live: still starts hidden, stays until BACK.

**Audio/CC in info bar on TV** — `FocusablePressable` chips appended to `infoTop` row when `Platform.isTV`. The chips call `showInfoBarRef.current?.()` via `onFocus` to reset the auto-dismiss timer. The separate live controls bar (`showControls && !isWeb && isLive`) is now hidden on TV (`&& !Platform.isTV`). The center-zone OK handler on TV only toggles `showInfoBar`/`dismissInfoBar` — no more `showLiveControls()`.

**Zap preview EPG data** — `showTvChannelPreview` looks up `epgMap?.get(channel.epgId)?.find(…nowTs…)` and stores result in `tvPreviewNowProg` state. Card shows channel number, NOW programme title, and a progress bar. Commit delay reduced from 1 000 ms to 700 ms.

**TVLiveLayout EPG progress bars** — `renderChannel` computes `epgPct` from `epgMap?.get(item.epgId ?? item.id)` using `nowTs`. Both `epgMap`, `nowTs`, and `selectedChannel` are added to the `useCallback` dependency array. The LIVE badge (red dot + "LIVE" text) appears on the row where `selectedChannel?.id === item.id`.

**How to apply:** Any future changes to the Live TV OSD must respect:
1. Keep the `showInfoBarRef` pattern — don't add `showInfoBar` to `switchChannel`'s dep array directly.
2. The 6 s timer is in BOTH the mount useEffect (entry) and `showInfoBar` (manual toggle / channel switch).
3. Don't add a new separate overlay for Audio/CC on TV — they belong inside the info bar.
4. `tvPreviewNowProg` state must be cleared (`setTvPreviewNowProg(null)`) in the fade-out callback of `showTvChannelPreview`.
