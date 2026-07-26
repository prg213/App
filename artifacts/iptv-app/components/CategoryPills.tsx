import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';

interface Category {
  id: string;
  name: string;
  count?: number;
}

interface CategoryPillsProps {
  categories: Category[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  allLabel?: string;
}

export function CategoryPills({
  categories,
  selected,
  onSelect,
  allLabel = 'All',
}: CategoryPillsProps) {
  const colors = useColors();

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.container}
        style={Platform.OS === 'web' ? { marginTop: 0 } : undefined}
      >
        <TouchableOpacity
          style={[
            styles.pill,
            {
              backgroundColor: !selected ? colors.primary : colors.secondary,
              borderColor: !selected ? colors.primary : colors.border,
            },
          ]}
          onPress={() => onSelect(null)}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.pillText,
              { color: !selected ? colors.primaryForeground : colors.mutedForeground },
            ]}
          >
            {allLabel}
          </Text>
        </TouchableOpacity>

        {categories.map((cat) => {
          const isActive = selected === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.pill,
                {
                  backgroundColor: isActive ? colors.primary : colors.secondary,
                  borderColor: isActive ? colors.primary : colors.border,
                },
              ]}
              onPress={() => onSelect(cat.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.pillText,
                  { color: isActive ? colors.primaryForeground : colors.mutedForeground },
                ]}
                numberOfLines={1}
              >
                {cat.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 99,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    maxWidth: 140,
  },
});
