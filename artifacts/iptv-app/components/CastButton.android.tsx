import React from 'react';
import { StyleSheet, View } from 'react-native';
import { CastButton as GoogleCastButton } from 'react-native-google-cast';

interface Props {
  /** Additional wrapper style (e.g. positioning). */
  wrapStyle?: object;
}

/**
 * Renders the native Google Cast button on Android.
 * The underlying `MediaRouteButton` automatically hides itself when no Cast
 * devices are available on the local network, so no visibility logic is needed.
 */
export default function CastButton({ wrapStyle }: Props) {
  return (
    <View style={[styles.wrap, wrapStyle]}>
      <GoogleCastButton style={styles.btn} tintColor="#ffffff" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  btn: {
    width: 24,
    height: 24,
    tintColor: '#ffffff',
  },
});
