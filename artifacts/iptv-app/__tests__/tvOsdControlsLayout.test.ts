import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.resolve(__dirname, '../app/player.tsx'), 'utf8');

describe('TV live OSD controls layout', () => {
  it('keeps TV controls out of the channel metadata row', () => {
    const infoBarRegion = source.slice(
      source.indexOf('{/* ── Live TV info bar'),
      source.indexOf('{/* Programme progress bar'),
    );

    expect(infoBarRegion).toContain('<View style={styles.infoTvControls}>');
    expect(infoBarRegion).toMatch(/!Platform\.isTV[\s\S]*backBtnSmall/);
    expect(infoBarRegion).toMatch(/infoTvControls[\s\S]*backBtnSmall/);
  });

  it('allows the dedicated controls row to fit narrow TV viewports', () => {
    expect(source).toContain('flexWrap: \'wrap\'');
    expect(source).toContain('maxWidth: 180');
    expect(source).toContain('numberOfLines={1} ellipsizeMode="tail"');
  });
});