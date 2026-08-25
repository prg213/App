import { fireTvNavigation, type TvFocusEntry } from './fireTvNavigationController';

/**
 * Compatibility bridge for the existing TV navigation helpers.
 *
 * The legacy helpers remain responsible for their screen-specific geometry
 * (Home rails, EPG, Live TV, etc.). This bridge gives them a single place to
 * publish the currently focused native target without forcing a risky
 * all-at-once migration.
 */
export function registerLegacyTvFocus(
  id: string,
  zone: TvFocusEntry['zone'],
  node: number | null,
) {
  fireTvNavigation.register({ id, zone, node });
}

export function setLegacyTvFocus(id: string | null) {
  fireTvNavigation.setCurrent(id);
}

export function unregisterLegacyTvFocus(id: string) {
  fireTvNavigation.unregister(id);
}

export function clearLegacyTvZone(zone: TvFocusEntry['zone']) {
  fireTvNavigation.clearZone(zone);
}
