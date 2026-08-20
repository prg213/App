/**
 * Shared layout constants for the TV Home dashboard.
 *
 * These values are consumed by:
 *   - app/(tabs)/home.tsx          (tvRoot, tvSection, tvSectionHeader, tvBannerList styles)
 *   - components/RecentChannelsRail.tsx (containerTV, sectionHeaderTV, logoWrap styles)
 *
 * Keeping them here means any layout-affecting change is made in one place and
 * is immediately reflected in the layout-safety test at
 *   __tests__/tvHomePosterRowHeight.test.ts
 *
 * ─── Layout model (TV branch) ────────────────────────────────────────────────
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  tvRoot  (paddingTop + paddingBottom)                   │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  RecentChannelsRail  (intrinsic — not flex)             │
 *   │    paddingTop (topInset + RAIL_TV_PADDING_TOP_EXTRA)    │
 *   │    sectionHeader (fontSize + marginBottom)              │
 *   │    FlatList with card height RAIL_TV_CARD_HEIGHT        │
 *   │    paddingBottom + border                               │
 *   ├─────────────────────────────────────────────────────────┤
 *   │  Section (flex:1, marginTop each)     ×N               │
 *   │    tvSectionHeader (title + marginBottom)               │
 *   │    tvSectionBody (flex:1)                               │
 *   │      FlatList contentContainerStyle paddingVertical     │
 *   │      → poster card fills remaining height               │
 *   └─────────────────────────────────────────────────────────┘
 */

// ─── tvRoot ───────────────────────────────────────────────────────────────────
export const TV_ROOT_PADDING_TOP    = 4;   // home.tsx › tvRoot.paddingTop
export const TV_ROOT_PADDING_BOTTOM = 8;   // home.tsx › tvRoot.paddingBottom

// ─── tvSection ────────────────────────────────────────────────────────────────
export const TV_SECTION_MARGIN_TOP  = 4;   // home.tsx › tvSection.marginTop

// ─── tvSectionHeader ─────────────────────────────────────────────────────────
export const TV_SECTION_HEADER_MARGIN_BOTTOM = 3;  // home.tsx › tvSectionHeader.marginBottom
export const TV_SECTION_TITLE_FONT_SIZE      = 15; // home.tsx › tvSectionTitle.fontSize
export const TV_HOME_GRID_COLUMNS            = 4;  // target visible poster columns on TV

// ─── tvBannerList (poster FlatList content container) ────────────────────────
// 3dp on each side (top + bottom) = 6dp total, giving focus-ring clearance so
// the ring is not flush against the FlatList clip boundary.
export const TV_BANNER_LIST_PADDING_VERTICAL = 3;  // home.tsx › tvBannerList.paddingVertical
export const TV_BANNER_LIST_PADDING_HORIZONTAL = 14; // home.tsx › tvBannerList.paddingHorizontal
export const TV_BANNER_LIST_GAP = 8;               // home.tsx › tvBannerList.gap

// ─── RecentChannelsRail (TV) ──────────────────────────────────────────────────
// Extra paddingTop added on TV after the safe-area topInset (which is 0 on TV).
export const RAIL_TV_PADDING_TOP_EXTRA      = 2;   // RecentChannelsRail.tsx › inline paddingTop offset
export const RAIL_TV_PADDING_BOTTOM         = 4;   // RecentChannelsRail.tsx › containerTV.paddingBottom
export const RAIL_TV_HEADER_MARGIN_BOTTOM   = 4;   // RecentChannelsRail.tsx › sectionHeaderTV.marginBottom
export const RAIL_TV_HEADER_FONT_SIZE       = 9;   // RecentChannelsRail.tsx › sectionTitle.fontSize
export const RAIL_TV_CARD_HEIGHT            = 50;  // RecentChannelsRail.tsx › logoWrap.height

// hairlineWidth is platform-specific (~0.5–1dp).  Use 1 for layout arithmetic.
export const RAIL_TV_BORDER_WIDTH_APPROX    = 1;

// ─── Derived helpers ─────────────────────────────────────────────────────────

/**
 * Conservative estimate of the RecentChannelsRail's intrinsic height on TV.
 *
 * Uses ceil(fontSize × 1.4) for header line-height — the 1.4× multiplier is
 * deliberately pessimistic so the layout-safety test remains valid even if the
 * platform rounds the line height up further than the typical 1.2× default.
 */
export const RAIL_TV_HEADER_LINE_HEIGHT =
  Math.ceil(RAIL_TV_HEADER_FONT_SIZE * 1.4); // ceil(12.6) = 13

export const RAIL_TV_INTRINSIC_HEIGHT =
  RAIL_TV_PADDING_TOP_EXTRA +
  RAIL_TV_HEADER_LINE_HEIGHT + RAIL_TV_HEADER_MARGIN_BOTTOM +
  RAIL_TV_CARD_HEIGHT +
  RAIL_TV_PADDING_BOTTOM +
  RAIL_TV_BORDER_WIDTH_APPROX; // 2 + 13 + 4 + 50 + 4 + 1 = 74

/**
 * Conservative estimate of section-title line height.
 * Same 1.4× multiplier as the rail header.
 */
export const TV_SECTION_TITLE_LINE_HEIGHT =
  Math.ceil(TV_SECTION_TITLE_FONT_SIZE * 1.4); // ceil(18.2) = 19

/** Total height consumed by one tvSectionHeader (title text + bottom margin). */
export const TV_SECTION_HEADER_H =
  TV_SECTION_TITLE_LINE_HEIGHT + TV_SECTION_HEADER_MARGIN_BOTTOM; // 19 + 3 = 22

/**
 * Keep the focused card inside a four-column TV rail window.
 *
 * Cards 0–3 stay at the initial offset. Focusing card 4 advances the row by
 * one card, so the focused card appears in the fourth visible position rather
 * than making every RIGHT press move the row.
 */
export function computeTvRailFocusOffset(
  index: number,
  itemStride: number,
  visibleColumns: number = TV_HOME_GRID_COLUMNS,
): number {
  const firstVisibleIndex = Math.max(0, index - Math.max(1, visibleColumns) + 1);
  return firstVisibleIndex * itemStride;
}

/**
 * Compute the rendered poster-card height for a TV Home dashboard row.
 *
 * This is the height a banner card actually gets, accounting for:
 *   1. Root container vertical padding
 *   2. RecentChannelsRail intrinsic height (not a flex child)
 *   3. Per-section top margins
 *   4. Section header heights
 *   5. tvBannerList vertical padding inside the FlatList content container
 *      (cards use height:'100%' inside this container, so paddingVertical
 *       reduces their effective height by 2 × TV_BANNER_LIST_PADDING_VERTICAL)
 *
 * @param usableHeight   Viewport height available to the tvRoot View (dp)
 * @param nSections      Number of visible flex sections (1–3)
 * @param railHeight     Override for RAIL_TV_INTRINSIC_HEIGHT (default: constant above)
 */
export function computeTvPosterCardHeight(
  usableHeight: number,
  nSections: number,
  railHeight: number = RAIL_TV_INTRINSIC_HEIGHT,
): number {
  const afterRootPad  = usableHeight - (TV_ROOT_PADDING_TOP + TV_ROOT_PADDING_BOTTOM);
  const afterRail     = afterRootPad - railHeight;
  const flexPool      = afterRail - nSections * TV_SECTION_MARGIN_TOP;
  const sectionTotal  = flexPool / nSections;
  const sectionBodyH  = sectionTotal - TV_SECTION_HEADER_H;
  // Cards use height:'100%' relative to tvSectionBody, but the FlatList
  // contentContainerStyle applies paddingVertical on both sides.
  const posterCardH   = sectionBodyH - 2 * TV_BANNER_LIST_PADDING_VERTICAL;
  return posterCardH;
}

/**
 * Keep poster cards compact when optional Home rows are absent.
 *
 * The visible section bodies still flex across the full screen, but their
 * posters should be sized as if the dashboard had its normal number of layout
 * slots. This prevents Movies/Series from growing to two-across cards when
 * Recently Watched and Continue Watching are both empty.
 */
export function computeTvGridCardHeight(
  bodyHeight: number,
  actualSectionCount: number,
  layoutSlotCount: number,
): number {
  if (actualSectionCount <= 0 || layoutSlotCount <= 0) return 1;
  const sectionBodyHeight =
    ((bodyHeight + TV_SECTION_HEADER_H) * actualSectionCount / layoutSlotCount)
    - TV_SECTION_HEADER_H;
  return Math.max(1, Math.round(sectionBodyHeight - 2 * TV_BANNER_LIST_PADDING_VERTICAL));
}

/**
 * Give shorter synchronized Home rails the same scrollable width as the
 * longest rail. Without this trailing space, FlatList clamps a short rail
 * before its sibling rows and their card columns no longer line up.
 */
export function computeTvRailTrailingSpacerWidth(
  itemCount: number,
  sharedColumnCount: number,
  itemStride: number,
  itemGap: number,
): number {
  const missingColumns = Math.max(0, sharedColumnCount - itemCount);
  if (missingColumns === 0) return 0;
  // The footer is a FlatList child, so the list inserts one item gap before
  // it. Subtract that gap to make its total extent match a full rail, whose
  // final card has no trailing gap.
  return Math.max(0, missingColumns * itemStride - itemGap);
}
