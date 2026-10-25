/**
 * El catálogo de Clover, atado a un merchant y a un token.
 *
 * Esto es cableado: convierte el cliente de `@juicebar/clover-client` en
 * el puerto `CatalogSource` que espera el barrido. No hay ni una regla de
 * mapeo aquí — esas están en `workers/src/catalog-sync/mapping.ts`, sin
 * red, con sus pruebas.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LAS TRES EXPANSIONES, Y POR QUÉ LA PÁGINA ES DE 50
 * ─────────────────────────────────────────────────────────────────────
 *
 * `expand=categories,modifierGroups,taxRates` son tres expansiones
 * HERMANAS de primer nivel. El §4.5 del addendum prohíbe las ANIDADAS
 * —`expand=modifierGroups.modifiers`, que da timeouts y 502— y eso es
 * otra cosa; estas tres cuelgan todas del ítem.
 *
 * Aun así abultan, y el tope de Clover son 100 elementos por página. Se
 * piden 50: la mitad de elementos por respuesta, el doble de peticiones,
 * y ninguna respuesta gigante contra un sandbox que es más frágil que
 * producción.
 *
 * `taxRates` es la que no se puede quitar aunque abulte. Sin ella, el
 * mapeo no puede distinguir "exento" de "no lo sabemos", y por defecto
 * dice "no lo sabemos" — que es lo correcto, pero deja el catálogo entero
 * sin impuesto resuelto y el reporte lleno de avisos.
 *
 * CLOVER-PENDING: medir contra el Test Merchant RGW5JAVFT8MB1 si el
 * sandbox aguanta las tres con el catálogo real. Si da 502 o timeouts, se
 * parten en pasadas —una por expansión, cruzando por id en nuestro lado—
 * y el mapeo no cambia ni una línea: `CloverItem` ya admite que una
 * expansión falte.
 */

import type { CloverClient } from '../../../packages/clover-client/src/index.ts';
import type { CatalogSource } from '../../../workers/src/catalog-sync/index.ts';

/** Con expansiones, la mitad del tope de Clover. Ver la cabecera. */
export const PAGE_SIZE_CON_EXPANSIONES = 50;

/** Las tres expansiones de primer nivel que necesita el mapeo. */
export const EXPANSIONES_DE_ITEM = ['categories', 'modifierGroups', 'taxRates'] as const;

export function cloverCatalogSource(
  cliente: CloverClient,
  merchantId: string,
  accessToken: string,
): CatalogSource {
  const inv = cliente.inventory;
  return {
    categories: () => inv.categories(merchantId, accessToken),
    taxRates: () => inv.taxRates(merchantId, accessToken),
    modifierGroups: () => inv.modifierGroups(merchantId, accessToken),
    modifiers: (grupoId: string) => inv.modifiers(merchantId, accessToken, grupoId),
    items: () =>
      inv.items(merchantId, accessToken, {
        expand: [...EXPANSIONES_DE_ITEM],
        pageSize: PAGE_SIZE_CON_EXPANSIONES,
      }),
  };
}
