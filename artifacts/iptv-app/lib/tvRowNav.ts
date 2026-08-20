/**
 * TV carousel row navigation registry.
 *
 * Fire OS's native spatial focus engine cannot reliably move UP/DOWN between
 * independently virtualised horizontal FlatLists (same limitation as the EPG
 * grid): the "nearest" view it finds may be offscreen, unmounted, or in the
 * wrong row, making focus jump erratically or disappear entirely.
 *
 * This module keeps a per-screen registry of carousel rows in visual order.
 * Every card registers its native node by (rowId, index); whenever a card
 * gains focus we imperatively set its nextFocusUp / nextFocusDown to the
 * neighbouring row's REMEMBERED card (the one last focused in that row —
 * standard TV-dashboard behaviour, like Netflix/Prime rails), falling back
 * to the row's first mounted card.  At the top/bottom edge the direction is
 * pinned to the card itself so focus can never escape the dashboard.
 *
 * Generation tracking
 * ───────────────────
 * `rows` is a module-level singleton that persists across React navigations.
 * Card refs unmount cleanly (register null), but if a virtualiser recycles a
 * native node without an unmount/remount cycle `findNodeHandle` may return a
 * stale integer that no longer maps to a visible view.
 *
 * To guard against this, `setOrder` bumps a monotonic `generation` counter.
 * Each `Row` records the generation in which it last received a registration.
 * The neighbour-lookup in `focused()` skips any row whose stored generation is
 * older than the current one, treating its handles as potentially stale.
 *
 * The Home screen's `useEffect` cleanup also calls `clearRow` for every row it
 * owns, so the registry is always fresh when the screen remounts.
 */
import { findNodeHandle } from 'react-native';

interface Row {
  cards: Map<number, any>;
  lastIndex: number;
  /** Generation in which the most recent card was registered. */
  gen: number;
}

const rows = new Map<string, Row>();
let rowOrder: string[] = [];
/** Monotonically increasing; bumped every time setOrder is called. */
let generation = 0;

function getRow(rowId: string): Row {
  let r = rows.get(rowId);
  if (!r) {
    r = { cards: new Map(), lastIndex: 0, gen: generation };
    rows.set(rowId, r);
  }
  return r;
}

/**
 * Explicitly link a newly mounted card to its immediate siblings.
 *
 * A FlatList can focus its first card before the next item has mounted. If the
 * second card registers later, relying on the first card's next onFocus event
 * leaves RIGHT to Fire OS spatial navigation, which can jump past that card.
 * Rewiring both sides at registration keeps every mounted pair sequential.
 */
function wireHorizontalSiblings(row: Row, index: number) {
  const self = row.cards.get(index);
  if (!self) return;
  const selfHandle = findNodeHandle(self);
  if (selfHandle == null) return;

  const previous = index > 0 ? row.cards.get(index - 1) : null;
  const next = row.cards.get(index + 1);
  const previousHandle = previous ? findNodeHandle(previous) : null;
  const nextHandle = next ? findNodeHandle(next) : null;

  try {
    // Preserve index 0's declarative LEFT route to the sidebar.
    if (previousHandle != null) {
      (self as any).setNativeProps?.({ nextFocusLeft: previousHandle });
      (previous as any).setNativeProps?.({ nextFocusRight: selfHandle });
    }
    if (nextHandle != null) {
      (self as any).setNativeProps?.({ nextFocusRight: nextHandle });
      (next as any).setNativeProps?.({ nextFocusLeft: selfHandle });
    }
  } catch {}
}

export const tvRowNav = {
  /**
   * Declare the vertical order of rows for the current screen.
   * Bumps the generation counter so handles registered in a previous
   * session are ignored until they re-register in this one.
   *
   * Rows that still have mounted cards (non-empty after a re-render) are
   * immediately promoted to the new generation so that calling setOrder more
   * than once during the same mount (e.g., React re-renders) does not
   * invalidate currently-valid handles.  Only rows that were explicitly
   * cleared via clearRow() — and therefore have no cards — remain at gen=0
   * and are treated as stale until a card re-registers in them.
   */
  setOrder(ids: string[]) {
    generation += 1;
    rowOrder = ids;
    // Promote any row that still has registered cards to the new generation.
    // Cleared rows (cards.size === 0) keep their gen=0 and stay stale.
    for (const r of rows.values()) {
      if (r.cards.size > 0) {
        r.gen = generation;
      }
    }
  },

  /** Callback-ref helper: register/unregister a card's native node. */
  register(rowId: string, index: number, node: any | null) {
    const r = getRow(rowId);
    if (node) {
      r.cards.set(index, node);
      // Mark this row as current-generation so neighbour lookup trusts it.
      r.gen = generation;
      wireHorizontalSiblings(r, index);
    } else {
      r.cards.delete(index);
    }
  },

  /**
   * Remove all card registrations for a single row.
   * Call this from a `useEffect` cleanup so that when the Home screen
   * unmounts (or re-mounts after navigation) the registry starts fresh
   * rather than potentially holding stale native handles.
   */
  clearRow(rowId: string) {
    const r = rows.get(rowId);
    if (r) {
      r.cards.clear();
      r.lastIndex = 0;
      // Reset gen so this row is treated as stale until re-registered.
      r.gen = 0;
    }
  },

  /**
   * Pin the right edge of a row: call on the last card's onFocus so that
   * RIGHT never wraps back to the first card.  Safe to call on every focus
   * event for that card — it's idempotent.
   */
  pinRightEdge(rowId: string, index: number) {
    const r = rows.get(rowId);
    const node = r?.cards.get(index);
    if (!node) return;
    try {
      const h = findNodeHandle(node);
      if (h != null) (node as any).setNativeProps?.({ nextFocusRight: h });
    } catch {}
  },

  /**
   * Call from the card's onFocus. Records the row's position and wires the
   * focused card's UP/DOWN to the adjacent rows' same-column cards. If the
   * destination row is shorter, the nearest mounted card at or before that
   * column is used. `pinRightEdge` makes the right-edge guard part of the
   * same native patch as sibling routing, avoiding a transient FlatList wrap.
   */
  focused(rowId: string, index: number, options?: { pinRightEdge?: boolean }) {
    const r = rows.get(rowId);
    if (!r) return;
    r.lastIndex = index;
    const self = r.cards.get(index);
    if (!self) return;
    const selfHandle = findNodeHandle(self);
    if (selfHandle == null) return;

    const pos = rowOrder.indexOf(rowId);
    const neighborHandle = (dir: 1 | -1): number | null => {
      for (let i = pos + dir; i >= 0 && i < rowOrder.length; i += dir) {
        const n = rows.get(rowOrder[i]);
        // Skip rows with no cards, or rows whose last registration was in a
        // previous generation (their native handles may be stale/recycled).
        if (!n || n.cards.size === 0 || n.gen < generation) continue;
        // Home is a 4-column × 3-row TV grid. Preserve the focused column
        // when moving vertically instead of jumping to the destination row's
        // last remembered card. A shorter row clamps to its nearest available
        // column.
        const target =
          n.cards.get(index) ??
          [...n.cards.keys()]
            .filter((cardIndex) => cardIndex <= index)
            .sort((a, b) => b - a)
            .map((cardIndex) => n.cards.get(cardIndex))
            .find(Boolean) ??
          n.cards.get(0) ??
          n.cards.values().next().value;
        if (target) {
          const h = findNodeHandle(target);
          if (h != null) return h;
        }
      }
      return null;
    };

    try {
      const patch: Record<string, number> = {
        // Pin to self at the edges so focus never leaves the dashboard
        // vertically (LEFT on first card still exits to the sidebar).
        nextFocusUp: neighborHandle(-1) ?? selfHandle,
        nextFocusDown: neighborHandle(1) ?? selfHandle,
      };

      // Fire OS often cannot infer the neighbour inside a virtualised
      // horizontal FlatList. Wire mounted siblings explicitly, while leaving
      // an unmounted direction untouched so FlatList can still scroll and
      // mount it naturally. The first card's LEFT is intentionally not
      // overwritten — Home supplies its sidebar target declaratively.
      const previous = index > 0 ? r.cards.get(index - 1) : null;
      const next = r.cards.get(index + 1);
      const previousHandle = previous ? findNodeHandle(previous) : null;
      const nextHandle = next ? findNodeHandle(next) : null;
      if (previousHandle != null) patch.nextFocusLeft = previousHandle;
      if (options?.pinRightEdge) patch.nextFocusRight = selfHandle;
      else if (nextHandle != null) patch.nextFocusRight = nextHandle;

      (self as any).setNativeProps?.(patch);
    } catch {}
  },

  /**
   * Return the card node for a row.  When `index` is omitted (or the card at
   * that index is unmounted), falls back to the row's lastIndex, then card 0.
   * Returns null when the row is unknown or has no mounted cards.
   */
  getCard(rowId: string, index?: number): any | null {
    const r = rows.get(rowId);
    if (!r || r.cards.size === 0) return null;
    if (index !== undefined) {
      const c = r.cards.get(index);
      if (c) return c;
    }
    return (
      r.cards.get(r.lastIndex) ??
      r.cards.get(0) ??
      r.cards.values().next().value ??
      null
    );
  },

  /** Return the lastIndex recorded for a row, or 0 if the row is unknown. */
  getLastIndex(rowId: string): number {
    return rows.get(rowId)?.lastIndex ?? 0;
  },
};
