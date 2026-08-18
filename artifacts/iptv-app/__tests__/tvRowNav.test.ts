/**
 * Unit tests for lib/tvRowNav.ts — TV carousel row-navigation registry
 *
 * tvRowNav manages D-pad UP/DOWN routing between independently virtualised
 * horizontal FlatList carousels on Fire TV.  It keeps a per-row registry of
 * mounted cards (rowId → Map<index, node>) and, on every card focus, imperatively
 * sets nextFocusUp / nextFocusDown on the focused card's native node.
 *
 * Scenarios covered
 * ─────────────────
 * 1. register / unregister — register(rowId, index, node) stores node;
 *    register(rowId, index, null) removes it.
 * 2. Remembered index — lastIndex is updated on focused(); when focus returns
 *    to a row from another row the neighbour lookup uses that remembered index,
 *    not 0.
 * 3. Edge pinning — top-row cards get nextFocusUp === selfHandle;
 *    bottom-row cards get nextFocusDown === selfHandle (focus never escapes the
 *    dashboard vertically).
 * 4. Multi-row routing — focused card's nextFocusUp / nextFocusDown point at
 *    the correct neighbour-row remembered card.
 * 5. Empty-row skip — if an intermediate row has no mounted cards, the lookup
 *    skips to the next non-empty row.
 * 6. No-op without setNativeProps — registry operates without crashing when a
 *    node lacks setNativeProps.
 * 7. setOrder does not clobber existing card registrations.
 */

// ── Module isolation ──────────────────────────────────────────────────────────
// Each test re-imports the module after resetting so state from one describe
// block does not bleed into the next.  findNodeHandle is mocked to return a
// simple incrementing integer so we can assert on which handle was used.

beforeEach(() => {
  jest.resetModules();
});

// ── findNodeHandle mock ───────────────────────────────────────────────────────
// tvRowNav calls findNodeHandle(node) to obtain the native integer handle.
// We give every node a unique `.nodeHandle` property and return it.

function mockFindNodeHandle() {
  jest.doMock('react-native', () => ({
    findNodeHandle: (node: any) => (node ? (node.nodeHandle ?? null) : null),
  }));
}

/** Build a fake native node with setNativeProps spy and a given handle id. */
function makeNode(handle: number) {
  return {
    nodeHandle: handle,
    setNativeProps: jest.fn(),
  };
}

/** Import a fresh tvRowNav after mocks are set. */
function loadTvRowNav() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../lib/tvRowNav').tvRowNav as typeof import('../lib/tvRowNav')['tvRowNav'];
}

// =============================================================================
// 1. register / unregister
// =============================================================================

describe('tvRowNav — register / unregister', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('registers a node and it is available for focus wiring', () => {
    const nav = loadTvRowNav();
    const node = makeNode(1);
    nav.setOrder(['rowA']);
    nav.register('rowA', 0, node);
    // After focus(), setNativeProps should be called (it's registered)
    nav.focused('rowA', 0);
    expect(node.setNativeProps).toHaveBeenCalled();
  });

  it('unregisters a node when null is passed', () => {
    const nav = loadTvRowNav();
    const nodeA = makeNode(10);
    const nodeB = makeNode(11);
    nav.setOrder(['rowA', 'rowB']);
    nav.register('rowA', 0, nodeA);
    nav.register('rowB', 0, nodeB);

    // Focus rowB so it remembers nodeB
    nav.focused('rowB', 0);
    // Now remove nodeB
    nav.register('rowB', 0, null);

    // Re-focus rowA — neighbor lookup for rowB should find nothing,
    // so nextFocusDown must be pinned to selfHandle (rowA is now the bottom).
    nodeA.setNativeProps.mockClear();
    nav.focused('rowA', 0);

    const call = nodeA.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusDown).toBe(10); // pinned to self
  });

  it('creates a fresh row entry when registering to an unseen rowId', () => {
    const nav = loadTvRowNav();
    const node = makeNode(5);
    // Register without calling setOrder first
    nav.register('newRow', 0, node);
    nav.setOrder(['newRow']);
    nav.focused('newRow', 0);
    expect(node.setNativeProps).toHaveBeenCalled();
  });
});

// =============================================================================
// 2. Remembered index
// =============================================================================

describe('tvRowNav — remembered index', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('updates lastIndex when focused() is called', () => {
    const nav = loadTvRowNav();
    const n0 = makeNode(20);
    const n2 = makeNode(22);
    nav.setOrder(['rowA', 'rowB']);
    nav.register('rowA', 0, n0);
    nav.register('rowA', 2, n2);
    nav.register('rowB', 0, makeNode(30));

    // Focus index 2 in rowA
    nav.focused('rowA', 2);
    n2.setNativeProps.mockClear();

    // Now focus rowB — its nextFocusUp should point to rowA's lastIndex=2 (handle 22)
    const nB0 = makeNode(30);
    nav.register('rowB', 0, nB0);
    nav.focused('rowB', 0);

    const call = nB0.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(22); // rowA's remembered card at index 2
  });

  it('falls back to index 0 when the remembered card was unregistered', () => {
    const nav = loadTvRowNav();
    const n0 = makeNode(40);
    const n1 = makeNode(41);
    nav.setOrder(['rowA', 'rowB']);
    nav.register('rowA', 0, n0);
    nav.register('rowA', 1, n1);
    nav.register('rowB', 0, makeNode(50));

    // Focus rowA at index 1 — sets lastIndex = 1
    nav.focused('rowA', 1);

    // Unregister index 1 so the remembered card is gone
    nav.register('rowA', 1, null);

    // Focus rowB — neighbor lookup for rowA should fall back to n0 (index 0, handle 40)
    const nB0 = makeNode(50);
    nav.register('rowB', 0, nB0);
    nav.focused('rowB', 0);

    const call = nB0.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(40); // rowA's index-0 card (fallback)
  });
});

// =============================================================================
// 3. Edge pinning
// =============================================================================

describe('tvRowNav — edge pinning', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('pins nextFocusUp to self for the topmost row', () => {
    const nav = loadTvRowNav();
    const top = makeNode(100);
    nav.setOrder(['top', 'middle', 'bottom']);
    nav.register('top', 0, top);
    nav.register('middle', 0, makeNode(101));
    nav.register('bottom', 0, makeNode(102));

    nav.focused('top', 0);

    const call = top.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(100); // pinned to self
  });

  it('pins nextFocusDown to self for the bottommost row', () => {
    const nav = loadTvRowNav();
    const bottom = makeNode(200);
    nav.setOrder(['top', 'middle', 'bottom']);
    nav.register('top', 0, makeNode(201));
    nav.register('middle', 0, makeNode(202));
    nav.register('bottom', 0, bottom);

    nav.focused('bottom', 0);

    const call = bottom.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusDown).toBe(200); // pinned to self
  });

  it('pins both UP and DOWN to self when there is only one row', () => {
    const nav = loadTvRowNav();
    const only = makeNode(300);
    nav.setOrder(['solo']);
    nav.register('solo', 0, only);

    nav.focused('solo', 0);

    const call = only.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(300);
    expect(call.nextFocusDown).toBe(300);
  });
});

// =============================================================================
// 4. Multi-row routing
// =============================================================================

describe('tvRowNav — multi-row D-pad routing', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('routes nextFocusDown to the correct neighbouring row', () => {
    const nav = loadTvRowNav();
    const top    = makeNode(10);
    const middle = makeNode(20);
    nav.setOrder(['top', 'middle']);
    nav.register('top',    0, top);
    nav.register('middle', 0, middle);

    nav.focused('top', 0);
    const call = top.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusDown).toBe(20); // → middle row
  });

  it('routes nextFocusUp to the correct neighbouring row', () => {
    const nav = loadTvRowNav();
    const top    = makeNode(10);
    const bottom = makeNode(30);
    nav.setOrder(['top', 'bottom']);
    nav.register('top',    0, top);
    nav.register('bottom', 0, bottom);

    nav.focused('bottom', 0);
    const call = bottom.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(10); // → top row
  });

  it('wires both nextFocusUp and nextFocusDown for a middle row', () => {
    const nav = loadTvRowNav();
    const top    = makeNode(10);
    const mid    = makeNode(20);
    const bot    = makeNode(30);
    nav.setOrder(['top', 'mid', 'bottom']);
    nav.register('top',    0, top);
    nav.register('mid',    0, mid);
    nav.register('bottom', 0, bot);

    nav.focused('mid', 0);
    const call = mid.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(10);
    expect(call.nextFocusDown).toBe(30);
  });
});

// =============================================================================
// 5. Empty-row skip
// =============================================================================

describe('tvRowNav — empty-row skip', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('skips an empty intermediate row when resolving the next neighbour', () => {
    const nav = loadTvRowNav();
    const top    = makeNode(10);
    const bot    = makeNode(30);
    nav.setOrder(['top', 'empty', 'bottom']);
    nav.register('top',    0, top);
    // 'empty' row has no registered cards
    nav.register('bottom', 0, bot);

    // Focus top — nextFocusDown should skip 'empty' and point to 'bottom' (30)
    nav.focused('top', 0);
    const call = top.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusDown).toBe(30);
  });

  it('pins to self when all rows below are empty', () => {
    const nav = loadTvRowNav();
    const top = makeNode(10);
    nav.setOrder(['top', 'emptyA', 'emptyB']);
    nav.register('top', 0, top);
    // emptyA and emptyB have no cards

    nav.focused('top', 0);
    const call = top.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusDown).toBe(10); // pinned to self
  });
});

// =============================================================================
// 6. No-op without setNativeProps
// =============================================================================

describe('tvRowNav — graceful handling of nodes without setNativeProps', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('does not throw when a node has no setNativeProps method', () => {
    const nav = loadTvRowNav();
    const bare = { nodeHandle: 99 }; // no setNativeProps
    nav.setOrder(['rowA']);
    nav.register('rowA', 0, bare as any);

    expect(() => nav.focused('rowA', 0)).not.toThrow();
  });
});

// =============================================================================
// 7. setOrder does not clobber existing registrations
// =============================================================================

describe('tvRowNav — setOrder preserves card registrations', () => {
  beforeEach(() => { mockFindNodeHandle(); });

  it('cards registered before setOrder are still accessible after setOrder', () => {
    const nav = loadTvRowNav();
    const n = makeNode(77);
    nav.register('rowA', 0, n);

    // Declare order after registration (how the Home screen works —
    // cards mount before the useEffect that calls setOrder fires)
    nav.setOrder(['rowA']);
    nav.focused('rowA', 0);

    expect(n.setNativeProps).toHaveBeenCalled();
  });

  it('calling setOrder twice replaces the row order but keeps card data', () => {
    const nav = loadTvRowNav();
    const top = makeNode(1);
    const bot = makeNode(2);
    nav.setOrder(['top', 'bottom']);
    nav.register('top',    0, top);
    nav.register('bottom', 0, bot);

    // Swap the order — now 'bottom' is the top row
    nav.setOrder(['bottom', 'top']);

    // Focus 'bottom' (now the top row) — nextFocusUp must be pinned to self
    nav.focused('bottom', 0);
    const call = bot.setNativeProps.mock.calls[0][0];
    expect(call.nextFocusUp).toBe(2); // pinned to self (top of new order)
    expect(call.nextFocusDown).toBe(1); // → 'top' row (now below)
  });
});

// =============================================================================
// 8. Static layout audit — RecentChannelsRail vertical budget on TV
// =============================================================================

describe('TV Home layout — vertical budget audit', () => {
  let homeSrc: string;
  let railSrc: string;

  beforeAll(() => {
    const fs = require('fs');
    const path = require('path');
    homeSrc = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
    railSrc = fs.readFileSync(path.join(__dirname, '../components/RecentChannelsRail.tsx'), 'utf8');
  });

  it('TV root uses flex layout without a fixed height that could force overflow', () => {
    // tvRoot must NOT specify a numeric height (only flex:1 is safe)
    // We confirm the tvRoot style does not include `height:` (other than via flex)
    const tvRootBlock = homeSrc.match(/tvRoot:\s*\{[^}]+\}/)?.[0] ?? '';
    expect(tvRootBlock).not.toMatch(/height\s*:\s*\d/);
  });

  it('tvSection uses flex:1 with minHeight:0 so rows shrink without overflow', () => {
    const tvSectionBlock = homeSrc.match(/tvSection:\s*\{[^}]+\}/)?.[0] ?? '';
    expect(tvSectionBlock).toMatch(/flex\s*:\s*1/);
    expect(tvSectionBlock).toMatch(/minHeight\s*:\s*0/);
  });

  it('tvSectionBody uses flex:1 with minHeight:0 to pass height to the FlatList', () => {
    const block = homeSrc.match(/tvSectionBody:\s*\{[^}]+\}/)?.[0] ?? '';
    expect(block).toMatch(/flex\s*:\s*1/);
    expect(block).toMatch(/minHeight\s*:\s*0/);
  });

  it('tvRail uses flex:1 to fill the section body without a fixed height', () => {
    const block = homeSrc.match(/tvRail:\s*\{[^}]+\}/)?.[0] ?? '';
    expect(block).toMatch(/flex\s*:\s*1/);
    expect(block).not.toMatch(/height\s*:\s*\d/);
  });

  it('tvBannerOuter uses height:100% so cards fill the available row height', () => {
    const block = homeSrc.match(/tvBannerOuter:\s*\{[^}]+\}/)?.[0] ?? '';
    expect(block).toMatch(/height\s*:\s*['"]100%['"]/);
  });

  it('containerTV in RecentChannelsRail has compact padding so the rail stays slim', () => {
    // The style values are now driven by exported constants in lib/tvHomeLayout.ts.
    // Import the constants directly so a future numeric change updates both the
    // style and this assertion in lockstep.
    const {
      RAIL_TV_PADDING_TOP_EXTRA,
      RAIL_TV_PADDING_BOTTOM,
    } = require('../lib/tvHomeLayout');
    // paddingTop must be ≤ 4 and paddingBottom must be ≤ 6 so the rail
    // does not consume too much of the 540dp viewport
    expect(RAIL_TV_PADDING_TOP_EXTRA).toBeLessThanOrEqual(4);
    expect(RAIL_TV_PADDING_BOTTOM).toBeLessThanOrEqual(6);
  });

  it('focus ring borderWidth is at least 3dp for TV couch-distance visibility', () => {
    const block = homeSrc.match(/bannerFocused:\s*\{[^}]+\}/)?.[0] ?? '';
    const bw = parseInt(block.match(/borderWidth\s*:\s*(\d+)/)?.[1] ?? '0');
    expect(bw).toBeGreaterThanOrEqual(3);
  });

  it('TV section title font is at least 14dp for couch-distance legibility', () => {
    // fontSize is now driven by the exported constant TV_SECTION_TITLE_FONT_SIZE
    // in lib/tvHomeLayout.ts — assert against the constant directly.
    const { TV_SECTION_TITLE_FONT_SIZE } = require('../lib/tvHomeLayout');
    expect(TV_SECTION_TITLE_FONT_SIZE).toBeGreaterThanOrEqual(14);
  });
});
