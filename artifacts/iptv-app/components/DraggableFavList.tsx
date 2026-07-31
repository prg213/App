/**
 * DraggableFavList
 *
 * A lightweight drag-to-reorder list built with react-native-gesture-handler
 * (Gesture API) and react-native-reanimated, requiring no extra dependencies.
 *
 * Usage:
 *   <DraggableFavList
 *     data={favorites}
 *     keyExtractor={(item) => item.id}
 *     renderItem={(item) => <MyRow item={item} />}
 *     onReorder={(newData) => setFavorites(newData)}
 *     colors={colors}
 *     rowHeight={60}
 *   />
 */

import React, { useCallback, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import type { useColors } from '@/hooks/useColors';

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };

function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

// ─── Single draggable row ─────────────────────────────────────────────────────

type RowProps = {
  index: number;
  itemCount: number;
  rowHeight: number;
  activeIndex: ReturnType<typeof useSharedValue<number>>;
  dragOffset: ReturnType<typeof useSharedValue<number>>;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
  onDragEnd: (fromIdx: number, toIdx: number) => void;
};

const DraggableRow = React.memo(function DraggableRow({
  index,
  itemCount,
  rowHeight,
  activeIndex,
  dragOffset,
  children,
  colors,
  onDragEnd,
}: RowProps) {
  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      activeIndex.value = index;
      dragOffset.value = 0;
    })
    .onUpdate((e) => {
      dragOffset.value = e.translationY;
    })
    .onEnd(() => {
      const toIdx = clamp(
        Math.round((index * rowHeight + dragOffset.value) / rowHeight),
        0,
        itemCount - 1,
      );
      runOnJS(onDragEnd)(index, toIdx);
      activeIndex.value = -1;
      dragOffset.value = 0;
    })
    .onFinalize(() => {
      // safety: always reset on cancel/fail
      if (activeIndex.value === index) {
        activeIndex.value = -1;
        dragOffset.value = 0;
      }
    });

  const animStyle = useAnimatedStyle(() => {
    const ai = activeIndex.value;
    const isActive = ai === index;

    if (isActive) {
      return {
        transform: [{ translateY: dragOffset.value }],
        zIndex: 100,
        shadowOpacity: 0.25,
        elevation: 8,
      };
    }

    if (ai < 0) {
      // Nothing being dragged — snap everything back
      return {
        transform: [{ translateY: withSpring(0, SPRING_CONFIG) }],
        zIndex: 1,
        shadowOpacity: 0,
        elevation: 0,
      };
    }

    // Compute where the dragged item would land
    const targetIdx = clamp(
      Math.round((ai * rowHeight + dragOffset.value) / rowHeight),
      0,
      itemCount - 1,
    );

    // Shift items that are "swept past" by the drag
    let shift = 0;
    if (ai < targetIdx && index > ai && index <= targetIdx) {
      shift = -rowHeight; // active dragged downward past this item → shift up
    } else if (ai > targetIdx && index < ai && index >= targetIdx) {
      shift = rowHeight;  // active dragged upward past this item → shift down
    }

    return {
      transform: [{ translateY: withSpring(shift, SPRING_CONFIG) }],
      zIndex: 1,
      shadowOpacity: 0,
      elevation: 0,
    };
  });

  return (
    <Animated.View style={[styles.rowWrap, { height: rowHeight }, animStyle]}>
      <View style={styles.rowContent}>{children}</View>
      <GestureDetector gesture={pan}>
        <View style={[styles.handle, { borderLeftColor: colors.border }]}>
          <Text style={[styles.handleIcon, { color: colors.mutedForeground }]}>☰</Text>
        </View>
      </GestureDetector>
    </Animated.View>
  );
});

// ─── List component ────────────────────────────────────────────────────────────

type Props<T> = {
  data: T[];
  keyExtractor: (item: T) => string;
  /** Render the row content (without the drag handle — that is added automatically). */
  renderItem: (item: T, index: number) => React.ReactNode;
  onReorder: (newData: T[]) => void;
  rowHeight?: number;
  colors: ReturnType<typeof useColors>;
};

export function DraggableFavList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  rowHeight = 60,
  colors,
}: Props<T>) {
  // These shared values are created once and passed into every row.
  const activeIndex = useSharedValue(-1);
  const dragOffset = useSharedValue(0);

  // Keep a stable ref to `data` so the onDragEnd callback isn't stale
  const dataRef = useRef(data);
  dataRef.current = data;

  const handleDragEnd = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = [...dataRef.current];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
  }, [onReorder]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      // Prevent the ScrollView from intercepting the pan gesture
      scrollEnabled
    >
      {data.map((item, index) => (
        <DraggableRow
          key={keyExtractor(item)}
          index={index}
          itemCount={data.length}
          rowHeight={rowHeight}
          activeIndex={activeIndex}
          dragOffset={dragOffset}
          colors={colors}
          onDragEnd={handleDragEnd}
        >
          {renderItem(item, index)}
        </DraggableRow>
      ))}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  rowWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  rowContent: {
    flex: 1,
  },
  handle: {
    width: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  handleIcon: {
    fontSize: 18,
  },
});
