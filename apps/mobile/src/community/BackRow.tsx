import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { useColors } from '../state/branding-context';
import { spacing, type as typography } from '../theme';

/** "‹ Comunidad": regresa, o va a la pestaña si se entró por enlace. */
export function BackRow({ label = 'Comunidad' }: { readonly label?: string }): ReactNode {
  const router = useRouter();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/comunidad'))}
      hitSlop={8}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingVertical: spacing.xs },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Ionicons name="chevron-back" size={20} color={colors.primary} />
      <Text style={{ color: colors.primary, fontWeight: '700', fontSize: typography.body.fontSize }}>{label}</Text>
    </Pressable>
  );
}
