/**
 * Strip diacritics/accents and lowercase a string so that search comparisons
 * work across accented characters (e.g. "bbc" matches "BBC España").
 */
export function normaliseStr(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
