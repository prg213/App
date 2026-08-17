
## Fire OS declarative nextFocus / ref.focus() unreliability (Aug 2026)
- Declarative nextFocusLeft/etc. props on Pressable and bare ref.focus() can silently no-op on Fire OS. FocusablePressable now re-applies any numeric nextFocus* handles via setNativeProps in an effect (~100 ms after mount), and sidebarNav.focus() toggles hasTVPreferredFocus true→false via setNativeProps in addition to focus(). Use these imperative patterns for any new TV focus routing.
