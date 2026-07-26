import React, { useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { credentials, deviceMac, logout } = useAppContext();
  const queryClient = useQueryClient();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleRefreshContent = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries();
    Alert.alert('Content Refreshed', 'All channels, movies, and series will reload on next view.');
  };

  const handleLogout = () => {
    Alert.alert(
      'Unlink Device',
      'This will remove your IPTV credentials and return you to the activation screen. Your favorites and watch history will be cleared.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink Device',
          style: 'destructive',
          onPress: async () => {
            setLoggingOut(true);
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await logout();
          },
        },
      ],
    );
  };

  const typeLabel = credentials?.type === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';
  const typeColor = credentials?.type === 'xtream' ? '#3B82F6' : '#22C55E';

  function Row({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.rowValue, { color: colors.foreground }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0), borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20),
        }}
      >
        {/* Connection */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CONNECTION</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>Type</Text>
            <View style={[styles.typeBadge, { backgroundColor: `${typeColor}20` }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
          </View>
          {credentials?.type === 'xtream' && (
            <>
              <Row label="Host" value={credentials.host} />
              <Row label="Username" value={credentials.username} />
              <Row label="Password" value={credentials.password ? '••••••••' : null} />
            </>
          )}
          {credentials?.type === 'm3u' && (
            <Row label="M3U URL" value={credentials.m3uUrl} />
          )}
        </View>

        {/* Device */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DEVICE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>MAC Address</Text>
            <Text style={[styles.macText, { color: colors.foreground }]} selectable>
              {deviceMac}
            </Text>
          </View>
        </View>

        {/* About */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>App</Text>
            <Text style={[styles.rowValue, { color: colors.foreground }]}>StreamVault IPTV</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>Version</Text>
            <Text style={[styles.rowValue, { color: colors.foreground }]}>1.0.0</Text>
          </View>
        </View>

        {/* Content */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CONTENT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.actionRow} onPress={handleRefreshContent} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>Refresh All Content</Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>Reload channels, movies & series</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>↻</Text>
          </TouchableOpacity>
        </View>

        {/* Danger Zone */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.logoutRow}
            onPress={handleLogout}
            activeOpacity={0.7}
            disabled={loggingOut}
          >
            <Text style={[styles.logoutText, { color: colors.destructive }]}>
              Logout / Unlink Device
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  rowValue: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    maxWidth: '60%',
    textAlign: 'right',
  },
  macText: {
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Courier New', android: 'monospace', default: 'Inter_500Medium' }),
    letterSpacing: 1,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
  },
  typeBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  actionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
  actionSub: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  logoutRow: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
