import { useCallback, useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

/** 0 = keydown, 1 = keyup */
export type KeyAction = 0 | 1;

export interface HWKeyEvent {
  eventType: string;
  eventKeyAction: KeyAction;
}

export interface TVRemoteHandlers {
  /**
   * Play/Pause media key on the Firestick/Android TV remote.
   * eventKeyAction 0 = keydown, 1 = keyup (confirmed press).
   * For long-press detection: arm a timer on keydown, commit or cancel on keyup.
   */
  onPlayPause?: (e: HWKeyEvent) => void;
  /** Channel Up key (dedicated channel-change remotes). */
  onChannelUp?: (e: HWKeyEvent) => void;
  /** Channel Down key (dedicated channel-change remotes). */
  onChannelDown?: (e: HWKeyEvent) => void;
  /** Fast Forward key (some Firestick remotes). */
  onFastForward?: (e: HWKeyEvent) => void;
  /** Rewind key (some Firestick remotes). */
  onRewind?: (e: HWKeyEvent) => void;
  /** Menu key. */
  onMenu?: (e: HWKeyEvent) => void;
}

/**
 * Subscribe to hardware media-key events from a Firestick / Android TV remote,
 * active ONLY while this screen has focus.
 *
 * Handles: Play/Pause, Channel Up/Down, Fast Forward, Rewind, Menu.
 * D-pad (UP/DOWN/LEFT/RIGHT/OK) is handled by the native spatial-focus engine.
 * BACK is handled by useBackHandler / BackHandler.
 * Never intercept D-pad or BACK here.
 *
 * Focus tracking uses useFocusEffect (from expo-router) so the subscription
 * never fires while another screen is in the foreground.
 *
 * This is a no-op on phones/tablets (Platform.isTV === false).
 *
 * @example
 *   useTVRemote({
 *     onPlayPause: ({ eventKeyAction }) => {
 *       if (eventKeyAction === 1) togglePlay(); // key-up = confirmed single press
 *     },
 *     onChannelUp:   ({ eventKeyAction }) => { if (eventKeyAction === 1) nextChannel(); },
 *     onChannelDown: ({ eventKeyAction }) => { if (eventKeyAction === 1) prevChannel(); },
 *     onFastForward: ({ eventKeyAction }) => { if (eventKeyAction === 1) seek(+30); },
 *     onRewind:      ({ eventKeyAction }) => { if (eventKeyAction === 1) seek(-30); },
 *   });
 */
export function useTVRemote(handlers: TVRemoteHandlers): void {
  // Track focus via a ref so the DeviceEventEmitter callback (set up once in
  // useEffect) always sees the current focused state without being re-registered
  // on every focus change.
  const isFocusedRef = useRef(false);
  // Keep handlers in a ref so the listener closure never goes stale.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => { isFocusedRef.current = false; };
    }, []),
  );

  useEffect(() => {
    // No-op on phones/tablets.
    if (!Platform.isTV) return;

    const sub = DeviceEventEmitter.addListener(
      'onHWKeyEvent',
      (e: HWKeyEvent) => {
        // Guard: silently drop events when this screen is not focused.
        if (!isFocusedRef.current) return;
        const h = handlersRef.current;
        switch (e.eventType) {
          case 'playPause':   h.onPlayPause?.(e);   break;
          case 'channelUp':   h.onChannelUp?.(e);   break;
          case 'channelDown': h.onChannelDown?.(e); break;
          case 'fastForward': h.onFastForward?.(e); break;
          case 'rewind':      h.onRewind?.(e);      break;
          case 'menu':        h.onMenu?.(e);        break;
        }
      },
    );
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
