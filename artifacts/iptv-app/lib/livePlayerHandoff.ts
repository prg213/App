import type { Channel } from '@/types';

// A fullscreen player can be opened from Home before the Live TV tab has
// mounted. Keep its one-time return target outside either screen so the
// category, mini-player, and selected row can still be restored on BACK.
let pendingLivePlayerReturn: Channel | null = null;

export function setPendingLivePlayerReturn(channel: Channel) {
  pendingLivePlayerReturn = channel;
}

export function getPendingLivePlayerReturn() {
  return pendingLivePlayerReturn;
}

export function consumePendingLivePlayerReturn() {
  const channel = pendingLivePlayerReturn;
  pendingLivePlayerReturn = null;
  return channel;
}