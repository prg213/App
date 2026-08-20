/**
 * Regression guard — switchChannel must always call replace then play,
 * unconditionally, regardless of the current player status.
 *
 * Background
 * ──────────
 * The zap/channel-switch path in player.tsx calls player.replace() then
 * player.play() inside a plain try/catch.  If a status guard (e.g.
 * `if (player.status !== 'idle')`) were ever added before those calls,
 * a mid-idle zap — triggered immediately after a failed stream — could
 * silently drop the switch: replace() would be skipped while the player
 * is idle, leaving the user stuck on a broken stream.
 *
 * These tests confirm that no such conditional guard exists in the
 * switchChannel body between the try-block opener and the replace/play
 * pair, and that replace always precedes play.
 *
 * All tests use source-text inspection of player.tsx — no native modules
 * required, consistent with the rest of this test suite.
 */

const fs   = require('fs');
const path = require('path');

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Locate the switchChannel body ─────────────────────────────────────────────
// Anchor on the useCallback signature that starts switchChannel.
const SC_ANCHOR = 'const switchChannel = useCallback((entry: ChannelEntry, newIdx: number, isWrapAround = false) => {';

function getSwitchChannelBody(): string {
  const start = player.indexOf(SC_ANCHOR);
  if (start === -1) throw new Error('switchChannel anchor not found in player.tsx');

  // Use the next declaration as the boundary. The dependency list is an
  // implementation detail and may legitimately grow when a channel switch
  // needs to keep another playback surface in sync.
  const closeMarker = '  const navCooldownRef = useRef(false);';
  const end = player.indexOf(closeMarker, start);
  if (end === -1) throw new Error('switchChannel closing deps marker not found in player.tsx');

  return player.slice(start, end + closeMarker.length);
}

// ── Locate the try block inside switchChannel ─────────────────────────────────
// The try block wraps the player.replace / player.play pair.
function getTryBlock(body: string): string {
  const tryPos = body.indexOf('try {');
  if (tryPos === -1) throw new Error('try block not found in switchChannel body');

  // Extract from `try {` to `} catch {}`
  const catchPos = body.indexOf('} catch {}', tryPos);
  if (catchPos === -1) throw new Error('} catch {} not found after try block in switchChannel');

  return body.slice(tryPos, catchPos + '} catch {}'.length);
}

// =============================================================================
// 1. replace() and play() both exist inside switchChannel
// =============================================================================

describe('switchChannel — replace and play are present', () => {
  it('calls player.replace() inside switchChannel', () => {
    const body = getSwitchChannelBody();
    expect(body).toMatch(/player\.replace\s*\(/);
  });

  it('calls player.play() inside switchChannel', () => {
    const body = getSwitchChannelBody();
    expect(body).toMatch(/player\.play\s*\(\s*\)/);
  });
});

// =============================================================================
// 2. replace() precedes play() in the try block
// =============================================================================

describe('switchChannel — replace is called before play', () => {
  it('player.replace appears before player.play in the try block', () => {
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    const replacePos = tryBlock.indexOf('player.replace(');
    const playPos    = tryBlock.indexOf('player.play()');

    expect(replacePos).toBeGreaterThan(-1);
    expect(playPos).toBeGreaterThan(-1);
    expect(replacePos).toBeLessThan(playPos);
  });

  it('replace is called with the new channel URL (entry.url)', () => {
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    expect(tryBlock).toMatch(/player\.replace\s*\(\s*entry\.url\s*\)/);
  });
});

// =============================================================================
// 3. No status/idle guard suppresses the replace call
// =============================================================================

describe('switchChannel — no idle/playing guard before replace', () => {
  it('the try block does not gate replace on player.status', () => {
    // Any `if (… player.status …)` that wraps player.replace() inside the
    // try block would risk silently dropping the switch when the player is idle.
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    // Find the replace call
    const replacePos = tryBlock.indexOf('player.replace(');
    expect(replacePos).toBeGreaterThan(-1);

    // Extract everything between `try {` and `player.replace(` — no status
    // guard should appear in that window.
    const beforeReplace = tryBlock.slice(0, replacePos);
    expect(beforeReplace).not.toMatch(/player\.status/);
    expect(beforeReplace).not.toMatch(/\.status\s*===?\s*['"]idle['"]/);
    expect(beforeReplace).not.toMatch(/\.status\s*===?\s*['"]playing['"]/);
    expect(beforeReplace).not.toMatch(/\.status\s*!==?\s*['"]idle['"]/);
  });

  it('the try block does not gate replace on player.playing', () => {
    // An `if (!player.playing)` guard before replace() would cause the
    // switch to be skipped when the player happens to be already playing —
    // or conversely when it is idle but the guard is inverted.
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    const replacePos = tryBlock.indexOf('player.replace(');
    expect(replacePos).toBeGreaterThan(-1);

    const beforeReplace = tryBlock.slice(0, replacePos);
    expect(beforeReplace).not.toMatch(/player\.playing/);
    expect(beforeReplace).not.toMatch(/!player\.playing/);
  });

  it('replace and play are not wrapped in a conditional inside the try block', () => {
    // The call sequence must be flat — both statements reachable on every
    // execution of the try block, not inside an if-branch.
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    // Count `if (` occurrences before the replace call (the liveUrlRef guard
    // `if (isLive)` is the only allowed one).
    const replacePos    = tryBlock.indexOf('player.replace(');
    const beforeReplace = tryBlock.slice(0, replacePos);

    // The only `if` allowed before replace is the `if (isLive)` liveUrlRef sync
    const ifMatches = (beforeReplace.match(/\bif\s*\(/g) ?? []).length;
    expect(ifMatches).toBeLessThanOrEqual(1);

    // And that one `if` must be the liveUrlRef guard, not a status check
    if (ifMatches === 1) {
      expect(beforeReplace).toMatch(/if\s*\(\s*isLive\s*\)/);
    }
  });
});

// =============================================================================
// 4. The try/catch structure is intact (replace/play not outside a catch path)
// =============================================================================

describe('switchChannel — try/catch wraps the replace+play pair', () => {
  it('player.replace and player.play are inside the try block', () => {
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    expect(tryBlock).toMatch(/player\.replace\s*\(\s*entry\.url\s*\)/);
    expect(tryBlock).toMatch(/player\.play\s*\(\s*\)/);
  });

  it('the catch block is empty — errors are swallowed, not re-thrown', () => {
    // An empty catch ensures a player API hiccup (e.g. the native player
    // rejecting replace while idle) never crashes the JS thread.
    const body     = getSwitchChannelBody();
    const tryBlock = getTryBlock(body);

    // The catch block must be `} catch {}` with nothing inside
    expect(tryBlock).toMatch(/\}\s*catch\s*\{\s*\}/);
  });
});
