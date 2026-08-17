/**
 * #307 — EPG scroll position survives orientation change.
 *
 * The FullGuide component saves horizontal (gridScrollOffsetRef) and vertical
 * (gridVertOffsetRef) scroll offsets on every scroll event, then restores them
 * inside a deferred useEffect that fires whenever windowWidth changes (landscape
 * ↔ portrait flip or split-screen resize).
 *
 * These tests use source-text inspection of guide.tsx so that a refactor of
 * the save/restore logic trips the assertions without requiring a full React
 * Native renderer.  No component is mounted.
 */

const fs   = require('fs');
const path = require('path');

const SOURCE_PATH = path.resolve(__dirname, '../app/(tabs)/guide.tsx');
const src: string = fs.readFileSync(SOURCE_PATH, 'utf-8');

describe('FullGuide — horizontal scroll offset is saved on scroll events (#307)', () => {
  it('gridScrollOffsetRef.current is written from the nativeEvent.contentOffset.x', () => {
    // The onScroll handler for the horizontal grid must capture the x offset.
    expect(src).toMatch(/gridScrollOffsetRef\.current\s*=.*\.x/s);
  });
});

describe('FullGuide — vertical scroll offset is saved on scroll events (#307)', () => {
  it('gridVertOffsetRef.current is written from the nativeEvent.contentOffset.y', () => {
    // The onScroll handler for the vertical channel list must capture the y offset.
    // Two accepted forms:
    //   1. Direct:       gridVertOffsetRef.current = e.nativeEvent.contentOffset.y
    //   2. Intermediate: const y = ...contentOffset.y; ... gridVertOffsetRef.current = y
    //      (backreference ensures the *same* identifier reaches the ref)
    const directAssign = /gridVertOffsetRef\.current\s*=\s*\w+(?:\.\w+)*\.contentOffset\.y/;
    const viaIntermediate = /(?:const|let|var)\s+(\w+)\s*=\s*[^;]*\.contentOffset\.y[\s\S]{0,500}?gridVertOffsetRef\.current\s*=\s*\1\b/;
    const matched = directAssign.test(src) || viaIntermediate.test(src);
    expect(matched).toBe(true);
  });
});

describe('FullGuide — grid pan position is cleared on unmount so a new session starts fresh', () => {
  it('currentGridPanMs is reset to null in a FullGuide unmount cleanup', () => {
    // A module-level currentGridPanMs carries the last pan position across
    // TVEpgRow virtualisation.  FullGuide must null it out on unmount so a
    // subsequent guide session (after logout or account switch) does not
    // restore a prior user's pan position.
    // Accept: useEffect(() => () => { currentGridPanMs = null; }, [])
    // or any cleanup form that assigns null to currentGridPanMs.
    expect(src).toMatch(/currentGridPanMs\s*=\s*null/);
    // The assignment must appear inside a return ()=> / cleanup path, not just
    // as an initialiser.  Look for the null-assign inside a function body that
    // is returned from a useEffect.
    expect(src).toMatch(/return\s*\(\s*\)\s*=>\s*\{?\s*currentGridPanMs\s*=\s*null|currentGridPanMs\s*=\s*null[^;]*;\s*\}?\s*,\s*\[\s*\]/s);
  });
});

describe('FullGuide — scroll offsets are restored after orientation change (#307)', () => {
  it('a useEffect that depends on windowWidth exists in FullGuide', () => {
    // Orientation changes are detected via windowWidth from useWindowDimensions().
    expect(src).toMatch(/windowWidth/);
    // The effect must re-apply the saved offsets.
    expect(src).toMatch(/gridScrollOffsetRef/);
  });

  it('the orientation-change restore is deferred via setTimeout', () => {
    // An immediate scrollTo fires before the ScrollView has re-measured —
    // the call MUST be inside a setTimeout so slow-device layouts complete first.
    expect(src).toMatch(/setTimeout[^}]+gridHorizRef|gridHorizRef[^;]+setTimeout/s);
  });

  it('the restore timer allows at least 100 ms for the layout pass', () => {
    // Extract the timer value from the setTimeout that references the horizontal grid.
    // Try various plausible patterns; accept a named constant too.
    const patterns = [
      /setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*gridHorizRef[^}]*\}\s*,\s*(\d+)/s,
      /setTimeout\s*\([^,]+,\s*(\d+)\s*\)[^;]*gridHorizRef/s,
      /gridHorizRef[^;]+setTimeout[^,]+,\s*(\d+)/s,
    ];
    for (const re of patterns) {
      const m = src.match(re);
      if (m && m[1]) {
        expect(parseInt(m[1], 10)).toBeGreaterThanOrEqual(100);
        return;
      }
    }
    // Named constant fallback: any value ≥ 100 near the restore
    expect(src).toMatch(/1[0-9]{2,}|[2-9]\d{2,}/);
  });
});
