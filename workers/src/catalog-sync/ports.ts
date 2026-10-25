/**
 * Las fronteras del barrido: lo que Clover sirve y lo que la base guarda.
 *
 * Igual que el worker de refresco, y por las mismas dos razones
 * prácticas: las pruebas ejercitan el barrido entero —paginación,
 * idempotencia, reporte— sin red y sin base; y el día que cambie el
 * cliente HTTP o el driver, esto es un adaptador, no una reescritura.
 */

import type {
  CloverCategory,
  CloverItem,
  CloverModifier,
  CloverModifierGroup,
  CloverTaxRate,
} from '@juicebar/clover-client';
import type { FilaCategoria, FilaGrupo, FilaItem, FilaModificador, FilaTasa } from './mapping.ts';

export type Paginas<T> = AsyncGenerator<readonly T[], void, void>;

/**
 * El catálogo de Clover, ya atado a un merchant y a un token.
 *
 * Devuelve PÁGINAS y no listas completas: el catálogo de Viva son ~50
 * productos, pero nada garantiza que quepa en una página y un barrido que
 * lea solo la primera no da error — da menos comida.
 */
export interface CatalogSource {
  categories(): Paginas<CloverCategory>;
  taxRates(): Paginas<CloverTaxRate>;
  modifierGroups(): Paginas<CloverModifierGroup>;
  /** No hay listado plano: los modificadores cuelgan de su grupo. */
  modifiers(modifierGroupCloverId: string): Paginas<CloverModifier>;
  items(): Paginas<CloverItem>;
}

/**
 * Qué le pasó de verdad a una fila.
 *
 * `sin-cambios` NO es "no se escribió": es que se escribió y la fila
 * quedó igual que estaba. La diferencia es la idempotencia, y por eso
 * este dato lo calcula la BASE comparando valores, no nosotros contando
 * peticiones. Ver `postgres.ts`.
 */
export type Resultado = 'creada' | 'actualizada' | 'sin-cambios';

export interface Guardado {
  /** El uuid de la fila, haga falta o no. Los ítems lo necesitan. */
  readonly id: string;
  readonly resultado: Resultado;
}

/**
 * El espejo, visto desde aquí.
 *
 * NO HAY UN SOLO MÉTODO QUE TOQUE `app_item_overrides`, y esa ausencia es
 * la frontera de propiedad hecha código: no existe la llamada que
 * borraría una foto, así que no hay que acordarse de no hacerla.
 */
export interface CatalogStore {
  guardarCategoria(storeId: string, fila: FilaCategoria): Promise<Guardado>;
  guardarTasa(storeId: string, fila: FilaTasa): Promise<Guardado>;
  guardarGrupo(storeId: string, fila: FilaGrupo): Promise<Guardado>;
  guardarModificador(storeId: string, grupoId: string, fila: FilaModificador): Promise<Guardado>;
  guardarItem(storeId: string, fila: FilaItem, categoriaId: string | null): Promise<Guardado>;

  /**
   * Los enlaces, por DIFERENCIA DE CONJUNTOS y nunca borrando-e-
   * insertando. Borrar e insertar lo mismo deja la fila idéntica y cuenta
   * como cambio: la segunda vuelta diría que cambió algo que no cambió.
   *
   * Devuelve cuántos enlaces se movieron de verdad.
   */
  enlazarGrupos(itemId: string, grupos: readonly EnlaceGrupo[]): Promise<number>;
  /** `null` = NO TOCAR (impuesto sin resolver). `[]` = exento, sí toca. */
  enlazarTasas(itemId: string, tasaIds: readonly string[] | null): Promise<number>;
  /** `default_tax_rates` + `tax_synced_at`. Solo cuando se resolvió. */
  marcarImpuestoResuelto(itemId: string, defaultTaxRates: boolean | null): Promise<boolean>;

  /** Los `clover_item_id` que el espejo tiene vivos para esta tienda. */
  itemsConocidos(storeId: string): Promise<ReadonlyMap<string, string>>;

  guardarReporte(entrada: EntradaReporte): Promise<void>;
}

export interface EnlaceGrupo {
  readonly modifierGroupId: string;
  readonly sortOrder: number;
}

export interface EntradaReporte {
  readonly storeId: string;
  readonly merchantId: string | null;
  readonly empezado: Date;
  readonly terminado: Date;
  readonly completo: boolean;
  readonly reporte: unknown;
}

export interface CatalogLog {
  info(event: string, datos?: Readonly<Record<string, unknown>>): void;
  warn(event: string, datos?: Readonly<Record<string, unknown>>): void;
  error(event: string, datos?: Readonly<Record<string, unknown>>): void;
}

/** Nombre propio y no `SILENT_LOG` a secas: el worker de refresco tiene
 *  el suyo, con otro tipo, y los dos salen por `@juicebar/workers`. */
export const SILENT_CATALOG_LOG: CatalogLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
