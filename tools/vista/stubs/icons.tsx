import { Text } from 'react-native';
// Ionicons pinta un Text con la fuente de iconos: un glifo cuadrado de `size`.
export function Ionicons({ size = 24, color }: { name?: string; size?: number; color?: string }) {
  return <Text style={{ fontSize: size, lineHeight: size, color, width: size, height: size }}>◆</Text>;
}
