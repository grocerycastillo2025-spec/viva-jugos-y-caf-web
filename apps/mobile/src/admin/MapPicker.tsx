/**
 * En el APK no hay mapa todavía (haría falta una dependencia nativa).
 * Se ensenan las coordenadas y se pide ubicar el punto desde la web.
 * La versión con mapa está en MapPicker.web.tsx.
 */

import type { ReactNode } from 'react';
import { Text } from 'react-native';

import { adminStrings } from './strings';

export interface MapPickerProps {
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** Dirección escrita, para buscarla en el mapa. */
  readonly address: string;
  readonly onChange: (latitude: number, longitude: number) => void;
}

export function MapPicker({ latitude, longitude }: MapPickerProps): ReactNode {
  return (
    <Text>
      {latitude === null || longitude === null
        ? adminStrings.map.nativeOnly
        : adminStrings.map.coords(latitude, longitude)}
    </Text>
  );
}
