/**
 * Hace que react-native-web se comporte como Yoga en lo que mas duele.
 *
 * En CSS, `flex-shrink` vale 1 por defecto: un hijo de una fila encoge
 * solo cuando no cabe. En Yoga vale 0: NO encoge, y desborda. Por eso el
 * banco daba verdes falsos — el navegador arreglaba por su cuenta lo que
 * en el telefono se salia de la pantalla.
 *
 * Se parchea `StyleSheet.create` en vez de inyectar CSS para no pasarse de
 * frenada: solo se pone `flexShrink: 0` donde el estilo NO dice nada, que
 * es justo lo que hace Yoga. Un `flex: 1` sigue encogiendo, como alli.
 */
import { StyleSheet } from 'react-native';

export function emularYoga(): void {
  const original = StyleSheet.create.bind(StyleSheet);
  (StyleSheet as unknown as { create: unknown }).create = (obj: Record<string, Record<string, unknown>>) => {
    const salida: Record<string, Record<string, unknown>> = {};
    for (const [nombre, estilo] of Object.entries(obj)) {
      const declara = 'flex' in estilo || 'flexShrink' in estilo;
      salida[nombre] = declara ? estilo : { ...estilo, flexShrink: 0 };
    }
    return original(salida as never);
  };
}
