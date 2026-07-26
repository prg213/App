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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import {
  getXtreamAccountInfo,
  parseXtreamCredsFromM3u,
} from '@/services/xtreamApi';

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { credentials, deviceMac, logout } = useAppContext();
  const [loggingOut, setLoggingOut] = useState(false);

  // Resolve Xtream credentials — either directly (xtream type) or parsed from M3U URL
  const xtreamCreds =
    credentials?.type === 'xtream' && credentials.host && credentials.username && credentials.password
      ? { host: credentials.host, username: credentials.username, password: credentials.password }
      : credentials?.type === 'm3u' && credentials.m3uUrl
      ? parseXtreamCredsFromM3u(credentials.m3uUrl)
      : null;

  const { data: accountInfo, isLoading: accountLoading } = useQuery({
    queryKey: ['account-info', credentials],
    queryFn: () => getXtreamAccountInfo(xtreamCreds!),
    enabled: !!xtreamCreds,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const handleRefreshContent = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['live-channels'] });
    queryClient.invalidateQueries({ queryKey: ['live-categories'] });
    queryClient.invalidateQueries({ queryKey: ['vod-streams'] });
    queryClient.invalidateQueries({ queryKey: ['vod-categories'] });
    queryClient.invalidateQueries({ queryKey: ['series-list'] });
    queryClient.invalidateQueries({ queryKey: ['series-categories'] });
    Alert.alert('Content Refreshed', 'Channels, movies and series will reload on next view.');
  };

  const handleRefreshEPG = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    queryClient.invalidateQueries({ queryKey: ['xmltv-epg'] });
    Alert.alert('EPG Refreshed', 'TV guide data will reload. This may take a moment.');
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

  function InfoRow({ label, value, dimValue }: { label: string; value?: string | null; dimValue?: boolean }) {
    if (!value) return null;
    return (
      <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text
          style={[styles.infoValue, { color: dimValue ? colors.mutedForeground : colors.foreground }]}
          numberOfLines={1}
          selectable
        >
          {value}
        </Text>
      </View>
    );
  }

  function ActionRow({ title, sub, icon, onPress, destructive }: {
    title: string; sub?: string; icon: string; onPress: () => void; destructive?: boolean;
  }) {
    return (
      <TouchableOpacity
        style={[styles.actionRow, { borderBottomColor: colors.border }]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.actionTitle, { color: destructive ? colors.destructive : colors.foreground }]}>{title}</Text>
          {sub ? <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>{sub}</Text> : null}
        </View>
        <Text style={{ color: destructive ? colors.destructive : colors.mutedForeground, fontSize: 18 }}>{icon}</Text>
      </TouchableOpacity>
    );
  }

  // Expiry date — from account info query, or from M3U URL if parseable
  const expiry = accountInfo?.expDate ?? null;
  const expiryLoading = accountLoading && !!xtreamCreds;

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
          {/* Type badge */}
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Type</Text>
            <View style={[styles.typeBadge, { backgroundColor: `${typeColor}20` }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
          </View>

          {/* Xtream: show username only (hide host + password label) */}
          {credentials?.type === 'xtream' && (
            <InfoRow label="Username" value={credentials.username} />
          )}

          {/* M3U: show truncated URL */}
          {credentials?.type === 'm3u' && credentials.m3uUrl && (
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>M3U URL</Text>
              <Text style={[styles.infoValue, { color: colors.mutedForeground }]} numberOfLines={1}>
                {credentials.m3uUrl.length > 40
                  ? credentials.m3uUrl.slice(0, 20) + '…' + credentials.m3uUrl.slice(-18)
                  : credentials.m3uUrl}
              </Text>
            </View>
          )}

          {/* Expiry date — shown for both xtream and parseable M3U */}
          <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Expires</Text>
            {expiryLoading ? (
              <Text style={[styles.infoValue, { color: colors.mutedForeground }]}>Loading…</Text>
            ) : expiry ? (
              <Text style={[styles.infoValue, { color: colors.foreground }]}>{expiry}</Text>
            ) : (
              <Text style={[styles.infoValue, { color: colors.mutedForeground }]}>—</Text>
            )}
          </View>

          {/* Status */}
          {accountInfo?.status && (
            <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Status</Text>
              <View style={[styles.typeBadge, {
                backgroundColor: accountInfo.status === 'Active' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              }]}>
                <Text style={[styles.typeBadgeText, {
                  color: accountInfo.status === 'Active' ? '#22C55E' : '#EF4444',
                }]}>{accountInfo.status}</Text>
              </View>
            </View>
          )}

          {/* Connections */}
          {accountInfo?.maxConnections != null && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Connections</Text>
              <Text style={[styles.infoValue, { color: colors.foreground }]}>
                {accountInfo.activeConnections ?? 0} / {accountInfo.maxConnections}
              </Text>
            </View>
          )}
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
          <ActionRow
            title="Refresh All Content"
            sub="Reload channels, movies & series"
            icon="↻"
            onPress={handleRefreshContent}
          />
          <ActionRow
            title="Refresh TV Guide (EPG)"
            sub="Reload electronic programme guide"
            icon="📡"
            onPress={handleRefreshEPG}
          />
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
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  actionTitle: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  actionSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  logoutRow: { paddingHorizontal: 14, paddingVertical: 16, alignItems: 'center' },
  logoutText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
