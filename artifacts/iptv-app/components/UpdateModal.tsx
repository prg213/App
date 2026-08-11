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
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
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

  // TV: refs for the primary action button in each stage.
  // Focused imperatively via onShow (initial) + useEffect([stage]) (transitions).
  // Replaces hasTVPreferredFocus which re-fires requestFocus on every re-render.
  const promptPrimaryRef      = useRef<View>(null);
  const downloadingCancelRef  = useRef<View>(null);
  const readyPrimaryRef       = useRef<View>(null);
  const errorPrimaryRef       = useRef<View>(null);
  // Skip the first useEffect([stage]) run — onShow handles the initial focus.
  const stageChangedRef = useRef(false);

  useEffect(() => {
    if (!Platform.isTV) return;
    if (!stageChangedRef.current) return; // onShow handles initial open
    const t = setTimeout(() => {
      if (stage === 'prompt')      (promptPrimaryRef.current     as any)?.focus?.();
      else if (stage === 'downloading') (downloadingCancelRef.current as any)?.focus?.();
      else if (stage === 'ready')  (readyPrimaryRef.current      as any)?.focus?.();
      else if (stage === 'error')  (errorPrimaryRef.current      as any)?.focus?.();
    }, 80);
    return () => clearTimeout(t);
  }, [stage]);

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
      // getContentUriAsync converts file:// → content:// via FileProvider.
      // Flags:
      //   FLAG_GRANT_READ_URI_PERMISSION = 0x00000001 (let installer read the file)
      //   FLAG_ACTIVITY_NEW_TASK         = 0x10000000 (required on Fire OS / Android 11+
      //                                               to launch an activity from a non-
      //                                               activity context)
      const contentUri = await getContentUriAsync(file.uri);
      await startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 0x10000001, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
        type: 'application/vnd.android.package-archive',
      });
    } catch (e) {
      console.warn('[UpdateModal] install intent failed', e);
      Alert.alert(
        'Install Failed',
        Platform.isTV
          ? 'StreamVault needs permission to install updates.\n\n' +
            'Go to:\nSettings → My Fire TV → Developer Options → Install Unknown Apps → StreamVault → Allow\n\n' +
            'Then press "Install Now" again.'
          : 'Could not open the installer.\n\n' +
            'Go to Settings → Apps → Special App Access → Install Unknown Apps → StreamVault → Allow',
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
      onRequestClose={stage === 'downloading' ? cancelDownload : onDismiss}
      onShow={() => {
        // TV: focus the primary button on first open.
        // Stage transitions are handled by the useEffect([stage]) above.
        if (!Platform.isTV) return;
        stageChangedRef.current = true;
        setTimeout(() => (promptPrimaryRef.current as any)?.focus?.(), 80);
      }}
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

          {/* ── Buttons ──
              FocusablePressable: cyan focus ring on Fire TV.
              Focus is managed imperatively via refs + onShow/useEffect([stage])
              instead of hasTVPreferredFocus which races on re-renders. */}
          <View style={styles.actions}>
            {stage === 'prompt' && (
              <>
                <FocusablePressable
                  ref={promptPrimaryRef}
                  style={styles.btn}
                  focusedStyle={[styles.btnPrimary, styles.btnFocused]}
                  onPress={startDownload}
                >
                  <Text style={styles.btnPrimaryText}>⬇  Download & Install</Text>
                </FocusablePressable>
                <FocusablePressable
                  style={[styles.btn, styles.btnSecondary]}
                  focusedStyle={styles.btnFocused}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Later</Text>
                </FocusablePressable>
              </>
            )}

            {stage === 'downloading' && (
              <FocusablePressable
                ref={downloadingCancelRef}
                style={[styles.btn, styles.btnSecondary]}
                focusedStyle={styles.btnFocused}
                onPress={cancelDownload}
              >
                <Text style={styles.btnSecondaryText}>Cancel</Text>
              </FocusablePressable>
            )}

            {stage === 'ready' && (
              <>
                <FocusablePressable
                  ref={readyPrimaryRef}
                  style={[styles.btn, styles.btnPrimary]}
                  focusedStyle={styles.btnFocused}
                  onPress={installApk}
                >
                  <Text style={styles.btnPrimaryText}>📦  Install Now</Text>
                </FocusablePressable>
                <FocusablePressable
                  style={[styles.btn, styles.btnSecondary]}
                  focusedStyle={styles.btnFocused}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Install Later</Text>
                </FocusablePressable>
              </>
            )}

            {stage === 'error' && (
              <>
                <FocusablePressable
                  ref={errorPrimaryRef}
                  style={[styles.btn, styles.btnPrimary]}
                  focusedStyle={styles.btnFocused}
                  onPress={startDownload}
                >
                  <Text style={styles.btnPrimaryText}>Retry</Text>
                </FocusablePressable>
                <FocusablePressable
                  style={[styles.btn, styles.btnSecondary]}
                  focusedStyle={styles.btnFocused}
                  onPress={onDismiss}
                >
                  <Text style={styles.btnSecondaryText}>Cancel</Text>
                </FocusablePressable>
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
