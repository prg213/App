/**
 * Calculates the vertical list offset that keeps a TV D-pad focus window
 * stable. Focus can move through every visible row before the list advances;
 * once it reaches the bottom edge, each next row shifts the viewport by one
 * item so the focused row stays at that edge.
 */
export function computeTvVerticalFocusOffset(
  index: number,
  rowHeight: number,
  viewportHeight: number,
  currentOffset = 0,
  fallbackVisibleRows = 5,
): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return 0;

  const measuredVisibleRows = Math.floor(viewportHeight / rowHeight);
  const visibleRows = measuredVisibleRows >= 1
    ? measuredVisibleRows
    : Math.max(1, Math.floor(fallbackVisibleRows));
  const focusedIndex = Math.max(0, Math.floor(index));
  // Keep the current focus window stable while focus moves inside it. The
  // viewport only advances when focus crosses an edge, which prevents UP from
  // scrolling the column while the highlight is still moving through visible
  // rows.
  const currentFirstVisibleIndex = Math.max(
    0,
    Math.round(
      (Number.isFinite(currentOffset) ? Math.max(0, currentOffset) : 0) / rowHeight,
    ),
  );
  const currentLastVisibleIndex = currentFirstVisibleIndex + visibleRows - 1;
  const firstVisibleIndex = focusedIndex < currentFirstVisibleIndex
    ? focusedIndex
    : focusedIndex > currentLastVisibleIndex
      ? focusedIndex - visibleRows + 1
      : currentFirstVisibleIndex;

  return firstVisibleIndex * rowHeight;
}