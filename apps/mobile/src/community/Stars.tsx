/** Estrellas: para mostrar (tamaño chico) o para elegir (grandes). */

import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

export const STAR_COLOR = '#F5A623';

export function Stars({
  value,
  size = 14,
  onChange,
  color = STAR_COLOR,
  emptyColor,
}: {
  readonly value: number;
  readonly size?: number;
  readonly onChange?: (value: number) => void;
  readonly color?: string;
  readonly emptyColor?: string;
}): ReactNode {
  return (
    <View
      style={{ flexDirection: 'row', gap: onChange ? 6 : 1 }}
      accessibilityLabel={`${value} de 5 estrellas`}
      accessibilityRole={onChange ? 'adjustable' : 'image'}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const name = value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline';
        const icon = <Ionicons name={name} size={size} color={value >= n - 0.5 ? color : (emptyColor ?? color)} />;
        if (onChange === undefined) return <View key={n}>{icon}</View>;
        return (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} estrellas`}
            hitSlop={4}
            onPress={() => onChange(n)}
          >
            {icon}
          </Pressable>
        );
      })}
    </View>
  );
}
