import { useCallback } from 'react';
import { useTVRemote, type TVRemoteKeyEvent } from './useTVRemote';
import {
  playerNavigationController,
  type PlayerNavigationAction,
} from '@/lib/playerNavigationController';

type PlayerNavigationCallbacks = {
  onOpenControls?: () => void;
  onCloseLayer?: () => void;
  onSeekLeft?: () => void;
  onSeekRight?: () => void;
  onPreviousChannel?: () => void;
  onNextChannel?: () => void;
};

const isDown = (event: TVRemoteKeyEvent) => event.eventKeyAction === 0;

/**
 * Fire TV adapter for the player navigation state machine.
 *
 * This intentionally handles only the raw hardware fallback path. Native
 * spatial focus remains responsible for normal focus movement, preventing a
 * second D-pad implementation from fighting React Native TV focus.
 */
export function usePlayerNavigation(callbacks: PlayerNavigationCallbacks = {}) {
  const dispatch = useCallback((action: PlayerNavigationAction) => {
    const result = playerNavigationController.handle(action);

    switch (result.action) {
      case 'open':
        callbacks.onOpenControls?.();
        break;
      case 'close':
        callbacks.onCloseLayer?.();
        break;
      case 'seekLeft':
        callbacks.onSeekLeft?.();
        break;
      case 'seekRight':
        callbacks.onSeekRight?.();
        break;
      case 'previousChannel':
        callbacks.onPreviousChannel?.();
        break;
      case 'nextChannel':
        callbacks.onNextChannel?.();
        break;
    }

    return result;
  }, [callbacks]);

  const onLeft = useCallback((e: TVRemoteKeyEvent) => {
    if (isDown(e)) dispatch('left');
  }, [dispatch]);
  const onRight = useCallback((e: TVRemoteKeyEvent) => {
    if (isDown(e)) dispatch('right');
  }, [dispatch]);
  const onUp = useCallback((e: TVRemoteKeyEvent) => {
    if (isDown(e)) dispatch('up');
  }, [dispatch]);
  const onDown = useCallback((e: TVRemoteKeyEvent) => {
    if (isDown(e)) dispatch('down');
  }, [dispatch]);
  const onSelect = useCallback((e: TVRemoteKeyEvent) => {
    if (isDown(e)) dispatch('ok');
  }, [dispatch]);

  const onBack = useCallback(() => dispatch('back'), [dispatch]);

  useTVRemote({ left: onLeft, right: onRight, up: onUp, down: onDown, select: onSelect });

  return { dispatch, onBack };
}
