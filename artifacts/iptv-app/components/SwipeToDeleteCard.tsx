/**
 * SwipeToDeleteCard
 *
 * Wraps a poster card with a left-swipe gesture that reveals a red trash
 * area and fires `onDelete` when the swipe is committed.  Used exclusively
 * in the "Recently Watched" grid so users can quickly remove titles without
 * going through the long-press alert.
 *
 * Uses ReanimatedSwipeable (react-native-gesture-handler ≥ 3.x) which
 * requires react-native-reanimated and GestureHandlerRootView in the tree.
 */
import React, { useCallback, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Swipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';

interface SwipeToDeleteCardProps {
  onDelete: () => void;
  children: React.ReactNode;
  /**
   * Width-constraint style applied to a View that wraps the Swipeable.
   * Pass `{ flex: 1, maxWidth: '25%' }` when using inside a numColumns={4}
   * FlatList so the Swipeable doesn't escape its column slot and expose the
   * red delete action without a swipe gesture.
   */
  containerStyle?: StyleProp<ViewStyle>;
}

function RightAction({
  progress,
}: {
  progress: SharedValue<number>;
  drag: SharedValue<number>;
}) {
  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        scale: interpolate(
          progress.value,
          [0, 1],
          [0.6, 1],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return (
    <View style={styles.deleteAction}>
      <Reanimated.Text style={[styles.deleteIcon, animStyle]}>
        🗑
      </Reanimated.Text>
    </View>
  );
}

export function SwipeToDeleteCard({
  onDelete,
  children,
  containerStyle,
}: SwipeToDeleteCardProps) {
  const swipeRef = useRef<SwipeableMethods>(null);

  const renderRightActions = useCallback(
    (progress: SharedValue<number>, drag: SharedValue<number>) => (
      <RightAction progress={progress} drag={drag} />
    ),
    [],
  );

  const handleSwipeableOpen = useCallback(
    (_direction: 'left' | 'right') => {
      // "right" direction = right-side actions opened (i.e. the user swiped left).
      // Close the swipeable so it doesn't linger, then fire the delete callback.
      swipeRef.current?.close();
      onDelete();
    },
    [onDelete],
  );

  return (
    // Outer View provides the width constraint so the Swipeable's internal
    // flexDirection:'row' layout (content + right-action area) stays clipped
    // within the FlatList column slot (#213 layout fix).
    <View style={containerStyle}>
      <Swipeable
        ref={swipeRef}
        friction={2}
        rightThreshold={48}
        overshootRight={false}
        renderRightActions={renderRightActions}
        onSwipeableOpen={handleSwipeableOpen}
      >
        {children}
      </Swipeable>
    </View>
  );
}

const styles = StyleSheet.create({
  deleteAction: {
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    width: 64,
    borderRadius: 6,
    marginVertical: 2,
    marginRight: 4,
  },
  deleteIcon: {
    fontSize: 20,
  },
});
