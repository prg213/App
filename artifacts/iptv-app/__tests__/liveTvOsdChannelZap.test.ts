/**
 * Regression guard: a visible, user-pinned Live TV OSD must not suppress
 * D-pad UP/DOWN channel zapping. The channel browser and track pickers are
 * still modal surfaces and retain exclusive D-pad control.
 */

import * as fs from 'fs';
import * as path from 'path';

const PLAYER = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');

describe('Live TV OSD vertical channel zapping', () => {
  it('keeps UP/DOWN zapping active while the info bar is visible', () => {
    const remoteStart = PLAYER.indexOf('useTVRemote({');
    const remoteEnd = PLAYER.indexOf('onFastForward:', remoteStart);
    expect(remoteStart).toBeGreaterThan(-1);
    expect(remoteEnd).toBeGreaterThan(remoteStart);

    const remoteHandlers = PLAYER.slice(remoteStart, remoteEnd);
    expect(remoteHandlers).toMatch(/up:\s*\(\{ eventKeyAction \}\)[\s\S]*?handleNextChannel\(\)/);
    expect(remoteHandlers).toMatch(/down:\s*\(\{ eventKeyAction \}\)[\s\S]*?handlePrevChannel\(\)/);
    expect(remoteHandlers).not.toMatch(/infoBarUserInvokedRef\.current\s*&&\s*showInfoRef\.current/);
  });

  it('continues to protect the channel browser and Audio/CC pickers', () => {
    const remoteStart = PLAYER.indexOf('useTVRemote({');
    const remoteEnd = PLAYER.indexOf('onFastForward:', remoteStart);
    const remoteHandlers = PLAYER.slice(remoteStart, remoteEnd);

    expect(remoteHandlers).toMatch(
      /showChannelMenuRef\.current\s*\|\|\s*showAudioPickerRef\.current\s*\|\|\s*showSubPickerRef\.current/,
    );
  });

  it('does not make the horizontal player zones focusable', () => {
    const zonesStart = PLAYER.indexOf('{/* ── TV / Fire TV D-pad zones');
    const previewStart = PLAYER.indexOf('{Platform.isTV && isLive && !hasError && !isWeb && tvPreviewChannel');
    expect(zonesStart).toBeGreaterThan(-1);
    expect(previewStart).toBeGreaterThan(zonesStart);

    const zones = PLAYER.slice(zonesStart, previewStart);
    expect(zones).toMatch(/focusable=\{false\}[\s\S]*style=\{styles\.tvZoneLeft\}/);
    expect(zones).toMatch(/focusable=\{false\}[\s\S]*style=\{styles\.tvZoneRight\}/);
  });

  it('keeps LEFT and RIGHT inert even if Fire OS focuses their layout zones', () => {
    const leftStart = PLAYER.indexOf('{/* Left third — transparent layout layer only.');
    const centerStart = PLAYER.indexOf('{/* Centre — explicit focus target;', leftStart);
    const rightStart = PLAYER.indexOf('{/* Right third — transparent layout layer only.');
    const indicatorsStart = PLAYER.indexOf('{/* ── TV zone focus indicators', rightStart);
    expect(leftStart).toBeGreaterThan(-1);
    expect(centerStart).toBeGreaterThan(leftStart);
    expect(rightStart).toBeGreaterThan(centerStart);
    expect(indicatorsStart).toBeGreaterThan(rightStart);

    const leftZone = PLAYER.slice(leftStart, centerStart);
    const rightZone = PLAYER.slice(rightStart, indicatorsStart);
    for (const zone of [leftZone, rightZone]) {
      expect(zone).toMatch(/requestTvFocus\(tvCenterRef\.current\)/);
      expect(zone).not.toMatch(/handleNextChannel|handlePrevChannel|showTvChannelPreview|switchChannel/);
    }
  });
});