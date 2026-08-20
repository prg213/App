import { computeTvVerticalFocusOffset } from '../lib/tvFocusWindow';

describe('TV vertical focus window', () => {
  it('holds the viewport until focus reaches the last visible row', () => {
    const rowHeight = 58;
    const sixRowsHigh = rowHeight * 6;

    expect(computeTvVerticalFocusOffset(0, rowHeight, sixRowsHigh)).toBe(0);
    expect(computeTvVerticalFocusOffset(5, rowHeight, sixRowsHigh)).toBe(0);
    expect(computeTvVerticalFocusOffset(6, rowHeight, sixRowsHigh)).toBe(rowHeight);
    expect(computeTvVerticalFocusOffset(8, rowHeight, sixRowsHigh)).toBe(rowHeight * 3);
  });

  it('holds the current window while moving UP through visible rows', () => {
    const rowHeight = 58;
    const sixRowsHigh = rowHeight * 6;
    const currentOffset = rowHeight * 5;

    // The visible window is rows 5–10. Moving upward within that window must
    // not scroll it prematurely.
    expect(computeTvVerticalFocusOffset(9, rowHeight, sixRowsHigh, currentOffset))
      .toBe(currentOffset);
    expect(computeTvVerticalFocusOffset(5, rowHeight, sixRowsHigh, currentOffset))
      .toBe(currentOffset);
    // Only the row above the top edge advances the window.
    expect(computeTvVerticalFocusOffset(4, rowHeight, sixRowsHigh, currentOffset))
      .toBe(rowHeight * 4);
  });

  it('also advances one row at a time when DOWN crosses the bottom edge', () => {
    const rowHeight = 58;
    const sixRowsHigh = rowHeight * 6;
    const currentOffset = rowHeight * 5;

    expect(computeTvVerticalFocusOffset(10, rowHeight, sixRowsHigh, currentOffset))
      .toBe(currentOffset);
    expect(computeTvVerticalFocusOffset(11, rowHeight, sixRowsHigh, currentOffset))
      .toBe(rowHeight * 6);
  });

  it('uses a safe focus window before the list has reported its height', () => {
    expect(computeTvVerticalFocusOffset(4, 58, 0)).toBe(0);
    expect(computeTvVerticalFocusOffset(5, 58, 0)).toBe(58);
  });
});