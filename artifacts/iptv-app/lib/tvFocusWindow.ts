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
  fallbackVisibleRows = 5,
): number {
  if (!Number.isFinite(rowHeight) || rowHeight <= 0) return 0;

  const measuredVisibleRows = Math.floor(viewportHeight / rowHeight);
  const visibleRows = measuredVisibleRows >= 1
    ? measuredVisibleRows
    : Math.max(1, Math.floor(fallbackVisibleRows));
  const firstVisibleIndex = Math.max(0, Math.floor(index) - visibleRows + 1);

  return firstVisibleIndex * rowHeight;
}