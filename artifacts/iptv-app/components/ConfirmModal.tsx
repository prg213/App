/**
 * ConfirmModal — TV/D-pad safe replacement for Alert.alert destructive confirmations.
 *
 * On mobile the native Alert is fine, but on Fire OS the platform dialog's D-pad
 * focus is OS-controlled and not guaranteed.  This modal uses FocusablePressable for
 * both buttons so the remote can always reach Cancel and the confirm action.
 *
 * Focus behaviour:
 *  - Modal.onShow → imperative focus on the confirm button (150 ms delay for Fire OS).
 *  - onRequestClose (hardware BACK) → calls onCancel.
 *  - onCancel / onConfirm → both restore focus to openerRef after 150 ms so the user
 *    lands back on the row that triggered the dialog.
 */

import React, { useRef } from 'react';
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FocusablePressable } from '@/components/FocusablePressable';
import { useColors } from '@/hooks/useColors';
import { requestTvFocus } from '@/lib/tvFocus';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  /** Label for the destructive/primary action button. Default: "Confirm". */
  confirmLabel?: string;
  /** Label for the dismiss button. Default: "Cancel". */
  cancelLabel?: string;
  /** When true the confirm button is rendered in red. Default: false. */
  destructive?: boolean;
  /** Ref of the element that opened the dialog — focus is restored here on close. */
  openerRef?: React.RefObject<View | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  openerRef,
  onConfirm,
  onCancel,
}: Props) {
  const colors = useColors();
  const confirmRef = useRef<View>(null);

  const restoreOpener = () => {
    if (!Platform.isTV || !openerRef?.current) return;
    setTimeout(() => requestTvFocus(openerRef.current), 150);
  };

  const handleConfirm = () => {
    onConfirm();
    restoreOpener();
  };

  const handleCancel = () => {
    onCancel();
    restoreOpener();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCancel}
      onShow={() => {
        // TV: focus the confirm/action button so the user can immediately press
        // OK to proceed or D-pad left to Cancel, without navigating from scratch.
        if (Platform.isTV) {
          setTimeout(() => requestTvFocus(confirmRef.current), 150);
        }
      }}
    >
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text>
          <View style={styles.buttons}>
            <FocusablePressable
              style={[styles.btn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              focusedStyle={styles.btnFocused}
              onPress={handleCancel}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>{cancelLabel}</Text>
            </FocusablePressable>
            <FocusablePressable
              ref={confirmRef}
              style={[
                styles.btn,
                {
                  backgroundColor: destructive ? '#EF4444' : colors.primary,
                  borderColor: 'transparent',
                },
              ]}
              focusedStyle={styles.btnFocused}
              onPress={handleConfirm}
            >
              <Text style={[styles.btnText, { color: '#fff' }]}>{confirmLabel}</Text>
            </FocusablePressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialog: {
    width: 420,
    maxWidth: '90%',
    borderRadius: 14,
    borderWidth: 1,
    padding: 28,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    marginBottom: 2,
  },
  message: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnFocused: {
    opacity: 0.85,
    transform: [{ scale: 1.04 }],
  },
  btnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
