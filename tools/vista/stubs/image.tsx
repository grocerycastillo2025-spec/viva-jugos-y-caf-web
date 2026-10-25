import { View } from 'react-native';

/**
 * Doble de `expo-image`. Pinta una <img> de verdad para poder ver como
 * queda una foto o el logo dentro de su hueco, no solo el hueco.
 */
export function Image({
  style,
  source,
  contentFit = 'cover',
  contentPosition = 'center',
}: {
  style?: unknown;
  source?: unknown;
  contentFit?: string;
  contentPosition?: string;
  [k: string]: unknown;
}) {
  const src =
    typeof source === 'string' ? source : (source as { uri?: string } | null)?.uri;
  return (
    <View style={style as never}>
      {src === undefined ? null : (
        <img
          src={src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: contentFit as 'contain' | 'cover',
            objectPosition: contentPosition,
          }}
        />
      )}
    </View>
  );
}
