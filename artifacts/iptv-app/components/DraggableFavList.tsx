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

import React, { useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, ScrollView } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { FocusablePressable } from '@/components/FocusablePressable';
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
  /** #253: D-pad callbacks used on TV instead of the drag gesture. */
  onMoveUp: () => void;
  onMoveDown: () => void;
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
  onMoveUp,
  onMoveDown,
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

  const canMoveUp   = index > 0;
  const canMoveDown = index < itemCount - 1;

  return (
    <Animated.View style={[styles.rowWrap, { height: rowHeight }, animStyle]}>
      <View style={styles.rowContent}>{children}</View>

      {Platform.isTV ? (
        // #253: Firestick/Android TV users can't drag — offer focusable ▲ ▼ buttons.
        <View style={[styles.tvHandle, { borderLeftColor: colors.border }]}>
          <FocusablePressable
            onPress={canMoveUp ? onMoveUp : undefined}
            style={[styles.tvMoveBtn, !canMoveUp && styles.tvMoveBtnDisabled]}
            focusedStyle={styles.tvMoveBtnFocused}
          >
            <Text style={[styles.tvMoveBtnIcon, { color: canMoveUp ? colors.foreground : colors.border }]}>▲</Text>
          </FocusablePressable>
          <FocusablePressable
            onPress={canMoveDown ? onMoveDown : undefined}
            style={[styles.tvMoveBtn, !canMoveDown && styles.tvMoveBtnDisabled]}
            focusedStyle={styles.tvMoveBtnFocused}
          >
            <Text style={[styles.tvMoveBtnIcon, { color: canMoveDown ? colors.foreground : colors.border }]}>▼</Text>
          </FocusablePressable>
        </View>
      ) : (
        <GestureDetector gesture={pan}>
          <View style={[styles.handle, { borderLeftColor: colors.border }]}>
            <Text style={[styles.handleIcon, { color: colors.mutedForeground }]}>☰</Text>
          </View>
        </GestureDetector>
      )}
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

  // #343: Hide the D-pad hint after the user has moved a row at least once.
  const [hasMovedOnce, setHasMovedOnce] = useState(false);

  // #344: Keep the moved row visible by scrolling the list to its new position.
  const scrollRef = useRef<ScrollView>(null);
  const scrollToRow = useCallback((targetIdx: number) => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, targetIdx * rowHeight), animated: true });
    }, 60);
  }, [rowHeight]);

  const handleDragEnd = useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const next = [...dataRef.current];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onReorder(next);
  }, [onReorder]);

  return (
    <ScrollView
      ref={scrollRef}
      showsVerticalScrollIndicator={false}
      // Prevent the ScrollView from intercepting the pan gesture
      scrollEnabled
    >
      {/* #343: One-time "press ▶ to reach the move buttons" hint for TV users.
          Disappears the moment they successfully move a row for the first time. */}
      {Platform.isTV && !hasMovedOnce && data.length > 1 && (
        <View style={styles.tvReorderHint}>
          <Text style={[styles.tvReorderHintText, { color: colors.mutedForeground }]}>
            Press ▶ on any row to reach the ▲▼ move buttons
          </Text>
        </View>
      )}
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
          onMoveUp={() => {
            handleDragEnd(index, index - 1);
            setHasMovedOnce(true);
            scrollToRow(index - 1); // #344
          }}
          onMoveDown={() => {
            handleDragEnd(index, index + 1);
            setHasMovedOnce(true);
            scrollToRow(index + 1); // #344
          }}
        >
          {renderItem(item, index)}
        </DraggableRow>
      ))}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  tvReorderHint: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tvReorderHintText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
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

  // #253: TV remote up/down move buttons (replaces drag handle on isTV)
  tvHandle: {
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  tvMoveBtn: {
    width: 36,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 4,
  },
  tvMoveBtnFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
  tvMoveBtnDisabled: { opacity: 0.25 },
  tvMoveBtnIcon: { fontSize: 11 },
});
