import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const SIDEBAR_W = 190;

const NAV = [
  { name: 'index',    label: 'Live TV', icon: '📡' },
  { name: 'guide',    label: 'TV Guide', icon: '📋' },
  { name: 'movies',   label: 'Movies',  icon: '🎬' },
  { name: 'series',   label: 'Series',  icon: '📺' },
  { name: 'search',   label: 'Search',  icon: '🔍' },
  { name: 'settings', label: 'Settings',icon: '⚙'  },
];

function Sidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

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
      <View style={styles.nav}>
        {state.routes.map((route, i) => {
          const focused = state.index === i;
          const item = NAV.find((n) => n.name === route.name);
          if (!item) return null;

          return (
            <TouchableOpacity
              key={route.key}
              style={[styles.navItem, focused && styles.navItemActive]}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!event.defaultPrevented) navigation.navigate(route.name);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.navIcon}>{item.icon}</Text>
              <Text style={[styles.navLabel, focused && styles.navLabelActive]}>
                {item.label}
              </Text>
              {focused && <View style={styles.activePip} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.footerDot} />
        <Text style={styles.footerText}>Connected</Text>
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { marginLeft: SIDEBAR_W },
      }}
    >
      <Tabs.Screen name="index"    options={{ title: 'Live TV'  }} />
      <Tabs.Screen name="guide"    options={{ title: 'TV Guide' }} />
      <Tabs.Screen name="movies"   options={{ title: 'Movies'   }} />
      <Tabs.Screen name="series"   options={{ title: 'Series'   }} />
      <Tabs.Screen name="search"   options={{ title: 'Search'   }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
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
  nav: { flex: 1, paddingHorizontal: 10, gap: 2 },
  navItem: {
    flexDirection: 'row', alignItems: 'center',
    gap: 10, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, position: 'relative',
  },
  navItemActive: { backgroundColor: 'rgba(59,130,246,0.12)' },
  navIcon: { fontSize: 15, width: 22, textAlign: 'center' },
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
