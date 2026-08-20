/**
 * Regression guards for Android IPTV streams carrying MPEG audio layer II.
 *
 * Some providers expose an audio track but do not mark it as selected. The
 * player must explicitly select a default/first track and keep audio focus.
 */

import * as fs from 'fs';
import * as path from 'path';

const playerSource = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');
const liveContextSource = fs.readFileSync(path.resolve(__dirname, '../context/LivePlayerContext.tsx'), 'utf8');

describe('MP2 audio playback', () => {
  it('explicitly selects a default or first reported audio track', () => {
    expect(playerSource).toContain('tracks.find((track) => track.isDefault)');
    expect(playerSource).toContain('player.audioTrack = fallbackAudioTrack');
    expect(playerSource).toContain('player.audioTrack ?? fallbackAudioTrack');
  });

  it('uses doNotMix audio output for fullscreen and shared live players', () => {
    expect((playerSource.match(/p\.audioMixingMode = 'doNotMix'/g) ?? [])).toHaveLength(1);
    expect((liveContextSource.match(/p\.audioMixingMode = 'doNotMix'/g) ?? [])).toHaveLength(1);
  });

  it('does not start either player muted or at zero volume', () => {
    expect(playerSource).toContain('p.muted = false');
    expect(playerSource).toContain('p.volume = 1');
    expect(liveContextSource).toContain('p.muted = false');
    expect(liveContextSource).toContain('p.volume = 1');
  });
});