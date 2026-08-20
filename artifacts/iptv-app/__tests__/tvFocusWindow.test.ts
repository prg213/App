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

  it('uses a safe focus window before the list has reported its height', () => {
    expect(computeTvVerticalFocusOffset(4, 58, 0)).toBe(0);
    expect(computeTvVerticalFocusOffset(5, 58, 0)).toBe(58);
  });
});