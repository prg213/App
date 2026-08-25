import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../app/(tabs)/index.tsx'), 'utf8');

describe('first-channel native mini-player binding', () => {
  it('forces the initial native VLC binding when no live URL exists', () => {
    const start = source.indexOf('const handleSelectChannel = useCallback');
    const end = source.indexOf('const handleToggleFav', start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    expect(body).toMatch(/USES_NATIVE_VLC && !liveUrlRef\.current/);
    expect(body).toMatch(/setNativeSurfaceUrl\(ch\.streamUrl\)/);
    expect(body).toMatch(/setVlcReloadKey\(\(key\) => key \+ 1\)/);
  });
});
