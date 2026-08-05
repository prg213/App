import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import VideoAirPlayButton from 'expo-video/build/VideoAirPlayButton';

interface Props {
  wrapStyle?: object;
}

/**
 * Cast button for iOS only.
 *
 * iOS:  Uses expo-video's VideoAirPlayButton which renders the native
 *       AVRoutePickerView — tapping it opens the system AirPlay picker
 *       inline, no Alert or Control Centre trip needed (#24).
 *
 * Android / Web: AirPlay is not available; returns null.
 *       VideoAirPlayButton is an iOS-native component and must NOT be
 *       rendered on Android — it will crash the app.
 */
export default function CastButton({ wrapStyle }: Props) {
  if (Platform.OS !== 'ios') return null;

  return (
    <View style={[styles.btn, wrapStyle]}>
      <VideoAirPlayButton style={styles.airplay} tintColor="#fff" activeTintColor="#8B5CF6" />
    </View>
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
  airplay: {
    width: 28,
    height: 28,
  },
});
