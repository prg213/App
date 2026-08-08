import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  BackHandler,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import { sidebarNav } from '@/lib/sidebarNav';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '@/context/AppContext';
import { StorageService } from '@/services/storage';

export const SIDEBAR_W = 220;

const NAV = [
  { name: 'home',      label: 'Home',      icon: '🏠' },
  { name: 'index',     label: 'Live TV',   icon: '📡' },
  { name: 'guide',     label: 'TV Guide',  icon: '📋' },
  { name: 'catchup',   label: 'Catch Up',  icon: '⏪' },
  { name: 'movies',    label: 'Movies',    icon: '🎬' },
  { name: 'series',    label: 'Series',    icon: '📺' },
  { name: 'reminders', label: 'Reminders', icon: '🔔' },
  { name: 'telegram',  label: 'Telegram',  icon: '💬' },
  { name: 'search',    label: 'Search',    icon: '🔍' },
  { name: 'settings',  label: 'Settings',  icon: '⚙'  },
];

// ── Upcoming reminder badge ────────────────────────────────────────────────

/** Returns the count of reminders whose programme has not yet ended. */
function useUpcomingReminderCount(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const reminders = await StorageService.getReminders();
      const now = Date.now();
      setCount(reminders.filter((r) => new Date(r.end).getTime() > now).length);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-check every 60 seconds so the badge clears as programmes end
    const interval = setInterval(refresh, 60_000);

    // Also refresh when the app comes back to the foreground
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') refresh();
      },
    );

    // #109: Refresh immediately whenever any screen adds or removes a reminder
    const emitterSub = DeviceEventEmitter.addListener('reminders:changed', refresh);

    return () => {
      clearInterval(interval);
      subscription.remove();
      emitterSub.remove();
    };
  }, [refresh]);

  return count;
}

// ── Server status ──────────────────────────────────────────────────────────

type ServerStatus = 'checking' | 'ok' | 'error' | 'unconfigured';

function useServerStatus(): ServerStatus {
  const { credentials, isActivated } = useAppContext();
  const [status, setStatus] = useState<ServerStatus>('checking');

  useEffect(() => {
    if (!isActivated || !credentials) { setStatus('unconfigured'); return; }

    let cancelled = false;
    const check = async () => {
      try {
        if (credentials.type === 'xtream') {
          const host = credentials.host.replace(/\/$/, '');
          const url = `${host}/player_api.php?username=${encodeURIComponent(credentials.username)}&password=${encodeURIComponent(credentials.password)}&action=get_live_categories`;
          const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!cancelled) setStatus(res.ok ? 'ok' : 'error');
        } else {
          // M3U — just try fetching the first byte
          const res = await fetch(credentials.m3uUrl ?? '', { signal: AbortSignal.timeout(8000) });
          if (!cancelled) setStatus(res.ok ? 'ok' : 'error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    };
    setStatus('checking');
    check();
    // Re-check every 2 minutes
    const t = setInterval(check, 120_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isActivated, credentials]);

  return status;
}

// Separate component so each nav item owns its own focus state via onFocus/onBlur.
// This is more reliable than the Pressable style-callback `focused` prop on
// Android TV / Fire OS where PressableStateCallbackType may not include `focused`.
function NavItem({
  item,
  active,
  isFirst,
  firstRef,
  onPress,
  badgeCount,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  isFirst: boolean;
  firstRef: React.RefObject<RNView | null>;
  onPress: () => void;
  badgeCount: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      ref={isFirst ? firstRef : undefined}
      focusable
      accessible
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.navItem,
        active && styles.navItemActive,
        focused && styles.navItemFocused,
      ]}
      onPress={onPress}
    >
      <View style={styles.navIconWrapper}>
        <Text style={styles.navIcon}>{item.icon}</Text>
        {badgeCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {badgeCount > 99 ? '99+' : String(badgeCount)}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>
        {item.label}
      </Text>
      {active && <View style={styles.activePip} />}
    </Pressable>
  );
}

function Sidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const serverStatus = useServerStatus();
  const upcomingReminderCount = useUpcomingReminderCount();
  const firstNavRef = useRef<RNView>(null);

  // On Android TV / Fire OS hasTVPreferredFocus can silently do nothing when the
  // sidebar mounts after the scene content.  Explicitly calling .focus() after a
  // short delay is the most reliable way to land D-pad focus on the first nav item.
  useEffect(() => {
    // Register focus fn so screen BackHandlers can return to the sidebar
    sidebarNav.focus = () => { (firstNavRef.current as any)?.focus?.(); };
    // Fire OS ignores hasTVPreferredFocus when sidebar mounts after scene content;
    // explicit .focus() after a short delay is the most reliable workaround.
    const t = setTimeout(sidebarNav.focus, 300);
    return () => clearTimeout(t);
  }, []);

  const dotColor = serverStatus === 'ok' ? '#22C55E'
    : serverStatus === 'error' ? '#EF4444'
    : serverStatus === 'unconfigured' ? '#6B7280'
    : '#F59E0B'; // checking = amber

  const statusLabel = serverStatus === 'ok' ? 'Connected'
    : serverStatus === 'error' ? 'Server error'
    : serverStatus === 'unconfigured' ? 'Not configured'
    : 'Checking…';

  return (
    <View style={[styles.sidebar, { paddingTop: insets.top + 16, paddingLeft: insets.left }]}>
      {/* Brand */}
      <View style={styles.brand}>
        <View style={styles.brandIcon}><Text style={styles.brandPlay}>▶</Text></View>
        <View>
          <Text style={styles.brandName}>StreamVault</Text>
          <Text style={styles.brandSub}>IPTV</Text>
        </View>
      </View>

      {/* Nav items */}
      <ScrollView
        style={styles.nav}
        contentContainerStyle={styles.navContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {state.routes.map((route, i) => {
          const active = state.index === i;
          const item = NAV.find((n) => n.name === route.name);
          if (!item) return null;
          const badgeCount = item.name === 'reminders' ? upcomingReminderCount : 0;
          return (
            <NavItem
              key={route.key}
              item={item}
              active={active}
              isFirst={i === 0}
              firstRef={firstNavRef}
              badgeCount={badgeCount}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </ScrollView>

      {/* Footer — real server health indicator */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.footerDot, { backgroundColor: dotColor }]} />
        <Text style={styles.footerText}>{statusLabel}</Text>
      </View>
    </View>
  );
}

export default function TabLayout() {
  // Global catch-all: if no screen BackHandler consumed the press, move focus
  // to the sidebar instead of letting Android exit the app.
  // Fires LAST (LIFO) so per-screen handlers always get first pick.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sidebarNav.focus();
      return true; // always consume — never exit via Back from tab navigation
    });
    return () => sub.remove();
  }, []);

  return (
    <Tabs
      initialRouteName="home"
      tabBar={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { marginLeft: SIDEBAR_W },
      }}
    >
      <Tabs.Screen name="home"      options={{ title: 'Home'      }} />
      <Tabs.Screen name="index"     options={{ title: 'Live TV'   }} />
      <Tabs.Screen name="guide"     options={{ title: 'TV Guide'  }} />
      <Tabs.Screen name="catchup"   options={{ title: 'Catch Up'  }} />
      <Tabs.Screen name="movies"    options={{ title: 'Movies'    }} />
      <Tabs.Screen name="series"    options={{ title: 'Series'    }} />
      <Tabs.Screen name="reminders" options={{ title: 'Reminders' }} />
      <Tabs.Screen name="telegram"  options={{ title: 'Telegram'  }} />
      <Tabs.Screen name="search"    options={{ title: 'Search'    }} />
      <Tabs.Screen name="settings"  options={{ title: 'Settings'  }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: SIDEBAR_W,
    backgroundColor: '#0E0E1A',
    borderRightWidth: 1,
    borderRightColor: '#1E1E30',
    zIndex: 100,
    flexDirection: 'column',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 20,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E1E30',
  },
  brandIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#1A1A28',
    borderWidth: 1, borderColor: '#252538',
    justifyContent: 'center', alignItems: 'center',
  },
  brandPlay: { fontSize: 14, color: '#3B82F6' },
  brandName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#F2F2F2', letterSpacing: -0.3 },
  brandSub:  { fontSize: 9,  fontFamily: 'Inter_600SemiBold', color: '#3B82F6', letterSpacing: 2 },
  nav: { flex: 1, paddingHorizontal: 10 },
  navContent: { gap: 2, paddingVertical: 2 },
  navItem: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, position: 'relative',
  },
  navItemActive: { backgroundColor: 'rgba(59,130,246,0.12)' },
  navItemFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  navIconWrapper: { width: 22, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  navIcon: { fontSize: 15, textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#0E0E1A',
  },
  badgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    lineHeight: 12,
  },
  navLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#6B7280' },
  navLabelActive: { fontFamily: 'Inter_600SemiBold', color: '#F2F2F2' },
  activePip: {
    position: 'absolute', left: 0, top: '25%', bottom: '25%',
    width: 3, backgroundColor: '#3B82F6', borderRadius: 99,
  },
  footer: {
    paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#1E1E30',
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  footerDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: '#22C55E' },
  footerText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#6B7280' },
});
