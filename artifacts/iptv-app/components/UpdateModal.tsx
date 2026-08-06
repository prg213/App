/**
 * UpdateModal — shown when checkForUpdate() returns a newer build.
 *
 * Flow:
 *   1. User sees release name + "Download & Install" / "Later"
 *   2. On confirm: APK is downloaded to the cache dir with a progress bar
 *      (expo-file-system v57 DownloadTask API)
 *   3. On completion: Android package installer launched via expo-intent-launcher
 *      using getContentUriAsync (FileProvider, works Android 7+)
 *
 * Works on Android phones and Fire TV (D-pad navigable).
 * Requires android.permission.REQUEST_INSTALL_PACKAGES in the manifest.
 */
import React, { useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DownloadTask, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { startActivityAsync } from 'expo-intent-launcher';
import type { UpdateInfo } from '@/services/updateService';
import { CURRENT_BUILD } from '@/services/updateService';

interface Props {
  update: UpdateInfo;
  onDismiss: () => void;
}

type Stage = 'prompt' | 'downloading' | 'ready' | 'error';

export function UpdateModal({ update, onDismiss }: Props) {
  const [stage, setStage] = useState<Stage>('prompt');
  const [progress, setProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const taskRef = useRef<DownloadTask | null>(null);
  const apkFileRef = useRef<File | null>(null);

  const updateProgress = (pct: number) => {
    setProgress(pct);
    Animated.timing(progressAnim, {
      toValue: pct,
      duration: 120,
      useNativeDriver: false,
    }).start();
  };

  const startDownload = async () => {
    setStage('downloading');
    updateProgress(0);

    try {
      const dest = new File(Paths.cache, 'StreamVault-update.apk');
      // Remove stale file if present
      if (dest.exists) dest.delete();

      const task = new DownloadTask(update.downloadUrl, dest);
      taskRef.current = task;

      task.addListener('progress', ({ bytesWritten, totalBytes }) => {
        if (totalBytes > 0) updateProgress(bytesWritten / totalBytes);
      });

      const downloaded = await task.downloadAsync();
      taskRef.current = null;

      if (!downloaded) {
        // Paused or cancelled
        setStage('prompt');
        return;
      }

      apkFileRef.current = downloaded;
      updateProgress(1);
      setStage('ready');
    } catch (e) {
      console.warn('[UpdateModal] download failed', e);
      taskRef.current = null;
      setStage('error');
    }
  };

  const installApk = async () => {
    const file = apkFileRef.current;
    if (!file) return;
    try {
      // getContentUriAsync converts file:// → content:// via FileProvider
      const contentUri = await getContentUriAsync(file.uri);
      await startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/vnd.android.package-archive',
      });
    } catch (e) {
      console.warn('[UpdateModal] install intent failed', e);
      Alert.alert(
        'Install Failed',
        'Could not open the installer. Make sure "Install unknown apps" is enabled for StreamVault in Android Settings.',
        [{ text: 'OK' }],
      );
    }
  };

  const cancelDownload = () => {
    taskRef.current?.cancel();
    taskRef.current = null;
    onDismiss();
  };

  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={stage === 'downloading' ? undefined : onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* ── Header badge ── */}
          <Text style={styles.badge}>UPDATE AVAILABLE</Text>

          <Text style={styles.title}>{update.releaseName}</Text>
          <Text style={styles.sub}>
            Currently on build {CURRENT_BUILD} · New build {update.buildNumber}
          </Text>

          {/* ── Progress bar ── */}
          {stage === 'downloading' && (
            <>
              <View style={styles.progressTrack}>
                <Animated.View style={[styles.progressFill, { width: barWidth }]} />
              </View>
              <Text style={styles.progressLabel}>
                Downloading… {Math.round(progress * 100)}%
              </Text>
            </>
          )}

          {/* ── Error message ── */}
          {stage === 'error' && (
            <Text style={styles.errorText}>
              Download failed. Check your connection and try again.
            </Text>
          )}

          {/* ── Buttons ── */}
          <View style={styles.actions}>
            {stage === 'prompt' && (
              <>
                <Pressable
                  focusable
                  hasTVPreferredFocus
                  style={(s: any) => [styles.btn, styles.btnPrimary, s.focused && styles.btnFocused]}
                  onPress={startDownload}
                >
                  <Text style={styles.btnPrimaryText}>⬇  Download & Install</Text>
                </Pressable>
                <Pressable
                  focusable
                  style={(s: any) => [styles.btn, styles.btnSecondary, s.focused && styles.btnFocused]}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Later</Text>
                </Pressable>
              </>
            )}

            {stage === 'downloading' && (
              <Pressable
                focusable
                style={(s: any) => [styles.btn, styles.btnSecondary, s.focused && styles.btnFocused]}
                onPress={cancelDownload}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </Pressable>
            )}

            {stage === 'ready' && (
              <>
                <Pressable
                  focusable
                  hasTVPreferredFocus
                  style={(s: any) => [styles.btn, styles.btnPrimary, s.focused && styles.btnFocused]}
                  onPress={installApk}
                >
                  <Text style={styles.btnPrimaryText}>📦  Install Now</Text>
                </Pressable>
                <Pressable
                  focusable
                  style={(s: any) => [styles.btn, styles.btnSecondary, s.focused && styles.btnFocused]}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Install Later</Text>
                </Pressable>
              </>
            )}

            {stage === 'error' && (
              <>
                <Pressable
                  focusable
                  hasTVPreferredFocus
                  style={(s: any) => [styles.btn, styles.btnPrimary, s.focused && styles.btnFocused]}
                  onPress={startDownload}
                >
                  <Text style={styles.btnPrimaryText}>Retry</Text>
                </Pressable>
                <Pressable
                  focusable
                  style={(s: any) => [styles.btn, styles.btnSecondary, s.focused && styles.btnFocused]}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: Platform.isTV ? 520 : '88%',
    backgroundColor: '#13131A',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.35)',
    padding: 28,
    gap: 12,
  },
  badge: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#3B82F6',
    letterSpacing: 1.2,
    backgroundColor: 'rgba(59,130,246,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#F2F2F2',
  },
  sub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.45)',
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 3,
  },
  progressLabel: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: '#F87171',
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  btnPrimary: { backgroundColor: '#3B82F6' },
  btnSecondary: { backgroundColor: 'rgba(255,255,255,0.07)' },
  btnFocused: { opacity: 0.85, transform: [{ scale: 1.03 }] },
  btnPrimaryText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  btnSecondaryText: {
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.6)',
  },
});
