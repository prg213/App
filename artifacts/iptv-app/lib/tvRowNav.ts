/**
 * TV carousel row navigation registry.
 *
 * Fire OS's native spatial focus engine cannot reliably move UP/DOWN between
 * independently virtualised horizontal FlatLists. This module keeps a per-screen
 * registry of carousel rows and explicitly wires mounted neighbours.
 */
import { findNodeHandle } from 'react-native';
import { registerLegacyTvFocus, setLegacyTvFocus, unregisterLegacyTvFocus } from './fireTvNavigationCompat';

interface Row {
  cards: Map<number, any>;
  lastIndex: number;
  gen: number;
}

const rows = new Map<string, Row>();
let rowOrder: string[] = [];
let generation = 0;

function getRow(rowId: string): Row {
  let r = rows.get(rowId);
  if (!r) {
    r = { cards: new Map(), lastIndex: 0, gen: generation };
    rows.set(rowId, r);
  }
  return r;
}

function focusId(rowId: string, index: number) {
  return `home:${rowId}:${index}`;
}

function wireHorizontalSiblings(row: Row, rowId: string, index: number) {
  const self = row.cards.get(index);
  if (!self) return;
  const selfHandle = findNodeHandle(self);
  if (selfHandle == null) return;

  const previous = index > 0 ? row.cards.get(index - 1) : null;
  const next = row.cards.get(index + 1);
  const previousHandle = previous ? findNodeHandle(previous) : null;
  const nextHandle = next ? findNodeHandle(next) : null;

  try {
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
  setOrder(ids: string[]) {
    generation += 1;
    rowOrder = ids;
    for (const r of rows.values()) {
      if (r.cards.size > 0) r.gen = generation;
    }
  },

  register(rowId: string, index: number, node: any | null) {
    const r = getRow(rowId);
    const id = focusId(rowId, index);
    if (node) {
      r.cards.set(index, node);
      r.gen = generation;
      const handle = findNodeHandle(node);
      registerLegacyTvFocus(id, 'content', handle);
      wireHorizontalSiblings(r, rowId, index);
    } else {
      r.cards.delete(index);
      unregisterLegacyTvFocus(id);
    }
  },

  clearRow(rowId: string) {
    const r = rows.get(rowId);
    if (r) {
      for (const index of r.cards.keys()) {
        unregisterLegacyTvFocus(focusId(rowId, index));
      }
      r.cards.clear();
      r.lastIndex = 0;
      r.gen = 0;
    }
  },

  pinRightEdge(rowId: string, index: number) {
    const r = rows.get(rowId);
    const node = r?.cards.get(index);
    if (!node) return;
    try {
      const h = findNodeHandle(node);
      if (h != null) (node as any).setNativeProps?.({ nextFocusRight: h });
    } catch {}
  },

  focused(rowId: string, index: number, options?: { pinRightEdge?: boolean }) {
    const r = rows.get(rowId);
    if (!r) return;
    r.lastIndex = index;
    const self = r.cards.get(index);
    if (!self) return;
    const selfHandle = findNodeHandle(self);
    if (selfHandle == null) return;

    // Publish Home's current focus to the global controller. The native
    // nextFocus wiring below remains responsible for the actual spatial move.
    setLegacyTvFocus(focusId(rowId, index));

    const pos = rowOrder.indexOf(rowId);
    const neighborHandle = (dir: 1 | -1): number | null => {
      for (let i = pos + dir; i >= 0 && i < rowOrder.length; i += dir) {
        const n = rows.get(rowOrder[i]);
        if (!n || n.cards.size === 0 || n.gen < generation) continue;
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
        nextFocusUp: neighborHandle(-1) ?? selfHandle,
        nextFocusDown: neighborHandle(1) ?? selfHandle,
      };
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

  getCard(rowId: string, index?: number): any | null {
    const r = rows.get(rowId);
    if (!r || r.cards.size === 0) return null;
    if (index !== undefined) {
      const c = r.cards.get(index);
      if (c) return c;
    }
    return r.cards.get(r.lastIndex) ?? r.cards.get(0) ?? r.cards.values().next().value ?? null;
  },

  getLastIndex(rowId: string): number {
    return rows.get(rowId)?.lastIndex ?? 0;
  },
};
