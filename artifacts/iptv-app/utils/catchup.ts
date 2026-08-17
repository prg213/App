import type { Channel, EpgProgram } from '../types';

/**
 * Returns true only when the channel explicitly has tvArchive === 1.
 *
 * Strict equality is intentional: 0, undefined, and any other value must keep
 * catch-up completely disabled. Do not widen this to `>= 1` or `!!tvArchive`.
 */
export function channelHasCatchup(channel: Channel | null | undefined): boolean {
  return channel?.tvArchive === 1;
}

/**
 * Returns true when a past mini-guide row should be pressable for catch-up
 * playback. All four conditions must hold simultaneously.
 *
 * @param prog           The EPG programme row.
 * @param nowTs          Current epoch ms.
 * @param isTV           Mirrors Platform.isTV.
 * @param hasCatchup     Result of channelHasCatchup(selectedChannel).
 * @param hasCallback    Whether an onOpenCatchupProg callback was supplied.
 */
export function isCatchupRowPlayable(
  prog: EpgProgram,
  nowTs: number,
  isTV: boolean,
  hasCatchup: boolean,
  hasCallback: boolean,
): boolean {
  const isPast = prog.end.getTime() <= nowTs;
  return isTV && isPast && hasCatchup && hasCallback;
}

