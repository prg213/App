/**
 * TEST FIXTURE — do not import or run this file.
 *
 * Contains intentional AsyncStorage write violations for each in-memory-only
 * category.  The self-test in check-inmemory-not-persisted.sh runs the Python
 * checker against this directory and asserts that EVERY category label appears
 * in the output.
 *
 * Each category has:
 *   (a) a single-line call using the canonical `AsyncStorage` name
 *   (b) a multiline call using the `AS` dynamic-import alias (the pattern
 *       used in player.tsx and tab screens in this codebase)
 *
 * NOTE: the checker looks for forbidden identifiers *inside* the call's
 * argument list.  Pre-computed assignments like:
 *     const s = JSON.stringify(trailerCache);
 *     AS.setItem('k', s);        ← `trailerCache` is NOT in this body
 * are NOT detected — that is a documented limitation.  Fixtures therefore
 * always inline the identifier directly into the write call.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Alias pattern that mirrors real app code in player.tsx / tab screens:
//   import('@react-native-async-storage/async-storage').then(({ default: AS }) => AS.setItem(...))
declare const AS: typeof AsyncStorage;

// ── 1. EPG scroll offsets ────────────────────────────────────────────────────
// Category label: "EPG scroll offsets"

/** (a) canonical name, single-line */
async function epgScroll_canonical() {
  const _epgScrollX = 0;
  await AsyncStorage.setItem('pos', String(_epgScrollX));
}

/** (b) AS alias, multiline */
async function epgScroll_alias_multiline() {
  const _epgScrollY = 42;
  await AS.setItem(
    'guide_pos',
    JSON.stringify({ y: _epgScrollY }),
  );
}

// ── 2. EPG filter state ──────────────────────────────────────────────────────
// Category label: "EPG filter state"

/** (a) canonical name, multiline */
async function epgFilter_canonical() {
  const _favFilterActive = true;
  await AsyncStorage.setItem(
    'guide_filter',
    JSON.stringify({ fav: _favFilterActive }),
  );
}

/** (b) AS alias, single-line */
async function epgFilter_alias() {
  const _selectedCat = 'Sports';
  await AS.setItem('guide_cat', _selectedCat);
}

// ── 3. Channel menu session state ────────────────────────────────────────────
// Category label: "Channel menu session state"

/** (a) canonical name, multiSet */
async function channelMenu_canonical() {
  const _savedSearch = 'news';
  await AsyncStorage.multiSet([
    ['menu_search', _savedSearch],
    ['menu_cat', 'all'],
  ]);
}

/** (b) AS alias, multiline */
async function channelMenu_alias() {
  const _savedScrollOffset = 120;
  await AS.setItem(
    'menu_scroll',
    String(_savedScrollOffset),
  );
}

// ── 4. OSD / player UI visibility ────────────────────────────────────────────
// Category label: "OSD/player UI visibility"
// Actual player state vars: showInfo, showControls, showChannelMenu

/** (a) canonical name, mergeItem — showInfo */
async function osd_canonical() {
  const showInfo = false;
  await AsyncStorage.mergeItem(
    'player_prefs',
    JSON.stringify({ showInfo }),
  );
}

/** (b) AS alias, single-line — showControls */
async function osd_alias() {
  const showControls = true;
  await AS.setItem('osd_state', JSON.stringify({ showControls }));
}

// ── 5. Zap-list / channel index ───────────────────────────────────────────────
// Category label: "Zap-list/channel index"

/** (a) canonical name, multiline */
async function zap_canonical() {
  const channelIdx = 7;
  await AsyncStorage.setItem(
    'last_channel',
    JSON.stringify(channelIdx),
  );
}

/** (b) AS alias, single-line */
async function zap_alias() {
  const zapIndex = 3;
  await AS.setItem('zap_pos', String(zapIndex));
}

// ── 6. In-memory caches ───────────────────────────────────────────────────────
// Category label: "In-memory caches"
//
// IMPORTANT: the identifier must appear INSIDE the write call body.
// A pre-computed variable pattern (const s = ...; AS.setItem('k', s)) is
// NOT detected — this is a documented limitation.

/** (a) canonical name, multiline — trailerCache inlined */
async function cache_canonical() {
  const trailerCache = new Map<string, string>();
  await AsyncStorage.setItem(
    'trailer_cache_dump',
    JSON.stringify(Array.from(trailerCache.entries())),
  );
}

/** (b) AS alias — seriesTrailerUrlCache inlined */
async function cache_alias() {
  const seriesTrailerUrlCache = new Map<string, string>();
  await AS.setItem('series_trailer_dump',
    JSON.stringify([...seriesTrailerUrlCache]));
}

// ── 7. Session push-failure counter ──────────────────────────────────────────
// Category label: "Session push-failure counter"

/** (a) canonical name, multiline */
async function sessionFail_canonical() {
  const _sessionPushFail = 3;
  await AsyncStorage.setItem(
    'push_fail',
    String(_sessionPushFail),
  );
}

/** (b) AS alias, single-line */
async function sessionFail_alias() {
  const sessionPushFail = 2;
  await AS.setItem('fail_count', String(sessionPushFail));
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-COMPUTED VARIABLE PATTERNS
// The following cases confirm that the one-level data-flow tracer catches
// identifiers that appear in a variable assignment BEFORE the write call,
// not inside the call's argument list.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1b. EPG scroll — pre-computed via const rows ──────────────────────────
// Category label: "EPG scroll offsets"

async function epgScroll_precomputed() {
  const _epgScrollX = 0;
  const rows: [string, string][] = [['guide_pos_x', String(_epgScrollX)]];
  await AS.multiSet(rows);
}

// ── 2b. EPG filter — pre-computed serialisation ───────────────────────────
// Category label: "EPG filter state"

async function epgFilter_precomputed() {
  const _favFilterActive = true;
  const payload = JSON.stringify({ active: _favFilterActive });
  await AsyncStorage.setItem('guide_filter', payload);
}

// ── 3b. Channel menu — pre-computed ──────────────────────────────────────
// Category label: "Channel menu session state"

async function channelMenu_precomputed() {
  const _savedCat = 'Sports';
  const value = JSON.stringify({ cat: _savedCat });
  await AS.setItem('menu_state', value);
}

// ── 4b. OSD visibility — pre-computed ────────────────────────────────────
// Category label: "OSD/player UI visibility"

async function osd_precomputed() {
  const showControls = true;
  const blob = JSON.stringify({ visible: showControls });
  await AS.setItem('osd', blob);
}

// ── 5b. Zap-list — pre-computed rows passed to multiSet ──────────────────
// Category label: "Zap-list/channel index"

async function zap_precomputed() {
  const channelIdx = 7;
  const rows: [string, string][] = [['zap', JSON.stringify(channelIdx)]];
  await AS.multiSet(rows);
}

// ── 6b. Cache — pre-computed serialisation ───────────────────────────────
// Category label: "In-memory caches"

async function cache_precomputed() {
  const posterCache = new Map<string, string>();
  const dump = JSON.stringify(Array.from(posterCache.entries()));
  await AS.setItem('poster_cache_dump', dump);
}

// ── 7b. Session fail — pre-computed ──────────────────────────────────────
// Category label: "Session push-failure counter"

async function sessionFail_precomputed() {
  const _sessionPushFail = 2;
  const val = String(_sessionPushFail);
  await AS.setItem('fail_count', val);
}
