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
 */
import { findNodeHandle } from 'react-native';

interface Row {
  cards: Map<number, any>;
  lastIndex: number;
}

const rows = new Map<string, Row>();
let rowOrder: string[] = [];

function getRow(rowId: string): Row {
  let r = rows.get(rowId);
  if (!r) {
    r = { cards: new Map(), lastIndex: 0 };
    rows.set(rowId, r);
  }
  return r;
}

export const tvRowNav = {
  /** Declare the vertical order of rows for the current screen. */
  setOrder(ids: string[]) {
    rowOrder = ids;
  },

  /** Callback-ref helper: register/unregister a card's native node. */
  register(rowId: string, index: number, node: any | null) {
    const r = getRow(rowId);
    if (node) r.cards.set(index, node);
    else r.cards.delete(index);
  },

  /**
   * Call from the card's onFocus.  Records the row's position and wires the
   * focused card's UP/DOWN to the adjacent rows' remembered cards.
   */
  focused(rowId: string, index: number) {
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
        if (!n || n.cards.size === 0) continue;
        const target =
          n.cards.get(n.lastIndex) ??
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
      (self as any).setNativeProps?.({
        // Pin to self at the edges so focus never leaves the dashboard
        // vertically (LEFT on first card still exits to the sidebar).
        nextFocusUp: neighborHandle(-1) ?? selfHandle,
        nextFocusDown: neighborHandle(1) ?? selfHandle,
      });
    } catch {}
  },
};
