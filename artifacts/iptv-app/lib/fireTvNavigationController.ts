import { Platform } from 'react-native';

type Direction = 'up' | 'down' | 'left' | 'right';
type FocusZone = 'sidebar' | 'content' | 'modal' | 'player';

export type TvFocusEntry = {
  id: string;
  zone: FocusZone;
  node: number | null;
  enabled?: boolean;
};

/**
 * Small, deterministic registry used by Fire TV screens.
 * It does not replace screen-specific navigation models; it gives them one
 * place to register focus targets and a consistent way to resolve targets.
 */
class FireTvNavigationController {
  private entries = new Map<string, TvFocusEntry>();
  private currentId: string | null = null;

  register(entry: TvFocusEntry) {
    if (!entry.id) return;
    this.entries.set(entry.id, { ...entry, enabled: entry.enabled !== false });
  }

  unregister(id: string) {
    this.entries.delete(id);
    if (this.currentId === id) this.currentId = null;
  }

  setEnabled(id: string, enabled: boolean) {
    const entry = this.entries.get(id);
    if (entry) this.entries.set(id, { ...entry, enabled });
  }

  setCurrent(id: string | null) {
    if (id === null || this.isAvailable(id)) this.currentId = id;
  }

  getCurrent() {
    return this.currentId;
  }

  get(id: string) {
    return this.entries.get(id) ?? null;
  }

  isAvailable(id: string) {
    const entry = this.entries.get(id);
    return !!entry && entry.enabled !== false && entry.node != null;
  }

  /** Resolve an explicitly supplied destination without spatial-navigation guessing. */
  resolve(destinationId: string | null | undefined): TvFocusEntry | null {
    if (!destinationId || !this.isAvailable(destinationId)) return null;
    return this.entries.get(destinationId) ?? null;
  }

  /**
   * Screen models can use this to describe a directional destination. The
   * controller intentionally does not calculate geometry: Fire TV grids,
   * rails, EPGs and Live TV columns each have different semantics.
   */
  resolveDirection(destinationId: string | null | undefined, _direction: Direction) {
    return this.resolve(destinationId);
  }

  entriesForZone(zone: FocusZone) {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.zone === zone && entry.enabled !== false && entry.node != null,
    );
  }

  clearZone(zone: FocusZone) {
    for (const [id, entry] of this.entries) {
      if (entry.zone === zone) this.entries.delete(id);
    }
    if (this.currentId && !this.entries.has(this.currentId)) this.currentId = null;
  }
}

export const fireTvNavigation = new FireTvNavigationController();

export function isFireTv() {
  return Platform.isTV === true || Platform.OS === 'android' && Platform.isTV === true;
}
