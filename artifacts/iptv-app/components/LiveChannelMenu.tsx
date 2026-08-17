/**
 * LiveChannelMenu — professional channel browser overlay for the Live TV player.
 *
 * Features:
 *   • All Channels · Recently Watched · Favourites · per-provider categories
 *   • Channel numbers, logos, names, favourite star (★) indicators
 *   • EPG: NOW programme + progress bar + NEXT programme per row
 *   • Programme description (from EPG) shown as NOW subtitle
 *   • Search within any category
 *   • State persistence between opens (category, search text, scroll position)
 *   • Auto-selects the current channel's category on first open; restores the
 *     user's last chosen category on subsequent opens
 *   • Single API call cached 5 min — never re-fetches on channel switch
 *   • Fixed-height rows + getItemLayout for instant scroll-to-index on long lists
 *   • Full D-pad navigation (Firestick / Android TV)
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '@/context/AppContext';
import { FocusablePressable } from '@/components/FocusablePressable';
import { StorageService } from '@/services/storage';
import { getXtreamLiveStreams, getXtreamLiveCategories } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Category, Channel, EpgProgram, RecentChannel } from '@/types';

// ─── Category sentinel IDs ─────────────────────────────────────────────────────
const CAT_ALL    = '__all__';
const CAT_RECENT = '__recent__';
const CAT_FAV    = '__fav__';

// ─── Module-level persistence ──────────────────────────────────────────────────
// Survives unmount/remount (between menu opens) without prop drilling.
// Resets on app restart.  _autoSelected gates the one-time category auto-pick.
let _savedCat          = CAT_ALL;
let _savedSearch       = '';
let _savedScrollOffset = 0;
let _autoSelected      = false;   // true once we've done the initial auto-select

/**
 * Resets all module-level channel browser state to its initial defaults.
 * Must be called on logout / account switch so the next login behaves as if
 * the browser was opened for the first time (auto-selects the current
 * channel's category, no stale search text or scroll offset).
 */
export function resetChannelMenuState(): void {
  _savedCat          = CAT_ALL;
  _savedSearch       = '';
  _savedScrollOffset = 0;
  _autoSelected      = false;
}

// ─── Test-only helpers ────────────────────────────────────────────────────────
// These exports exist solely to let unit tests inspect and mutate module-level
// state without needing a full component render.  They are NOT part of the
// public API and must not be used in application code.

/** @internal — test use only */
export function _getChannelMenuStateForTest() {
  return {
    savedCat:          _savedCat,
    savedSearch:       _savedSearch,
    savedScrollOffset: _savedScrollOffset,
    autoSelected:      _autoSelected,
  } as const;
}

/** @internal — test use only */
export function _setChannelMenuStateForTest(patch: {
  savedCat?:          string;
  savedSearch?:       string;
  savedScrollOffset?: number;
  autoSelected?:      boolean;
}): void {
  if (patch.savedCat          !== undefined) _savedCat          = patch.savedCat;
  if (patch.savedSearch        !== undefined) _savedSearch       = patch.savedSearch;
  if (patch.savedScrollOffset  !== undefined) _savedScrollOffset = patch.savedScrollOffset;
  if (patch.autoSelected       !== undefined) _autoSelected      = patch.autoSelected;
}

// ─── Fixed row height — required for getItemLayout ────────────────────────────
const CH_ROW_H = 84;

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
}

function toMenuEntry(ch: Channel): MenuChannelEntry {
  return {
    url:       ch.streamUrl,
    title:     ch.name,
    epgId:     ch.epgId ?? ch.id,
    logo:      ch.logo ?? '',
    channelId: ch.id,
    num:       ch.num,
  };
}

// ─── Shared type (same shape as player.tsx ChannelEntry) ──────────────────────
export type MenuChannelEntry = {
  url: string;
  title: string;
  epgId: string;
  logo?: string;
  channelId?: string;
  num?: number;
};

// ─── Props ─────────────────────────────────────────────────────────────────────
export interface LiveChannelMenuProps {
  /** ID of the channel currently playing in the player. */
  currentChannelId: string;
  /** EPG map already loaded by the player — no extra fetch needed. */
  epgMap?: Map<string, EpgProgram[]>;
  /**
   * Called when the viewer picks a channel.
   * @param entry   Simplified entry ready for player.switchChannel.
   * @param idx     Position in `newList`.
   * @param newList Full ordered list visible in the menu (becomes the new zap list).
   */
  onSelectChannel: (
    entry: MenuChannelEntry,
    idx: number,
    newList: MenuChannelEntry[],
  ) => void;
  onClose: () => void;
}


// ─── Component ─────────────────────────────────────────────────────────────────
// Internal implementation — exported as a memoised wrapper below so the
// channel browser only re-renders when its own props change, not on every
// PlayerScreen state update (buffering, reconnect, OSD visibility, etc.).
function LiveChannelMenuImpl({
  currentChannelId,
  epgMap,
  onSelectChannel,
  onClose,
}: LiveChannelMenuProps) {
  const { credentials } = useAppContext();
  const isXtream = credentials?.type === 'xtream';

  // ── Internal clock for EPG NOW/NEXT rows ─────────────────────────────────────
  // Managed here instead of receiving a `nowTs` prop so this component's render
  // cycle is completely decoupled from PlayerScreen.  The interval only runs
  // while the menu is mounted (i.e. visible) — zero overhead when it's closed.
  const [nowTs, setNowTs] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Fetch all live channels ──────────────────────────────────────────────────
  // Key matches ['live-channels-all', credentials] used by other screens so all
  // components share a single cache entry — no duplicate network requests when
  // the menu opens after the Live TV tab has already loaded the channel list.
  // refetchOnWindowFocus/Mount: false — staleTime governs freshness; focus
  // events on Firestick must never trigger additional API calls.
  const { data: allChannels = [], isLoading } = useQuery<Channel[]>({
    queryKey:            ['live-channels-all', credentials],
    queryFn:             async () => {
      if (!credentials) return [];
      if (isXtream) {
        return getXtreamLiveStreams({
          host:     (credentials as any).host     ?? '',
          username: (credentials as any).username ?? '',
          password: (credentials as any).password ?? '',
        });
      }
      const result = await fetchAndParseM3U((credentials as any).m3uUrl ?? '');
      return result.channels;
    },
    staleTime:           5 * 60_000,
    gcTime:              30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount:      false,
  });

  // ── Category names ───────────────────────────────────────────────────────────
  // Xtream channels carry a raw category_id in groupTitle (e.g. "204"), so the
  // sidebar must resolve IDs to display names via get_live_categories. Shares
  // the ['live-categories', credentials] cache key with the Live TV tab, so
  // this is normally served straight from cache with no extra network call.
  const { data: rawCategories = [] } = useQuery<Category[]>({
    queryKey: ['live-categories', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (isXtream) {
        return getXtreamLiveCategories({
          host:     (credentials as any).host     ?? '',
          username: (credentials as any).username ?? '',
          password: (credentials as any).password ?? '',
        });
      }
      if ((credentials as any).m3uUrl) {
        return (await fetchAndParseM3U((credentials as any).m3uUrl)).categories;
      }
      return [];
    },
    enabled:              !!credentials,
    staleTime:            5 * 60_000,
    gcTime:               30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount:       false,
  });
  const categoryNameMap = useMemo(() => {
    // Defensive: providers can return malformed category payloads (null rows,
    // numeric ids). Never let bad data crash the menu.
    const map = new Map<string, string>();
    if (Array.isArray(rawCategories)) {
      for (const c of rawCategories) {
        if (c && c.id != null && c.name != null) map.set(String(c.id), String(c.name));
      }
    }
    return map;
  }, [rawCategories]);

  // ── Favourites ────────────────────────────────────────────────────────────────
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const favLoadedRef = useRef(false);
  useEffect(() => {
    StorageService.getFavorites().then((favs) => {
      setFavIds(new Set(favs.map((f) => f.id)));
      favLoadedRef.current = true;
    });
  }, []);

  // ── Recently watched channels ─────────────────────────────────────────────────
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  useEffect(() => {
    StorageService.getRecentChannels().then(setRecentChannels);
  }, []);

  // ── Sort by channel number where available ────────────────────────────────────
  const sorted = useMemo<Channel[]>(() => {
    const hasNums = allChannels.some((ch) => ch.num != null);
    return hasNums
      ? [...allChannels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : allChannels;
  }, [allChannels]);

  // ── Category list ─────────────────────────────────────────────────────────────
  const categories = useMemo<{ id: string; label: string }[]>(() => {
    const list: { id: string; label: string }[] = [
      { id: CAT_ALL,    label: 'All Channels' },
    ];
    if (recentChannels.length > 0) {
      list.push({ id: CAT_RECENT, label: '🕐  Recently Watched' });
    }
    list.push({ id: CAT_FAV, label: '★  Favourites' });

    const seen = new Set<string>();
    sorted.forEach((ch) => {
      if (ch.groupTitle && !seen.has(ch.groupTitle)) {
        seen.add(ch.groupTitle);
        // Keep the raw groupTitle as the id (selection/filtering is keyed on
        // it) but display the resolved category name when we have one.
        // String() guards against providers returning numeric ids/names —
        // non-string values would crash string ops (search, toLowerCase).
        list.push({ id: ch.groupTitle, label: String(categoryNameMap.get(String(ch.groupTitle)) ?? ch.groupTitle) });
      }
    });
    return list;
  }, [sorted, recentChannels.length, categoryNameMap]);

  // ── Persisted state ───────────────────────────────────────────────────────────
  const [selectedCat, _setSelectedCat] = useState(_savedCat);
  const [searchText,  _setSearchText]  = useState(_savedSearch);

  const setSelectedCat = useCallback((cat: string) => {
    _savedCat          = cat;
    _savedScrollOffset = 0; // scroll resets whenever the category changes
    _setSelectedCat(cat);
  }, []);

  const setSearchText = useCallback((text: string) => {
    _savedSearch = text;
    _setSearchText(text);
  }, []);

  // ── Auto-select current channel's category on first open ──────────────────────
  // If the viewer has no saved preference (CAT_ALL), pick the category that
  // contains the currently-playing channel so it's immediately visible.
  // _autoSelected ensures this only runs once per session; subsequent opens
  // restore the viewer's last manually-chosen category instead.
  // favLoadedRef gates execution so favourites membership is known before we
  // decide — otherwise a bookmarked channel might fall through to groupTitle.
  useEffect(() => {
    if (isLoading || _autoSelected || !favLoadedRef.current) return;
    _autoSelected = true;

    // Restore saved category if it's something specific the user chose.
    if (_savedCat !== CAT_ALL) return;

    const currentCh = sorted.find((ch) => ch.id === currentChannelId);
    if (!currentCh) return;

    // Prefer Favourites when the channel is bookmarked
    if (favIds.has(currentChannelId)) {
      setSelectedCat(CAT_FAV);
      return;
    }

    // Otherwise land on the channel's provider category
    if (currentCh.groupTitle) {
      setSelectedCat(currentCh.groupTitle);
    }
    // No groupTitle → stays on CAT_ALL (already the default)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, favIds]);

  // Guard: if the saved category no longer exists (e.g. different provider),
  // fall back to All Channels so the list is never empty.
  useEffect(() => {
    if (isLoading || categories.length === 0) return;
    if (!categories.some((c) => c.id === selectedCat)) {
      setSelectedCat(CAT_ALL);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, categories]);

  // ── Filtered channel list ─────────────────────────────────────────────────────
  const filtered = useMemo<Channel[]>(() => {
    let list: Channel[];

    if (selectedCat === CAT_RECENT) {
      // Recently watched in watchedAt order (most recent first).
      // Match against sorted for up-to-date logo/name/num; fall back to stored
      // data for channels that have since been removed from the provider list.
      const byId = new Map(sorted.map((ch) => [ch.id, ch]));
      list = recentChannels
        .map((rc) => byId.get(rc.id) ?? ({
          id:         rc.id,
          name:       rc.name,
          logo:       rc.logo,
          groupTitle: rc.groupTitle,
          streamUrl:  rc.streamUrl,
          epgId:      rc.epgId,
        } as Channel))
        .filter(Boolean) as Channel[];
    } else if (selectedCat === CAT_FAV) {
      list = sorted.filter((ch) => favIds.has(ch.id));
    } else if (selectedCat !== CAT_ALL) {
      list = sorted.filter((ch) => ch.groupTitle === selectedCat);
    } else {
      list = sorted;
    }

    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter((ch) => ch.name.toLowerCase().includes(q));
    }

    return list;
  }, [sorted, selectedCat, favIds, recentChannels, searchText]);

  const filteredEntries = useMemo<MenuChannelEntry[]>(
    () => filtered.map(toMenuEntry),
    [filtered],
  );

  // ── EPG: NOW + NEXT for a given channel ──────────────────────────────────────
  const getNowNext = useCallback(
    (ch: Channel): { now: EpgProgram | null; next: EpgProgram | null } => {
      if (!epgMap) return { now: null, next: null };
      const progs = epgMap.get(ch.epgId ?? ch.id) ?? [];
      const idx = progs.findIndex(
        (p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime(),
      );
      return {
        now:  idx >= 0 ? progs[idx]     ?? null : null,
        next: idx >= 0 ? progs[idx + 1] ?? null : null,
      };
    },
    [epgMap, nowTs],
  );

  // ── List ref + scroll management ──────────────────────────────────────────────
  const listRef        = useRef<FlatList<Channel>>(null);
  const currentItemRef = useRef<any>(null);
  // Fallback focus targets so D-pad focus ALWAYS enters the overlay on TV,
  // even when the currently-playing channel's row isn't rendered (different
  // category active on open, virtualization, slow layout).
  const firstItemRef   = useRef<any>(null);
  const firstCatRef    = useRef<any>(null);

  const scrollToCurrent = useCallback(() => {
    const idx = filtered.findIndex((ch) => ch.id === currentChannelId);
    if (idx >= 0) {
      listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
    }
  }, [filtered, currentChannelId]);

  // On initial data load: restore saved scroll offset or scroll to current channel.
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => {
      if (_savedScrollOffset > 0) {
        listRef.current?.scrollToOffset({ offset: _savedScrollOffset, animated: false });
      } else {
        scrollToCurrent();
      }
    }, 180);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // TV: hand D-pad focus INTO the overlay once it's ready.  The menu is an
  // absolutely-positioned View (not a Modal), so native focus stays on the
  // player's zones behind it unless we move it here explicitly — which made
  // the remote appear completely dead inside the menu.  Retry with fallbacks:
  // current channel row → first channel row → first category row.
  useEffect(() => {
    if (!Platform.isTV || isLoading) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tryFocus = () => {
      const target =
        currentItemRef.current ?? firstItemRef.current ?? firstCatRef.current;
      if (target?.focus) {
        try { target.focus(); return; } catch (_) {}
      }
      if (++attempts < 10) timer = setTimeout(tryFocus, 120);
    };
    timer = setTimeout(tryFocus, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // When category or search changes: reset offset and scroll to current channel.
  useEffect(() => {
    _savedScrollOffset = 0;
    const t = setTimeout(() => scrollToCurrent(), 60);
    return () => clearTimeout(t);
  }, [selectedCat, searchText, scrollToCurrent]);

  // Persist scroll position as the viewer browses the list.
  const onScroll = useCallback((e: any) => {
    _savedScrollOffset = e.nativeEvent.contentOffset.y;
  }, []);

  // ── Fade-in on mount ──────────────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // ─── Category row ─────────────────────────────────────────────────────────────
  const renderCategory = useCallback(
    ({ item, index }: { item: { id: string; label: string }; index: number }) => {
      const active = selectedCat === item.id;
      return (
        <FocusablePressable
          ref={index === 0 ? (firstCatRef as any) : undefined}
          style={[styles.catRow, active && styles.catRowActive]}
          focusedStyle={styles.catRowFocused}
          onPress={() => setSelectedCat(item.id)}
        >
          {active && <View style={styles.catActiveBar} />}
          <Text
            style={[styles.catLabel, active && styles.catLabelActive]}
            numberOfLines={2}
          >
            {item.label}
          </Text>
        </FocusablePressable>
      );
    },
    [selectedCat, setSelectedCat],
  );

  // ─── Channel row ──────────────────────────────────────────────────────────────
  const renderChannel = useCallback(
    ({ item: ch, index }: { item: Channel; index: number }) => {
      const isCurrent  = ch.id === currentChannelId;
      const isFav      = favIds.has(ch.id);
      const { now, next } = getNowNext(ch);

      const progressPct = now
        ? Math.min(100, Math.max(0,
            (nowTs - now.start.getTime()) /
            (now.end.getTime() - now.start.getTime()) * 100,
          ))
        : 0;

      return (
        <FocusablePressable
          ref={isCurrent ? (currentItemRef as any) : index === 0 ? (firstItemRef as any) : undefined}
          style={[styles.chRow, isCurrent && styles.chRowCurrent]}
          focusedStyle={styles.chRowFocused}
          onPress={() => {
            const idx = filteredEntries.findIndex((e) => e.channelId === ch.id);
            onSelectChannel(toMenuEntry(ch), Math.max(0, idx), filteredEntries);
          }}
        >
          {/* Active-channel left accent */}
          {isCurrent && <View style={styles.chCurrentBar} />}

          {/* Logo */}
          {ch.logo ? (
            <Image
              source={{ uri: ch.logo }}
              style={styles.chLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.chLogo, styles.chLogoFallback]}>
              <Text style={styles.chLogoLetter}>
                {(ch.name[0] ?? '?').toUpperCase()}
              </Text>
            </View>
          )}

          {/* Info column */}
          <View style={styles.chInfo}>

            {/* Row 1: number · name · ★ · LIVE badge */}
            <View style={styles.chNameRow}>
              {ch.num != null && (
                <Text style={styles.chNum}>{ch.num}</Text>
              )}
              <Text style={styles.chName} numberOfLines={1}>{ch.name}</Text>
              {isFav && <Text style={styles.chFavStar}>★</Text>}
              {isCurrent && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveLabel}>LIVE</Text>
                </View>
              )}
            </View>

            {/* Rows 2–4: EPG (NOW + progress + NEXT), or a soft placeholder */}
            {now ? (
              <>
                {/* NOW: title + time range */}
                <Text style={styles.chNowRow} numberOfLines={1}>
                  <Text style={styles.epgLabelNow}>NOW  </Text>
                  <Text style={styles.chNowTitle}>{now.title}</Text>
                  <Text style={styles.chNowTime}>  {fmtTime(now.start)}–{fmtTime(now.end)}</Text>
                </Text>

                {/* Programme description (first line only, when available) */}
                {!!now.description && (
                  <Text style={styles.chNowDesc} numberOfLines={1}>
                    {now.description}
                  </Text>
                )}

                {/* Progress bar */}
                <View style={styles.chProgTrack}>
                  <View
                    style={[styles.chProgFill, { width: `${progressPct}%` as any }]}
                  />
                </View>

                {/* NEXT programme */}
                {next && (
                  <Text style={styles.chNextRow} numberOfLines={1}>
                    <Text style={styles.epgLabelNext}>NEXT  </Text>
                    <Text style={styles.chNextTitle}>{next.title}</Text>
                    <Text style={styles.chNextTime}>  {fmtTime(next.start)}</Text>
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.chNoEpg}>No programme data</Text>
            )}
          </View>
        </FocusablePressable>
      );
    },
    [currentChannelId, favIds, getNowNext, nowTs, filteredEntries, onSelectChannel],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: CH_ROW_H,
      offset: CH_ROW_H * index,
      index,
    }),
    [],
  );

  const catLabel = categories.find((c) => c.id === selectedCat)?.label ?? 'Channels';

  // ─── Render ────────────────────────────────────────────────────────────────────
  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
      <View style={styles.panels}>

        {/* ── Category panel ───────────────────────────────────────────── */}
        <View style={styles.catPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>CATEGORIES</Text>
          </View>
          <FlatList
            data={categories}
            keyExtractor={(item) => item.id}
            renderItem={renderCategory}
            showsVerticalScrollIndicator={false}
            windowSize={20}
          />
        </View>

        {/* ── Channel panel ────────────────────────────────────────────── */}
        <View style={styles.chPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle} numberOfLines={1}>{catLabel}</Text>
            {!isLoading && (
              <Text style={styles.chCount}>{filtered.length} channels</Text>
            )}
            {/* Close button — visible on phone; TV users press BACK */}
            {!Platform.isTV && (
              <FocusablePressable
                style={styles.closeBtn}
                focusedStyle={styles.closeBtnFocused}
                onPress={onClose}
                accessibilityLabel="Close channel browser"
                accessibilityRole="button"
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </FocusablePressable>
            )}
          </View>

          {/* Search bar */}
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search channels…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchText}
              onChangeText={setSearchText}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchText.length > 0 && (
              <FocusablePressable
                style={styles.clearBtn}
                focusedStyle={styles.clearBtnFocused}
                onPress={() => setSearchText('')}
              >
                <Text style={styles.clearBtnText}>✕</Text>
              </FocusablePressable>
            )}
          </View>

          {/* Channel list */}
          {isLoading ? (
            <View style={styles.placeholder}>
              <ActivityIndicator color={ACCENT} size="large" />
              <Text style={styles.placeholderText}>Loading channels…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>
                {selectedCat === CAT_FAV
                  ? '★'
                  : selectedCat === CAT_RECENT
                  ? '🕐'
                  : '📺'}
              </Text>
              <Text style={styles.placeholderText}>
                {selectedCat === CAT_FAV
                  ? 'No favourite channels yet'
                  : selectedCat === CAT_RECENT
                  ? 'No recently watched channels'
                  : searchText.trim()
                  ? 'No channels match your search'
                  : 'No channels in this category'}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={filtered}
              keyExtractor={(ch) => ch.id}
              renderItem={renderChannel}
              getItemLayout={getItemLayout}
              showsVerticalScrollIndicator={false}
              windowSize={5}
              maxToRenderPerBatch={12}
              initialNumToRender={16}
              onScroll={onScroll}
              scrollEventThrottle={100}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(
                  () =>
                    listRef.current?.scrollToIndex({
                      index,
                      animated: false,
                      viewPosition: 0.3,
                    }),
                  300,
                );
              }}
            />
          )}
        </View>
      </View>

      {/* Hint footer */}
      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          {Platform.isTV
            ? '◀ BACK — close menu  ·  OK — watch channel  ·  MENU — toggle'
            : 'Tap a channel to switch  ·  press Back to close'}
        </Text>
      </View>
    </Animated.View>
  );
}

// Memoised export: PlayerScreen re-renders frequently during channel zapping
// (buffering, reconnect, OSD state, etc.).  Wrapping in React.memo means the
// channel browser only reconciles when currentChannelId, epgMap, or the
// callback references actually change — keeping the Firestick UI responsive.
const MemoLiveChannelMenu = React.memo(LiveChannelMenuImpl);

// Error boundary: a JS error anywhere inside the channel browser (malformed
// provider data, unexpected EPG shape, etc.) must close the overlay and keep
// the stream playing — in a release build an uncaught render error kills the
// entire app. onClose is called from componentDidCatch so PlayerScreen
// unmounts the menu; the boundary renders nothing in the error state.
class LiveChannelMenuBoundary extends React.Component<
  LiveChannelMenuProps,
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: unknown) {
    console.warn('[LiveChannelMenu] crashed — closing overlay:', error);
    try { this.props.onClose(); } catch {}
  }
  render() {
    if (this.state.hasError) return null;
    return <MemoLiveChannelMenu {...this.props} />;
  }
}

export const LiveChannelMenu = LiveChannelMenuBoundary;

// ─── Styles ────────────────────────────────────────────────────────────────────
const ACCENT    = '#00d4ff';
const PANEL_BG  = 'rgba(8, 8, 20, 0.97)';

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: PANEL_BG,
    flexDirection: 'column',
    zIndex: 200,
  },
  panels: { flex: 1, flexDirection: 'row' },

  // ─ Category panel
  catPanel: {
    width: '22%',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  panelHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    flex: 1,
  },
  chCount: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    marginLeft: 8,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  catRowActive: {
    backgroundColor: 'rgba(0,212,255,0.1)',
  },
  catRowFocused: {
    backgroundColor: 'rgba(0,212,255,0.2)',
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 4,
  },
  catActiveBar: {
    position: 'absolute',
    left: 0, top: 8, bottom: 8,
    width: 3,
    backgroundColor: ACCENT,
    borderRadius: 2,
  },
  catLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13,
    flex: 1,
    paddingLeft: 6,
  },
  catLabelActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // ─ Channel panel
  chPanel: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },

  // ─ Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { fontSize: 14, marginRight: 8 },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    height: 44,
  },
  clearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  clearBtnFocused: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  clearBtnText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },

  // ─ Phone close button (top-right of channel panel header)
  closeBtn: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  closeBtnFocused: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  closeBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  // ─ Channel rows
  chRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CH_ROW_H,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  chRowCurrent: {
    backgroundColor: 'rgba(0,212,255,0.07)',
  },
  chRowFocused: {
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 4,
  },
  chCurrentBar: {
    position: 'absolute',
    left: 0, top: 8, bottom: 8,
    width: 3,
    backgroundColor: ACCENT,
    borderRadius: 2,
  },

  // Logo
  chLogo: {
    width: 52,
    height: 46,
    borderRadius: 6,
    marginRight: 14,
    flexShrink: 0,
  },
  chLogoFallback: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chLogoLetter: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 20,
    fontWeight: '700',
  },

  // Info column
  chInfo: { flex: 1, justifyContent: 'center', gap: 1 },

  // Name row
  chNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  chNum: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '700',
    minWidth: 24,
  },
  chName: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  chFavStar: {
    color: '#facc15',
    fontSize: 13,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#cc0000',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  liveDot: {
    width: 5, height: 5,
    borderRadius: 3,
    backgroundColor: '#fff',
    marginRight: 4,
  },
  liveLabel: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  // EPG rows
  chNowRow: { lineHeight: 15 },
  epgLabelNow: {
    color: ACCENT,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  chNowTitle: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600' },
  chNowTime:  { color: 'rgba(255,255,255,0.38)', fontSize: 10 },
  chNowDesc:  { color: 'rgba(255,255,255,0.35)', fontSize: 10, lineHeight: 13 },

  // Progress bar
  chProgTrack: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 2,
    marginVertical: 2,
  },
  chProgFill: {
    height: 3,
    backgroundColor: ACCENT,
    borderRadius: 2,
  },

  // Next row
  chNextRow: { lineHeight: 14 },
  epgLabelNext: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  chNextTitle: { color: 'rgba(255,255,255,0.45)', fontSize: 11 },
  chNextTime:  { color: 'rgba(255,255,255,0.25)', fontSize: 10 },

  chNoEpg: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    fontStyle: 'italic',
  },

  // ─ Placeholder / loading
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  placeholderIcon: { fontSize: 36, opacity: 0.25 },
  placeholderText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  // ─ Footer
  footer: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  footerHint: {
    color: 'rgba(255,255,255,0.28)',
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
