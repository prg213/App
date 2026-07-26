import React, { useState } from 'react';
import {
  Alert,
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
  const queryClient = useQueryClient();
  const { credentials, deviceMac, logout } = useAppContext();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleRefreshContent = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries();
    Alert.alert('Content Refreshed', 'All channels, movies, and series will reload on next view.');
  };

  const handleLogout = () => {
    Alert.alert('Unlink Device', 'This will remove your IPTV credentials and return you to the activation screen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unlink Device', style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await logout();
        },
      },
    ]);
  };

  const typeLabel = credentials?.type === 'xtream' ? 'Xtream Codes' : 'M3U Playlist';
  const typeColor = credentials?.type === 'xtream' ? '#3B82F6' : '#22C55E';

  function InfoRow({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
      <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={1} selectable>{value}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Left: Connection info */}
      <ScrollView
        style={[styles.left, { borderRightColor: colors.border }]}
        contentContainerStyle={[styles.leftContent, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Settings</Text>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CONNECTION</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Type</Text>
            <View style={[styles.typeBadge, { backgroundColor: `${typeColor}20` }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
          </View>
          {credentials?.type === 'xtream' && (
            <>
              <InfoRow label="Host" value={credentials.host} />
              <InfoRow label="Username" value={credentials.username} />
              <InfoRow label="Password" value={credentials.password ? '••••••••' : null} />
            </>
          )}
          {credentials?.type === 'm3u' && <InfoRow label="M3U URL" value={credentials.m3uUrl} />}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DEVICE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>MAC Address</Text>
            <Text style={[styles.macText, { color: colors.foreground }]} selectable>{deviceMac}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Right: Actions */}
      <ScrollView
        style={styles.right}
        contentContainerStyle={[styles.rightContent, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16, paddingRight: insets.right + 16 }]}
        showsVerticalScrollIndicator={false}
      >
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

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ABOUT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>App</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>StreamVault IPTV</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Version</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>1.0.0</Text>
          </View>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.7} disabled={loggingOut}>
            <Text style={[styles.logoutText, { color: colors.destructive }]}>Logout / Unlink Device</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  left: { flex: 1, borderRightWidth: StyleSheet.hairlineWidth },
  leftContent: { paddingHorizontal: 20, gap: 8 },
  right: { flex: 1 },
  rightContent: { paddingHorizontal: 20, gap: 8 },
  screenTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 8 },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, marginTop: 12, marginBottom: 4 },
  card: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  infoValue: { fontSize: 13, fontFamily: 'Inter_500Medium', maxWidth: '65%', textAlign: 'right' },
  macText: { fontSize: 12, fontFamily: 'Inter_500Medium', letterSpacing: 1 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 99 },
  typeBadgeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  actionTitle: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  actionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  logoutRow: { paddingHorizontal: 14, paddingVertical: 16, alignItems: 'center' },
  logoutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
