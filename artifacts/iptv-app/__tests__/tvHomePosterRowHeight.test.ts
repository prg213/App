/**
 * Layout safety test: TV Home poster-card height at 600dp usable height.
 *
 * WHY THIS TEST EXISTS
 * ────────────────────
 * Some Fire OS launchers inject a semi-transparent top bar (~40dp), reducing
 * usable viewport height from the nominal 640dp (720p, no system chrome) to
 * ~600dp.  The TV Home dashboard divides all remaining space between poster
 * rows using flex:1, so a future style change (larger rail, bigger section
 * headers, extra margins) could silently push a poster card below the ~80dp
 * legibility floor.  This test catches that before it ships.
 *
 * APPROACH
 * ────────
 * RNTL / Yoga does not run in Jest — component rendering yields no real layout
 * numbers.  Instead the test imports the same exported constants that home.tsx
 * and RecentChannelsRail.tsx use for their styles, then replicates the flex
 * arithmetic performed by Yoga at runtime.  Any style change that would shrink
 * a poster card below 80dp will also break this test.
 *
 * LAYOUT MODEL
 * ────────────
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  tvRoot  (TV_ROOT_PADDING_TOP + TV_ROOT_PADDING_BOTTOM) │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  RecentChannelsRail (intrinsic — not a flex child)      │
 *   │    → RAIL_TV_INTRINSIC_HEIGHT                           │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  Section  (flex:1, TV_SECTION_MARGIN_TOP each)   × N   │
 *   │    tvSectionHeader  (TV_SECTION_HEADER_H)               │
 *   │    tvSectionBody    (flex:1)                            │
 *   │      FlatList contentContainerStyle                     │
 *   │        paddingVertical: TV_BANNER_LIST_PADDING_VERTICAL │
 *   │      → poster card: height = '100%' inside container   │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Poster card height = sectionBodyH − 2 × TV_BANNER_LIST_PADDING_VERTICAL
 *
 * SCENARIOS COVERED
 * ─────────────────
 *   • Worst case: 3 flex sections (CW + Movies + Shows), 600dp usable
 *   • Comfortable margin: card stays well above 100dp (style-erosion detector)
 *   • 2 flex sections: card height check when Continue Watching is absent
 *   • Nominal 640dp: no launcher bar, all 3 sections
 *   • Pessimistic rail: rail grows by 20dp (future padding increase guard)
 *   • Constant sanity: derived values align with the source-file exports
 */

import {
  TV_ROOT_PADDING_TOP,
  TV_ROOT_PADDING_BOTTOM,
  TV_SECTION_MARGIN_TOP,
  TV_SECTION_TITLE_FONT_SIZE,
  TV_SECTION_HEADER_MARGIN_BOTTOM,
  TV_BANNER_LIST_PADDING_VERTICAL,
  RAIL_TV_INTRINSIC_HEIGHT,
  TV_SECTION_HEADER_H,
  computeTvPosterCardHeight,
} from '../lib/tvHomeLayout';

// ─── Scenario constants ───────────────────────────────────────────────────────

/**
 * 720p (640dp) minus a 40dp Fire OS launcher top bar.
 * The "ultra-compact" case this test is named after.
 */
const USABLE_HEIGHT_COMPACT = 600; // dp

/**
 * Legibility floor: a banner card shorter than this is unusable on a
 * 720p TV at normal viewing distance.
 */
const MIN_CARD_HEIGHT = 80; // dp

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TV Home poster-card height at 600dp (ultra-compact Fire TV skin)', () => {

  // ── Worst case: all three flex sections ─────────────────────────────────────

  it('3 flex sections: each poster card is >= 80dp at 600dp usable height', () => {
    const cardH = computeTvPosterCardHeight(USABLE_HEIGHT_COMPACT, 3);
    expect(cardH).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  it('3 flex sections: poster card is comfortably above 100dp — catches style erosion early', () => {
    // A comfortable margin above the floor lets us detect style changes that
    // erode the gap without immediately crossing 80dp.
    const cardH = computeTvPosterCardHeight(USABLE_HEIGHT_COMPACT, 3);
    expect(cardH).toBeGreaterThan(100);
  });

  // ── Two flex sections (Continue Watching absent) ─────────────────────────────

  it('2 flex sections: each poster card is >= 80dp at 600dp usable height', () => {
    const cardH = computeTvPosterCardHeight(USABLE_HEIGHT_COMPACT, 2);
    expect(cardH).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  // ── Nominal 720p without launcher bar ───────────────────────────────────────

  it('3 flex sections: each poster card is >= 80dp at nominal 640dp (no launcher bar)', () => {
    const cardH = computeTvPosterCardHeight(640, 3);
    expect(cardH).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  // ── Pessimistic rail — guards against the rail growing by up to 20dp ────────

  it('3 flex sections: poster card stays >= 80dp even if the RecentChannelsRail grows by 20dp', () => {
    const cardH = computeTvPosterCardHeight(
      USABLE_HEIGHT_COMPACT,
      3,
      RAIL_TV_INTRINSIC_HEIGHT + 20,
    );
    expect(cardH).toBeGreaterThanOrEqual(MIN_CARD_HEIGHT);
  });

  // ── Derived constant sanity — verifies the formula against the source exports ─

  it('tvRoot total vertical padding equals TV_ROOT_PADDING_TOP + TV_ROOT_PADDING_BOTTOM', () => {
    expect(TV_ROOT_PADDING_TOP + TV_ROOT_PADDING_BOTTOM).toBe(12);
  });

  it('TV_SECTION_MARGIN_TOP is 4dp (per tvSection style)', () => {
    expect(TV_SECTION_MARGIN_TOP).toBe(4);
  });

  it('TV_BANNER_LIST_PADDING_VERTICAL is 3dp — the focus-ring clearance inset', () => {
    // Cards use height:'100%' inside the FlatList contentContainer.
    // This 3dp inset on each side means effective poster height =
    // sectionBodyH − 6 (not just sectionBodyH).  Changing this value
    // without updating the constant will break this test.
    expect(TV_BANNER_LIST_PADDING_VERTICAL).toBe(3);
  });

  it('TV_SECTION_HEADER_H is positive and accounts for font size and margin', () => {
    // TV_SECTION_HEADER_H = ceil(fontSize × 1.4) + marginBottom
    // = ceil(13 × 1.4) + 3 = 19 + 3 = 22
    expect(TV_SECTION_HEADER_H).toBeGreaterThan(0);
    // TV_SECTION_HEADER_H = ceil(TV_SECTION_TITLE_FONT_SIZE × 1.4) + TV_SECTION_HEADER_MARGIN_BOTTOM
    expect(TV_SECTION_HEADER_H).toBeGreaterThanOrEqual(TV_SECTION_TITLE_FONT_SIZE + TV_SECTION_HEADER_MARGIN_BOTTOM);
  });

  it('RAIL_TV_INTRINSIC_HEIGHT is plausible (40–120dp)', () => {
    expect(RAIL_TV_INTRINSIC_HEIGHT).toBeGreaterThan(40);
    expect(RAIL_TV_INTRINSIC_HEIGHT).toBeLessThan(120);
  });

  it('MIN_CARD_HEIGHT constant is 80dp', () => {
    expect(MIN_CARD_HEIGHT).toBe(80);
  });
});
