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
  it('keeps the standard player awake while mounted', () => {
    expect(playerSource).toContain("import { useKeepAwake } from 'expo-keep-awake'");
    expect(playerSource).toContain("useKeepAwake('streamvault-playback')");
  });

  it('keeps the Android/VLC player awake while mounted', () => {
    expect(androidPlayerSource).toContain("import { useKeepAwake } from 'expo-keep-awake'");
    expect(androidPlayerSource).toContain("useKeepAwake('streamvault-playback')");
  });
});