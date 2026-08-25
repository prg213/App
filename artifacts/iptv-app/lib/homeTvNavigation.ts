import { fireTvNavigation } from './fireTvNavigationController';

export type HomeRail = 'recent' | 'cw' | 'movies' | 'series';

const idFor = (rail: HomeRail, index: number) => `home:${rail}:${index}`;

/**
 * Adapter for Home's existing rail navigation. tvRowNav remains responsible
 * for the rail geometry; this module publishes logical Home focus into the
 * global Fire TV controller without changing the existing movement rules.
 */
export const homeTvNavigation = {
  registerCard(rail: HomeRail, index: number, node: number | null) {
    fireTvNavigation.register({
      id: idFor(rail, index),
      zone: 'content',
      node,
    });
  },

  unregisterCard(rail: HomeRail, index: number) {
    fireTvNavigation.unregister(idFor(rail, index));
  },

  setFocusedCard(rail: HomeRail, index: number) {
    fireTvNavigation.setCurrent(idFor(rail, index));
  },

  clearRail(rail: HomeRail) {
    for (const entry of fireTvNavigation.entriesForZone('content')) {
      if (entry.id.startsWith(`home:${rail}:`)) {
        fireTvNavigation.unregister(entry.id);
      }
    }
  },
};
