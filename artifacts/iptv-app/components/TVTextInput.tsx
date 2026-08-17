/**
 * TVTextInput — drop-in replacement for <TextInput focusable …> that works
 * correctly on both Android phone and Amazon Firestick / Android TV.
 *
 * ── Phone ─────────────────────────────────────────────────────────────────
 * Renders a plain TextInput — identical to current behaviour. No wrapper,
 * no extra Views, no changed props. Existing keyboard / focus behaviour is
 * completely preserved.
 *
 * ── TV (Firestick / Android TV) ───────────────────────────────────────────
 * On Android TV, D-pad navigation moves focus by calling requestFocus().
 * For EditText (TextInput) this places the cursor but does NOT open the
 * system keyboard — only a programmatic .focus() call triggers showSoftInput.
 *
 * Pattern used:
 *  1. A FocusablePressable wrapper captures D-pad focus + shows the cyan ring.
 *  2. OK (DPAD_CENTER) fires onPress → .focus() on inner TextInput → keyboard.
 *  3. Inner TextInput has focusable={false} — only the wrapper is in the
 *     D-pad focus graph.
 *  4. TextInput onBlur / onSubmitEditing → restore D-pad focus to wrapper
 *     so the user is not stranded after dismissing the keyboard.
 *
 * Usage — identical to TextInput:
 *   <TVTextInput
 *     focusable
 *     style={styles.input}
 *     value={query}
 *     onChangeText={setQuery}
 *     returnKeyType="search"
 *     onSubmitEditing={handleSearch}
 *     placeholder="Search…"
 *     placeholderTextColor={colors.mutedForeground}
 *   />
 */
import React, { forwardRef, useRef } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { FocusablePressable } from './FocusablePressable';
import { requestTvFocus } from '@/lib/tvFocus';

export interface TVTextInputProps extends TextInputProps {
  /**
   * Style applied to the TV wrapper on D-pad focus.
   * Defaults to the standard 2px #00E5FF cyan ring.
   * Pass `{}` to suppress.  No effect on phone.
   */
  focusedStyle?: StyleProp<ViewStyle>;
}

/**
 * Overrides applied to the inner TextInput on TV only.
 * The wrapper already renders the border, background, borderRadius and
 * padding from `style`.  Resetting them on the inner TextInput prevents a
 * double-border / double-padding artefact.  flex:1 fills the wrapper.
 * Text-only props (color, fontSize, fontFamily) are preserved because they
 * are not listed here and continue to come from the merged style array.
 */
const TV_INNER_RESET = StyleSheet.create({
  reset: {
    borderWidth: 0,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    padding: 0,
    backgroundColor: 'transparent',
    flex: 1,
  },
}).reset;

const TV_FOCUSED = StyleSheet.create({
  ring: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
}).ring;

export const TVTextInput = forwardRef<TextInput, TVTextInputProps>(
  function TVTextInput(
    { style, focusable, focusedStyle, onBlur, onSubmitEditing, ...props },
    forwardedRef,
  ) {
    const inputRef = useRef<TextInput>(null);
    const wrapperRef = useRef<View>(null);

    // Merge forwarded ref with internal ref so callers that store ref={inputRef}
    // can still call inputRef.current?.focus() etc. from outside.
    const ref = (forwardedRef as React.RefObject<TextInput> | null) ?? inputRef;

    // ── Phone / tablet ────────────────────────────────────────────────────
    if (!Platform.isTV) {
      return (
        <TextInput
          ref={ref}
          focusable={focusable}
          style={style}
          onBlur={onBlur}
          onSubmitEditing={onSubmitEditing}
          {...props}
        />
      );
    }

    // ── TV (Firestick / Android TV) ───────────────────────────────────────
    // After keyboard dismiss or submit, put D-pad focus back on the wrapper.
    // 150 ms lets the keyboard close animation complete before requesting focus.
    const restoreWrapperFocus = () =>
      setTimeout(() => requestTvFocus(wrapperRef.current), 150);

    return (
      <FocusablePressable
        ref={wrapperRef as React.Ref<View>}
        // Apply full style to the wrapper so it provides the visual container
        // (flex, border, background, borderRadius, padding).
        // Cast: TextInput style is StyleProp<TextStyle>; FocusablePressable
        // expects StyleProp<ViewStyle>. The layout subset used here (flex,
        // border, padding, borderRadius, backgroundColor) is structurally
        // identical between the two and renders correctly on Android.
        style={style as unknown as StyleProp<ViewStyle>}
        // Cyan ring on D-pad focus; caller may override or suppress.
        focusedStyle={focusedStyle !== undefined ? focusedStyle : TV_FOCUSED}
        // OK press → programmatic .focus() → Android TV shows keyboard.
        onPress={() => ref.current?.focus()}
      >
        <TextInput
          ref={ref}
          focusable={false}   // wrapper handles D-pad; TextInput is keyboard-only
          showSoftInputOnFocus // explicit — some Fire OS builds ignore default true
          // Same style as wrapper but with visual-container props reset so we
          // don't double-render borders / padding inside the wrapper.
          style={[style, TV_INNER_RESET]}
          onBlur={(e) => {
            onBlur?.(e);
            restoreWrapperFocus();
          }}
          onSubmitEditing={(e) => {
            onSubmitEditing?.(e);
            restoreWrapperFocus();
          }}
          {...props}
        />
      </FocusablePressable>
    );
  },
);
