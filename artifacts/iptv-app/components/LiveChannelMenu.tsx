/**
 * LiveChannelMenu — fullscreen overlay channel browser for the Live TV player.
 *
 * Opens when the viewer presses the Menu/hamburger button on the Firestick
 * remote. Fully D-pad navigable: LEFT/RIGHT moves between the category column
 * and the channel list; UP/DOWN scrolls within each column; OK watches.
 *
 * The video continues playing behind the overlay.
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
import { getXtreamLiveStreams } from '@/services/xtreamApi';
import { fetchAndParseM3U } from '@/services/m3uParser';
import type { Channel, EpgProgram } from '@/types';

// ─── Shared channel-entry type (same shape as player.tsx ChannelEntry) ────────
export type MenuChannelEntry = {
  url: string;
  title: string;
  epgId: string;
  logo?: string;
  channelId?: string;
  num?: number;
};

// ─── Sentinel values for synthetic categories ─────────────────────────────────
const CAT_ALL = '__all__';
const CAT_FAV = '__fav__';

// Fixed height enables FlatList.getItemLayout for fast scroll-to-index
const CH_ROW_H = 70;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`;
}

function toMenuEntry(ch: Channel): MenuChannelEntry {
  return {
    url: ch.streamUrl,
    title: ch.name,
    epgId: ch.epgId ?? ch.id,
    logo: ch.logo ?? '',
    channelId: ch.id,
    num: ch.num,
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────
export interface LiveChannelMenuProps {
  /** ID of the channel currently playing in the player. */
  currentChannelId: string;
  /** EPG map from the player (already loaded). */
  epgMap?: Map<string, EpgProgram[]>;
  /** Current wall-clock milliseconds for NOW-programme lookup. */
  nowTs: number;
  /**
   * Called when the viewer picks a channel.
   * @param entry    Simplified channel data ready for player.switchChannel.
   * @param idx      Position in `newList` (for prev/next zapping).
   * @param newList  Full ordered list visible in the menu (becomes the new
   *                 zap list in the player so LEFT/RIGHT stays consistent).
   */
  onSelectChannel: (
    entry: MenuChannelEntry,
    idx: number,
    newList: MenuChannelEntry[],
  ) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function LiveChannelMenu({
  currentChannelId,
  epgMap,
  nowTs,
  onSelectChannel,
  onClose,
}: LiveChannelMenuProps) {
  const { credentials } = useAppContext();
  const isXtream = credentials?.type === 'xtream';

  // ── Fetch all live channels ──────────────────────────────────────────────────
  const { data: allChannels = [], isLoading } = useQuery<Channel[]>({
    queryKey: ['live-channels-menu', credentials],
    queryFn: async () => {
      if (!credentials) return [];
      if (isXtream) {
        return getXtreamLiveStreams({
          host: (credentials as any).host ?? '',
          username: (credentials as any).username ?? '',
          password: (credentials as any).password ?? '',
        });
      }
      const result = await fetchAndParseM3U((credentials as any).m3uUrl ?? '');
      return result.channels;
    },
    staleTime: 5 * 60_000,
  });

  // ── Favourites ───────────────────────────────────────────────────────────────
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    StorageService.getFavorites().then((favs: any[]) =>
      setFavIds(new Set(favs.map((f: any) => f.id))),
    );
  }, []);

  // ── Sort by channel number where available ───────────────────────────────────
  const sorted = useMemo<Channel[]>(() => {
    const hasNums = allChannels.some((ch) => ch.num != null);
    return hasNums
      ? [...allChannels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : allChannels;
  }, [allChannels]);

  // ── Derive category list from groupTitle ─────────────────────────────────────
  const categories = useMemo<{ id: string; label: string }[]>(() => {
    const seen = new Set<string>();
    const list: { id: string; label: string }[] = [
      { id: CAT_ALL, label: 'All Channels' },
      { id: CAT_FAV, label: '★  Favourites' },
    ];
    sorted.forEach((ch) => {
      if (ch.groupTitle && !seen.has(ch.groupTitle)) {
        seen.add(ch.groupTitle);
        list.push({ id: ch.groupTitle, label: ch.groupTitle });
      }
    });
    return list;
  }, [sorted]);

  const [selectedCat, setSelectedCat] = useState(CAT_ALL);
  const [searchText, setSearchText] = useState('');

  // ── Filtered channel list ────────────────────────────────────────────────────
  const filtered = useMemo<Channel[]>(() => {
    let list = sorted;
    if (selectedCat === CAT_FAV) {
      list = list.filter((ch) => favIds.has(ch.id));
    } else if (selectedCat !== CAT_ALL) {
      list = list.filter((ch) => ch.groupTitle === selectedCat);
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter((ch) => ch.name.toLowerCase().includes(q));
    }
    return list;
  }, [sorted, selectedCat, favIds, searchText]);

  const filteredEntries = useMemo<MenuChannelEntry[]>(
    () => filtered.map(toMenuEntry),
    [filtered],
  );

  // ── Channel list ref + scroll helpers ────────────────────────────────────────
  const listRef = useRef<FlatList<Channel>>(null);
  const currentItemRef = useRef<any>(null);

  const scrollToCurrent = useCallback(() => {
    const idx = filtered.findIndex((ch) => ch.id === currentChannelId);
    if (idx < 0) return;
    listRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 });
  }, [filtered, currentChannelId]);

  // Scroll + focus current channel item on first load
  useEffect(() => {
    if (isLoading) return;
    const t = setTimeout(() => {
      scrollToCurrent();
      if (Platform.isTV) {
        setTimeout(() => (currentItemRef.current as any)?.focus?.(), 80);
      }
    }, 180);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // Re-scroll when category/search changes
  useEffect(() => {
    scrollToCurrent();
  }, [scrollToCurrent]);

  // ── EPG helper ───────────────────────────────────────────────────────────────
  const getNow = useCallback(
    (ch: Channel): EpgProgram | null => {
      if (!epgMap) return null;
      const progs = epgMap.get(ch.epgId ?? ch.id) ?? [];
      return progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
    },
    [epgMap, nowTs],
  );

  // ── Fade-in on mount ─────────────────────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [fadeAnim]);

  // ─── Category renderer ────────────────────────────────────────────────────────
  const renderCategory = useCallback(
    ({ item }: { item: { id: string; label: string } }) => {
      const active = selectedCat === item.id;
      return (
        <FocusablePressable
          style={[styles.catRow, active && styles.catRowActive]}
          focusedStyle={styles.catRowFocused}
          onPress={() => setSelectedCat(item.id)}
        >
          {active && <View style={styles.catActiveBar} />}
          <Text style={[styles.catLabel, active && styles.catLabelActive]} numberOfLines={2}>
            {item.label}
          </Text>
        </FocusablePressable>
      );
    },
    [selectedCat],
  );

  // ─── Channel renderer ─────────────────────────────────────────────────────────
  const renderChannel = useCallback(
    ({ item: ch }: { item: Channel }) => {
      const isCurrent = ch.id === currentChannelId;
      const now = getNow(ch);
      return (
        <FocusablePressable
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={isCurrent ? (currentItemRef as any) : undefined}
          style={[styles.chRow, isCurrent && styles.chRowCurrent]}
          focusedStyle={styles.chRowFocused}
          onPress={() => {
            const idx = filteredEntries.findIndex((e) => e.channelId === ch.id);
            onSelectChannel(toMenuEntry(ch), Math.max(0, idx), filteredEntries);
          }}
        >
          {isCurrent && <View style={styles.chCurrentBar} />}

          {/* Logo */}
          {ch.logo ? (
            <Image source={{ uri: ch.logo }} style={styles.chLogo} contentFit="contain" cachePolicy="memory-disk" />
          ) : (
            <View style={[styles.chLogo, styles.chLogoFallback]}>
              <Text style={styles.chLogoLetter}>{(ch.name[0] ?? '?').toUpperCase()}</Text>
            </View>
          )}

          {/* Info */}
          <View style={styles.chInfo}>
            <View style={styles.chNameRow}>
              {ch.num != null && <Text style={styles.chNum}>{ch.num}</Text>}
              <Text style={styles.chName} numberOfLines={1}>{ch.name}</Text>
              {isCurrent && (
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveLabel}>LIVE</Text>
                </View>
              )}
            </View>
            <Text style={styles.chNow} numberOfLines={1}>
              {now
                ? `${now.title}  ·  ${fmtTime(now.start)} – ${fmtTime(now.end)}`
                : 'No programme info'}
            </Text>
          </View>
        </FocusablePressable>
      );
    },
    [currentChannelId, getNow, filteredEntries, onSelectChannel],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: CH_ROW_H, offset: CH_ROW_H * index, index }),
    [],
  );

  const catLabel = categories.find((c) => c.id === selectedCat)?.label ?? 'Channels';

  // ─── Render ───────────────────────────────────────────────────────────────────
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
              <ActivityIndicator color="#00d4ff" size="large" />
              <Text style={styles.placeholderText}>Loading channels…</Text>
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>No channels found</Text>
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
              maxToRenderPerBatch={15}
              initialNumToRender={20}
              onScrollToIndexFailed={({ index }) => {
                setTimeout(
                  () => listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.3 }),
                  300,
                );
              }}
            />
          )}
        </View>
      </View>

      {/* Keyboard hint */}
      <View style={styles.footer}>
        <Text style={styles.footerHint}>
          ◀ BACK — close menu     ·     OK — watch channel     ·     MENU — toggle
        </Text>
      </View>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ACCENT = '#00d4ff';
const PANEL_BG = 'rgba(8, 8, 20, 0.97)';

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: PANEL_BG,
    flexDirection: 'column',
    zIndex: 200,
  },
  panels: {
    flex: 1,
    flexDirection: 'row',
  },

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
  },
  chCount: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
    borderRadius: 0,
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
    left: 0,
    top: 6,
    bottom: 6,
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
    color: '#ffffff',
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

  // ─ Channel rows
  chRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CH_ROW_H,
    paddingHorizontal: 14,
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
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    backgroundColor: ACCENT,
    borderRadius: 2,
  },
  chLogo: {
    width: 48,
    height: 34,
    borderRadius: 4,
    marginRight: 12,
    flexShrink: 0,
  },
  chLogoFallback: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chLogoLetter: { color: 'rgba(255,255,255,0.7)', fontSize: 16, fontWeight: '700' },
  chInfo: { flex: 1 },
  chNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  chNum: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
    marginRight: 6,
    minWidth: 28,
  },
  chName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#cc0000',
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 8,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#fff',
    marginRight: 4,
  },
  liveLabel: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  chNow: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },

  // ─ Placeholder / loading
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  placeholderText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },

  // ─ Footer hint
  footer: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  footerHint: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
