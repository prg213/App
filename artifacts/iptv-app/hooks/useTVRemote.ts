import { useEffect, useRef } from 'react';
import { DeviceEventEmitter, Platform } from 'react-native';
import { useIsFocused } from 'expo-router';

/**
 * Raw hardware key event delivered by react-native-tvos via
 * DeviceEventEmitter('onHWKeyEvent').
 *
 * eventKeyAction: 0 = key down, 1 = key up. Android TV remotes emit repeated
 * key-down events while a button is held; callers doing their own long-press
 * detection must de-dupe repeats themselves (see guide.tsx hold-timer).
 */
export interface TVRemoteKeyEvent {
  eventType: string;
  eventKeyAction: number;
}

export interface TVRemoteHandlers {
  /** Play/Pause media key. */
  playPause?: (e: TVRemoteKeyEvent) => void;
  onPlayPause?: (e: TVRemoteKeyEvent) => void;
  /** Channel Up key. */
  channelUp?: (e: TVRemoteKeyEvent) => void;
  onChannelUp?: (e: TVRemoteKeyEvent) => void;
  /** Channel Down key. */
  channelDown?: (e: TVRemoteKeyEvent) => void;
  onChannelDown?: (e: TVRemoteKeyEvent) => void;
  /** Fast Forward media key. */
  fastForward?: (e: TVRemoteKeyEvent) => void;
  onFastForward?: (e: TVRemoteKeyEvent) => void;
  /** Rewind media key. */
  rewind?: (e: TVRemoteKeyEvent) => void;
  onRewind?: (e: TVRemoteKeyEvent) => void;
  /** Menu key. */
  menu?: (e: TVRemoteKeyEvent) => void;
  onMenu?: (e: TVRemoteKeyEvent) => void;
}

/** Alias kept for callers that import the upstream name. */
export type HWKeyEvent = TVRemoteKeyEvent;
export type KeyAction = 0 | 1;

/**
 * #357: Shared TV remote media-key hook.
 *
 * Centralises the DeviceEventEmitter('onHWKeyEvent') subscription:
 * - Only runs on TV platforms (Platform.isTV).
 * - Only listens while the enclosing screen is focused (useIsFocused), so two
 *   screens never both react to the same key press.
 * - Handlers are kept in a ref, so callers do NOT need to memoize them.
 *
 * Handlers receive the raw `{ eventType, eventKeyAction }` event so they can
 * implement their own short/long-press detection (key down = 0, key up = 1).
 */
export function useTVRemote(handlers: TVRemoteHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const isFocused = useIsFocused();

  useEffect(() => {
    if (!Platform.isTV || !isFocused) return;
    const sub = DeviceEventEmitter.addListener(
      'onHWKeyEvent',
      (e: TVRemoteKeyEvent) => {
        const h = handlersRef.current;
        switch (e.eventType) {
          case 'playPause':   h.playPause?.(e);   h.onPlayPause?.(e);   break;
          case 'channelUp':   h.channelUp?.(e);   h.onChannelUp?.(e);   break;
          case 'channelDown': h.channelDown?.(e); h.onChannelDown?.(e); break;
          case 'fastForward': h.fastForward?.(e); h.onFastForward?.(e); break;
          case 'rewind':      h.rewind?.(e);      h.onRewind?.(e);      break;
          case 'menu':        h.menu?.(e);        h.onMenu?.(e);        break;
        }
      },
    );
    return () => sub.remove();
  }, [isFocused]);
}
