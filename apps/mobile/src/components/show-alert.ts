/**
 * Aviso que funciona también en la web: `Alert.alert` de React Native no
 * hace nada en el navegador, y un aviso que no se ve es peor que ninguno.
 */
import { Alert, Platform } from 'react-native';

export function showAlert(title: string, body: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(body === '' ? title : `${title}\n\n${body}`);
    return;
  }
  Alert.alert(title, body);
}
