import fs from 'fs';
import path from 'path';

const playerSource = fs.readFileSync(
  path.resolve(__dirname, '../components/NativeStreamPlayer.tsx'),
  'utf8',
);
const androidPlayerSource = fs.readFileSync(
  path.resolve(__dirname, '../components/NativeStreamPlayer.android.tsx'),
  'utf8',
);

describe('stream playback wake lock', () => {
  it('keeps the standard player awake with a per-surface tag', () => {
    expect(playerSource).toContain("import { useKeepAwake } from 'expo-keep-awake'");
    expect(playerSource).toContain('useKeepAwake();');
    expect(playerSource).not.toContain('streamvault-playback');
  });

  it('keeps the Android/VLC player awake with a per-surface tag', () => {
    expect(androidPlayerSource).toContain("import { useKeepAwake } from 'expo-keep-awake'");
    expect(androidPlayerSource).toContain('useKeepAwake();');
    expect(androidPlayerSource).not.toContain('streamvault-playback');
  });
});