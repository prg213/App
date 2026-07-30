import React from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity } from 'react-native';

interface Props {
  wrapStyle?: object;
}

/**
 * Cast button for iOS and web.
 *
 * iOS:  expo-video's VideoView uses AVPlayer, which natively routes video to
 *       AirPlay devices via iOS Control Centre. This button shows an Alert that
 *       guides the user to the native AirPlay picker.
 *
 * Web:  Casting is not supported; returns null.
 */
export default function CastButton({ wrapStyle }: Props) {
  if (Platform.OS === 'web') return null;

  // iOS only
  const handlePress = () => {
    Alert.alert(
      'AirPlay',
      'Swipe down from the top-right corner to open Control Centre, then tap the AirPlay icon (📡) to mirror to an Apple TV or AirPlay 2 device.',
      [{ text: 'OK' }],
    );
  };

  return (
    <TouchableOpacity
      style={[styles.btn, wrapStyle]}
      onPress={handlePress}
      activeOpacity={0.8}
      accessibilityLabel="AirPlay"
    >
      <Text style={styles.icon}>📡</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  icon: { fontSize: 16 },
});
