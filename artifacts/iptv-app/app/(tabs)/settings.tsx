import React, { useEffect, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAppContext } from '@/context/AppContext';
import { useParentalContext, RATING_OPTIONS } from '@/context/ParentalContext';
import { PinPad } from '@/components/PinPad';
import {
  getXtreamAccountInfo,
  parseXtreamCredsFromM3u,
} from '@/services/xtreamApi';
import { StorageService } from '@/services/storage';
import { rescheduleRemindersForLeadTime } from '@/services/reminderReschedule';
import type { MaxRating } from '@/types';

const LEAD_TIME_OPTIONS: { value: 5 | 10 | 15; label: string }[] = [
  { value: 5,  label: '5 minutes before' },
  { value: 10, label: '10 minutes before' },
  { value: 15, label: '15 minutes before' },
];

type PinFlowKind =
  | 'set-first'   // no existing PIN — set a new one
  | 'verify-to-change-rating'
  | 'verify-to-toggle-lock'
  | 'verify-to-change-pin'
  | 'change-pin'  // after old PIN verified, enter new PIN
  | 'verify-to-disable'
  | 'verify-to-blocked-channels'
  | null;

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { credentials, deviceMac, logout } = useAppContext();
  const {
    isPinSet,
    lockEnabled,
    maxRating,
    blockedChannels,
    verifyPin,
    setPin,
    disablePin,
    setLockEnabled,
    setMaxRating,
  } = useParentalContext();
  const [loggingOut, setLoggingOut] = useState(false);
  const [reminderLeadMins, setReminderLeadMins] = useState<5 | 10 | 15>(5);
  const [showLeadTimeSheet, setShowLeadTimeSheet] = useState(false);

  useEffect(() => {
    StorageService.getReminderLeadMins().then((v) => setReminderLeadMins(v as 5 | 10 | 15));
  }, []);

  const handleLeadTimeSelect = async (value: 5 | 10 | 15) => {
    Haptics.selectionAsync();
    await StorageService.setReminderLeadMins(value);
    setReminderLeadMins(value);
    setShowLeadTimeSheet(false);

    // #99: Re-schedule all future reminders with the new lead time
    const { tooSoon } = await rescheduleRemindersForLeadTime();

    // #114: Tell the Reminders tab to re-render cards with the new lead time.
    // This is a no-op when the tab is not mounted; when it is mounted (e.g. on
    // a tablet split-view) useFocusEffect(load) will pick up the signal.
    DeviceEventEmitter.emit('reminders:changed');

    // #110: Warn if any reminders start too soon to fire at the new lead time
    if (tooSoon > 0) {
      Alert.alert(
        'Some reminders not updated',
        `${tooSoon} reminder${tooSoon > 1 ? 's start' : ' starts'} too soon to fire ${value} minute${value > 1 ? 's' : ''} early. ${tooSoon > 1 ? 'They' : 'It'} will still appear on-screen.`,
        [{ text: 'OK' }],
      );
    }
  };

  // PIN modal state
  const [pinFlow, setPinFlow] = useState<PinFlowKind>(null);
  const [pendingRating, setPendingRating] = useState<MaxRating | null>(null);
  const [pendingLock, setPendingLock] = useState<boolean | null>(null);
  const [showRatingSheet, setShowRatingSheet] = useState(false);

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

  // ── Parental controls actions ──────────────────────────────────────────────

  const handleRatingPress = (rating: MaxRating) => {
    if (rating === maxRating) { setShowRatingSheet(false); return; }
    if (isPinSet) {
      setPendingRating(rating);
      setShowRatingSheet(false);
      setPinFlow('verify-to-change-rating');
    } else {
      setMaxRating(rating);
      setShowRatingSheet(false);
    }
  };

  const handleLockToggle = (val: boolean) => {
    if (!isPinSet && val) {
      // Must set a PIN first
      setPinFlow('set-first');
      setPendingLock(true);
      return;
    }
    if (isPinSet) {
      setPendingLock(val);
      setPinFlow('verify-to-toggle-lock');
      return;
    }
    setLockEnabled(val);
  };

  const handleSetPinPress = () => {
    if (isPinSet) {
      setPinFlow('verify-to-change-pin');
    } else {
      setPinFlow('set-first');
    }
  };

  const handleDisablePinPress = () => {
    if (!isPinSet) return;
    setPinFlow('verify-to-disable');
  };

  const handleBlockedChannelsPress = () => {
    if (isPinSet) {
      setPinFlow('verify-to-blocked-channels');
    } else {
      router.push('/blocked-channels');
    }
  };

  const handleClearHistory = () => {
    Alert.alert('Clear Watch History', 'Remove all watched items? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear All', style: 'destructive',
        onPress: () => StorageService.clearHistory().catch(() => {}),
      },
    ]);
  };

  const handleClearRecentChannels = () => {
    Alert.alert('Clear Recent Channels', 'Remove all recently-watched channels?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: () => StorageService.clearRecentChannels().catch(() => {}),
      },
    ]);
  };

  // PIN modal success callbacks
  const onPinSuccess = async (pin: string) => {
    if (pinFlow === 'set-first') {
      await setPin(pin);
      // If we were pending a lock toggle, apply it
      if (pendingLock !== null) {
        await setLockEnabled(pendingLock);
        setPendingLock(null);
      }
    } else if (pinFlow === 'verify-to-change-rating' && pendingRating !== null) {
      // Pin was verified (PinPad's verify fn returns true) — now apply the change
      await setMaxRating(pendingRating);
      setPendingRating(null);
    } else if (pinFlow === 'verify-to-toggle-lock' && pendingLock !== null) {
      await setLockEnabled(pendingLock);
      setPendingLock(null);
    } else if (pinFlow === 'verify-to-change-pin') {
      // Old PIN verified — now set new PIN
      setPinFlow('change-pin');
      return; // don't close modal yet
    } else if (pinFlow === 'change-pin') {
      // New PIN set
      await setPin(pin);
    } else if (pinFlow === 'verify-to-disable') {
      const ok = await disablePin(pin);
      if (!ok) return; // shouldn't happen — PinPad's verify already checked
    } else if (pinFlow === 'verify-to-blocked-channels') {
      setPinFlow(null);
      router.push('/blocked-channels');
      return;
    }
    setPinFlow(null);
  };

  const ratingLabel = RATING_OPTIONS.find((r) => r.value === maxRating)?.label ?? 'All content';

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

  // Determine which PIN pad title/mode to show
  const pinModalTitle = () => {
    switch (pinFlow) {
      case 'set-first': return 'Set a PIN';
      case 'change-pin': return 'Enter new PIN';
      case 'verify-to-change-rating':
      case 'verify-to-toggle-lock':
      case 'verify-to-change-pin':
      case 'verify-to-disable':
      case 'verify-to-blocked-channels':
        return 'Confirm your PIN';
      default: return 'Enter PIN';
    }
  };

  const isVerifyMode = pinFlow === 'verify-to-change-rating' ||
    pinFlow === 'verify-to-toggle-lock' ||
    pinFlow === 'verify-to-change-pin' ||
    pinFlow === 'verify-to-disable' ||
    pinFlow === 'verify-to-blocked-channels';

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

          {/* Expiry date */}
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

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>HISTORY</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActionRow
            title="Watch History"
            sub="View and remove individual watched items"
            icon="🕐"
            onPress={() => router.push('/watch-history')}
          />
          <ActionRow
            title="Clear Watch History"
            sub="Remove all watched items"
            icon="🗑️"
            onPress={handleClearHistory}
          />
          <ActionRow
            title="Clear Recent Channels"
            sub="Remove the recently-watched channel rail"
            icon="⏮"
            onPress={handleClearRecentChannels}
          />
        </View>

        {/* ── Notifications ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTIFICATIONS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomWidth: 0 }]}
            onPress={() => setShowLeadTimeSheet(true)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>Reminder Lead Time</Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                {LEAD_TIME_OPTIONS.find((o) => o.value === reminderLeadMins)?.label ?? '5 minutes before'}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>⏰</Text>
          </TouchableOpacity>
        </View>

        {/* ── Parental Controls ── */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PARENTAL CONTROLS</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Content Rating picker */}
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={() => setShowRatingSheet(true)}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>Content Rating</Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>{ratingLabel}</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>›</Text>
          </TouchableOpacity>

          {/* App Lock toggle */}
          <View style={[styles.actionRow, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>App Lock PIN</Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                {lockEnabled ? 'Locked after 2 min in background' : 'Disabled'}
              </Text>
            </View>
            <Switch
              value={lockEnabled}
              onValueChange={handleLockToggle}
              trackColor={{ true: '#3B82F6' }}
              thumbColor="#fff"
            />
          </View>

          {/* Set / Change PIN */}
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={handleSetPinPress}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>
                {isPinSet ? 'Change PIN' : 'Set PIN'}
              </Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                {isPinSet ? 'Update your 4-digit PIN' : 'Protect parental settings'}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>🔒</Text>
          </TouchableOpacity>

          {/* Blocked Channels */}
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={handleBlockedChannelsPress}
            activeOpacity={0.7}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.actionTitle, { color: colors.foreground }]}>Blocked Channels</Text>
              <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>
                {blockedChannels.length > 0
                  ? `${blockedChannels.length} channel${blockedChannels.length === 1 ? '' : 's'} blocked`
                  : 'Hide specific Live TV channels'}
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 18 }}>🚫</Text>
          </TouchableOpacity>

          {/* Remove PIN */}
          {isPinSet && (
            <TouchableOpacity style={styles.actionRow} onPress={handleDisablePinPress} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionTitle, { color: colors.destructive }]}>Remove PIN</Text>
                <Text style={[styles.actionSub, { color: colors.mutedForeground }]}>Disable all PIN protection</Text>
              </View>
              <Text style={{ color: colors.destructive, fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          )}
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

      {/* ── Reminder lead time picker sheet ── */}
      <Modal
        visible={showLeadTimeSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowLeadTimeSheet(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setShowLeadTimeSheet(false)}
        />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: colors.mutedForeground }]}>REMINDER LEAD TIME</Text>
          {LEAD_TIME_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.sheetRow, { borderBottomColor: colors.border }]}
              onPress={() => handleLeadTimeSelect(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetRowText, { color: colors.foreground }]}>{opt.label}</Text>
              {reminderLeadMins === opt.value && <Text style={{ color: '#3B82F6', fontSize: 18 }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* ── Rating picker sheet ── */}
      <Modal
        visible={showRatingSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowRatingSheet(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setShowRatingSheet(false)}
        />
        <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: colors.mutedForeground }]}>CONTENT RATING CEILING</Text>
          {RATING_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.sheetRow, { borderBottomColor: colors.border }]}
              onPress={() => handleRatingPress(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sheetRowText, { color: colors.foreground }]}>{opt.label}</Text>
              {maxRating === opt.value && <Text style={{ color: '#3B82F6', fontSize: 18 }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* ── PIN entry modal ── */}
      <Modal
        visible={pinFlow !== null}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setPinFlow(null)}
      >
        <PinPad
          mode={isVerifyMode || pinFlow === 'change-pin' ? (pinFlow === 'change-pin' ? 'set' : 'verify') : 'set'}
          title={pinModalTitle()}
          verify={isVerifyMode ? verifyPin : undefined}
          onSuccess={onPinSuccess}
          onCancel={() => { setPinFlow(null); setPendingRating(null); setPendingLock(null); }}
        />
      </Modal>
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
  // Rating sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 12, paddingHorizontal: 0 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(128,128,128,0.4)', alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, paddingHorizontal: 20, paddingBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetRowText: { fontSize: 15, fontFamily: 'Inter_400Regular' },
});
