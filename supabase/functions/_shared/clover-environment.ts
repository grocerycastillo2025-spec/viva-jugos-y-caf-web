/**
 * Traducir el `environment` de la fila al del cliente de Clover.
 *
 * POR QUÉ ES UN MÓDULO COMPARTIDO Y NO DOS COPIAS
 * Lo necesitan las dos Edge Functions —`oauth` para el canje inicial y
 * `token-refresh` para cada rotación— y las dos tienen que decidir lo
 * mismo: contra qué cuatro hosts se habla. Dos copias de una traducción
 * es como se acaba teniendo dos traducciones, y el día que entre Europa
 * hay que tocar exactamente un sitio.
 *
 * POR QUÉ NO SON LA MISMA CADENA DE ENTRADA Y SALIDA
 * La fila guarda `'sandbox' | 'production'` (0002). El cliente habla de
 * `'sandbox' | 'na-production'` (`environments.ts`), porque "producción"
 * dejará de ser una sola cosa en cuanto haya un merchant europeo. La
 * traducción vive aquí, en el cableado, y NO se adivina: un entorno
 * desconocido revienta en vez de caer a Norteamérica en silencio, que es
 * el fallo que se descubre cuando un merchant de verdad no puede cobrar.
 */

import type { CloverEnvironment } from '../../../packages/clover-client/src/index.ts';

/** Lo que puede haber en `clover_connections.environment` (0002). */
export const ENTORNOS_DE_LA_FILA = ['sandbox', 'production'] as const;

export function cloverEnvironment(fila: string): CloverEnvironment {
  if (fila === 'sandbox') return 'sandbox';
  if (fila === 'production') return 'na-production';
  throw new Error(
    `La conexión declara el entorno '${fila}', que no está mapeado a ningún ` +
      `entorno del cliente de Clover. Los válidos en la fila son ${ENTORNOS_DE_LA_FILA.join(' y ')}.`,
  );
}
