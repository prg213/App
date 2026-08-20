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

## Bottom OSD unified (Aug 2026)
- Prev/next channel nav cards removed from the info bar — the minimal NOW/NEXT strip is the only bottom menu; refs/styles (chNav*, prevChBtnRef/nextChBtnRef) deleted.
- Zapping inputs: fullscreen TV D-pad UP=next / DOWN=prev via useTVRemote onHWKeyEvent fallback; LEFT/RIGHT are always inert and return focus to the centre player target. The visible info bar does not suppress vertical zapping, but the channel browser and Audio/CC pickers retain exclusive D-pad control. Touch swipe LEFT=next / RIGHT=prev; vertical swipe zap kept.
- First-channel-never-loads fix: tab loader writes liveUrlRef before replaceAsync commits, so fullscreen mount can see URL equality while player status is 'idle'/'error' — in that case force player.replace(url)+play() instead of just play().

## Stuck "Connecting to stream" on fullscreen expand
The fullscreen live screen mounts with `isBuffering=true` and clears it only on a `readyToPlay` event. When reusing the shared player that is ALREADY ready/playing (mini-player expand), no new event fires — overlay sticks forever. Rule: any overlay state on the fullscreen screen must be initialized/derived from the shared player's *current* state at mount, not from a future status event.

## Ambient NOW/NEXT strip removed (single bottom OSD)
The "mutually exclusive" ambient strip (!showInfo) overlapped the OSD's 300ms fade-out → users saw two stacked bottom overlays. Strip deleted; the full OSD info bar is the only bottom overlay. LiveChannelMenu is now wrapped in an error boundary (closes overlay on any render error) — a release-build JS error kills the whole app otherwise.

## OSD hide focus-safety (Aug 2026)
- When the OSD bar hides while a chip inside it holds D-pad focus, Fire OS spatially reassigns focus BEFORE any explicit focus() call. Focus the centre player target immediately at fade start (before unmount) and again afterward.
- Fire OS can still emit `onFocus` for a horizontal layout zone marked `focusable={false}`. Those LEFT/RIGHT zone handlers must therefore always bounce to the centre and must never contain channel-switch logic. Fullscreen live zapping belongs only to UP/DOWN and dedicated channel media keys.

## Channel-browser open crash (Aug 2026)
- Rule: never issue focus() at the player layer (tvCenterRef etc.) while the channel browser is open or opening — competing focus commands across the two layers hard-crashed Fire OS release builds when the menu appeared. Set showChannelMenuRef.current = true BEFORE dismissInfoBar() in every menu-open path, and gate all deferred OSD focus restores on that ref.
- Rule: any code inside a bare setTimeout (focus, scrollToIndex/scrollToOffset) must be try/catch-wrapped — timer exceptions bypass ErrorBoundaries and kill release builds.

## Fullscreen live BACK return
- Every live BACK must hand the currently active zapped channel (including its category) back to Live TV before collapse—not only Home-origin launches. On TV, resolve that channel through the virtualized channel-list focus routine so it selects the right category, scrolls to the row, highlights it, and retries focus until it mounts; the mini-player is only a fallback.
- **Why:** fullscreen state can diverge from its launch params after UP/DOWN zapping, and a generic collapse leaves the cursor on the old row or preview instead of the stream the viewer is now watching.

## Channel-list guide preview
- On TV, the mini guide follows the channel row currently under D-pad focus rather than the playing channel. This is browse-only: do not replace playback until OK is pressed; keep catch-up actions limited to the channel actually playing.
- **Why:** viewers need to inspect what is on another channel while scrolling without disrupting the current stream or accidentally opening catch-up for the wrong channel.

## Silent TV surface handoffs
- Fire TV live fullscreen ↔ mini-player transitions must not show “Connecting to stream” or “Loading…” cards. Reattaching a VLC surface can emit transient buffering even when the stream is healthy; clear stale buffering on collapse and keep TV live loading overlays hidden, while retaining real stream-error UI.
- **Why:** transition overlays obscure the picture and make an already-running channel feel slower without helping the viewer recover from an error.
