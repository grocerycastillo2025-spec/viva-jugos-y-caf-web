/**
 * De un objeto de Clover a una fila nuestra. Puro, sin red y sin base.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN MÓDULO Y NO CUATRO FUNCIONES DENTRO DEL BARRIDO
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque el barrido completo no va a ser el único que mapee. Los webhooks
 * de inventario —PR posterior— traen UN objeto y tienen que producir
 * exactamente la misma fila; si el mapeo viviera dentro del bucle del
 * barrido, el webhook acabaría con una copia, y dos copias de una regla
 * son dos reglas en cuanto alguien toca una.
 *
 * Aquí no hay nada que sepa si vienen mil ítems o uno.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO
 * ─────────────────────────────────────────────────────────────────────
 *
 * Clover es dueño de lo que hay aquí: nombre, precio, categoría,
 * modificadores, impuesto, disponibilidad, visibilidad. Estas funciones
 * NO leen nada nuestro y no tienen forma de hacerlo — no reciben la fila
 * anterior. Un mapeo que pudiera mirar lo que ya había sería un mapeo que
 * puede "preservar" algo, y preservar es la primera forma de que un campo
 * acabe con dos dueños.
 *
 * Las fotos, las descripciones de marketing, el orden en la app y los
 * destacados viven en `app_item_overrides`, y en este archivo no se
 * nombran ni una vez.
 *
 * Ver docs/SINCRONIZACION-CATALOGO.md.
 */

import type {
  CloverCategory,
  CloverItem,
  CloverModifier,
  CloverModifierGroup,
  CloverTaxRate,
} from '@juicebar/clover-client';

// ---------------------------------------------------------------------
// LO QUE SE PUEDE PEDIR DESDE LA APP
// ---------------------------------------------------------------------

/**
 * Los tres tipos de precio de Clover.
 *
 *   FIXED      el precio del ítem es el precio
 *   VARIABLE   lo teclea el cajero al vender; llega con `price` a 0
 *   PER_UNIT   por unidad de medida (libra); se pesa en el mostrador
 *
 * La misma lista está como `check` en la 0017. Si Clover añadiera un
 * cuarto, el ítem se ignora con motivo y sale en el reporte: no se
 * escribe para que lo rechace la base, porque un barrido no se aborta
 * entero por un ítem raro.
 */
export const PRICE_TYPES = ['FIXED', 'VARIABLE', 'PER_UNIT'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

/**
 * Solo `FIXED` se puede pedir.
 *
 * NO SE GUARDA EN NINGUNA COLUMNA, y es a propósito: una bandera
 * `orderable` en `catalog_items` tendría un dueño confuso —la calcula la
 * sincronización con datos de Clover, la consume la app— y podría quedar
 * desincronizada del campo del que depende. La vista `menu_items` la
 * deriva. Esto de aquí existe para las pruebas y para el reporte.
 */
export function esPedible(priceType: string | undefined): boolean {
  return normalizarPriceType(priceType) === 'FIXED';
}

function normalizarPriceType(valor: string | undefined): PriceType | null {
  if (valor === undefined || valor === '') return 'FIXED'; // Clover omite el más común
  return (PRICE_TYPES as readonly string[]).includes(valor) ? (valor as PriceType) : null;
}

// ---------------------------------------------------------------------
// EL RESULTADO DE MAPEAR
// ---------------------------------------------------------------------

/** Por qué se descartó un objeto. Va tal cual al reporte. */
export type MotivoDescarte = 'sin_id' | 'price_type_desconocido' | 'grupo_con_limites_imposibles';

export type Mapeo<T> =
  | { readonly ok: true; readonly valor: T }
  | { readonly ok: false; readonly motivo: MotivoDescarte; readonly nombre: string };

// ---------------------------------------------------------------------
// CATEGORÍAS, TASAS, GRUPOS, MODIFICADORES
// ---------------------------------------------------------------------

export interface FilaCategoria {
  readonly cloverId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly cloverModifiedTime: number | null;
}

export function mapearCategoria(c: CloverCategory): Mapeo<FilaCategoria> {
  if (!esId(c.id)) return descarte('sin_id', c.name);
  return {
    ok: true,
    valor: {
      cloverId: c.id,
      // `not null` en la base. Un nombre vacío es feo; una fila rechazada
      // a mitad del barrido es peor.
      name: c.name ?? '',
      sortOrder: entero(c.sortOrder, 0),
      cloverModifiedTime: entero(c.modifiedTime, null),
    },
  };
}

export interface FilaTasa {
  readonly cloverId: string;
  readonly name: string;
  /** MILÉSIMAS DE PORCENTAJE: 8250 = 8,25 %. No es una fracción. */
  readonly rate: number;
  readonly isDefault: boolean;
}

export function mapearTasa(t: CloverTaxRate): Mapeo<FilaTasa> {
  if (!esId(t.id)) return descarte('sin_id', t.name);
  return {
    ok: true,
    valor: {
      cloverId: t.id,
      name: t.name ?? '',
      rate: entero(t.rate, 0),
      isDefault: t.isDefault === true,
    },
  };
}

export interface FilaGrupo {
  readonly cloverId: string;
  readonly name: string;
  readonly minRequired: number;
  readonly maxAllowed: number | null;
  readonly sortOrder: number;
  readonly cloverModifiedTime: number | null;
}

export function mapearGrupo(g: CloverModifierGroup): Mapeo<FilaGrupo> {
  if (!esId(g.id)) return descarte('sin_id', g.name);

  const minRequired = Math.max(0, entero(g.minRequired, 0));
  const maxAllowed = entero(g.maxAllowed, null);

  // La 0002 tiene un `check`: `max_allowed >= min_required`. Un grupo que
  // lo incumpla no se escribe — la base abortaría la transacción y con
  // ella el barrido entero, por un grupo mal configurado en el POS.
  if (maxAllowed !== null && maxAllowed < minRequired) {
    return descarte('grupo_con_limites_imposibles', g.name);
  }

  return {
    ok: true,
    valor: {
      cloverId: g.id,
      name: g.name ?? '',
      minRequired,
      maxAllowed,
      sortOrder: entero(g.sortOrder, 0),
      cloverModifiedTime: entero(g.modifiedTime, null),
    },
  };
}

export interface FilaModificador {
  readonly cloverId: string;
  readonly name: string;
  /** Puede ser 0 o NEGATIVO: hay modificadores que descuentan. */
  readonly priceCents: number;
  readonly available: boolean;
  readonly sortOrder: number;
  readonly cloverModifiedTime: number | null;
}

export function mapearModificador(m: CloverModifier, sortOrder: number): Mapeo<FilaModificador> {
  if (!esId(m.id)) return descarte('sin_id', m.name);
  return {
    ok: true,
    valor: {
      cloverId: m.id,
      name: m.name ?? '',
      // Sin `Math.max(0, …)`: `catalog_modifiers.price_cents` no tiene
      // `check (>= 0)` justamente porque un "sin azúcar -50" es legítimo.
      priceCents: entero(m.price, 0),
      available: m.available !== false,
      sortOrder,
      cloverModifiedTime: entero(m.modifiedTime, null),
    },
  };
}

// ---------------------------------------------------------------------
// ÍTEMS: donde están las tres decisiones difíciles
// ---------------------------------------------------------------------

/**
 * Qué sabemos del impuesto de un ítem. TRES ESTADOS Y NO DOS.
 *
 * `sin-resolver` es el que justifica el tipo. La expansión `taxRates`
 * puede no llegar —Clover la omite, la respuesta se recorta, el sandbox
 * se atraganta— y entonces no sabemos nada. Escribir cero enlaces en ese
 * caso declararía EXENTO un producto que quizá paga impuesto, y eso no se
 * descubre hasta cuadrar caja.
 *
 * `exento` sí es una afirmación: Clover dijo que no usa las tasas por
 * defecto y no devolvió ninguna propia.
 */
export type Impuesto =
  | { readonly kind: 'sin-resolver' }
  | { readonly kind: 'exento' }
  | { readonly kind: 'por-defecto' }
  | { readonly kind: 'explicito'; readonly cloverTaxRateIds: readonly string[] }
  /** Las dos cosas a la vez. Ver el aviso del reporte. */
  | { readonly kind: 'defecto-y-explicito'; readonly cloverTaxRateIds: readonly string[] };

export interface FilaItem {
  readonly cloverId: string;
  readonly name: string;
  readonly alternateName: string | null;
  readonly sku: string | null;
  readonly priceCents: number;
  readonly priceType: PriceType;
  readonly available: boolean;
  readonly hidden: boolean;
  readonly cloverModifiedTime: number | null;
}

export interface ItemMapeado {
  readonly fila: FilaItem;
  /**
   * La categoría elegida, que puede no ser la única. Ver `elegirCategoria`.
   * `null` = el ítem no trae categorías, o no vino la expansión.
   */
  readonly categoriaCloverId: string | null;
  /** Todas las que trae, para poder avisar de los multicategoría. */
  readonly todasLasCategorias: readonly string[];
  readonly gruposCloverIds: readonly string[];
  readonly impuesto: Impuesto;
  /** Lo que Clover dijo, tal cual, para poder escribirlo sin reinterpretar. */
  readonly defaultTaxRates: boolean | null;
}

export function mapearItem(i: CloverItem): Mapeo<ItemMapeado> {
  if (!esId(i.id)) return descarte('sin_id', i.name);

  const priceType = normalizarPriceType(i.priceType);
  if (priceType === null) {
    // Un cuarto tipo de precio. No se escribe: el `check` de la 0017 lo
    // rechazaría y se llevaría por delante el barrido entero.
    return descarte('price_type_desconocido', i.name);
  }

  const categorias = (i.categories?.elements ?? []).filter((c): c is CloverCategory => esId(c?.id));

  return {
    ok: true,
    valor: {
      fila: {
        cloverId: i.id,
        name: i.name ?? '',
        alternateName: texto(i.alternateName),
        sku: texto(i.sku),
        // `price_cents` tiene `check (>= 0)` en la 0002. Un precio
        // negativo en un ítem no es un descuento: es un dato roto.
        priceCents: Math.max(0, entero(i.price, 0)),
        priceType,
        available: i.available !== false,
        hidden: i.hidden === true,
        cloverModifiedTime: entero(i.modifiedTime, null),
      },
      categoriaCloverId: elegirCategoria(categorias),
      todasLasCategorias: categorias.map((c) => c.id),
      gruposCloverIds: (i.modifierGroups?.elements ?? [])
        .filter((g): g is CloverModifierGroup => esId(g?.id))
        .map((g) => g.id),
      impuesto: resolverImpuesto(i),
      defaultTaxRates: i.defaultTaxRates === undefined ? null : i.defaultTaxRates,
    },
  };
}

/**
 * Clover permite que un ítem esté en VARIAS categorías;
 * `catalog_items.category_id` es UNA sola FK. Esa asimetría hay que
 * resolverla con una regla, y la regla tiene que ser DETERMINISTA o la
 * idempotencia se rompe sola: dos barridos seguidos elegirían categorías
 * distintas y el segundo reportaría cambios que no existen.
 *
 * Menor `sortOrder`; a igualdad, menor id de Clover. Solo depende de los
 * datos, nunca del orden en que llegaron.
 */
export function elegirCategoria(categorias: readonly CloverCategory[]): string | null {
  let elegida: CloverCategory | null = null;
  for (const c of categorias) {
    if (elegida === null) {
      elegida = c;
      continue;
    }
    const a = entero(c.sortOrder, 0);
    const b = entero(elegida.sortOrder, 0);
    if (a < b || (a === b && c.id < elegida.id)) elegida = c;
  }
  return elegida?.id ?? null;
}

/**
 * Las tres —cuatro, con el caso raro— situaciones de impuesto.
 *
 * AUSENTE NO ES VACÍO. `taxRates` sin la expansión llega como
 * `undefined`; con la expansión y sin tasas propias llega como
 * `{elements: []}`. Son estados distintos y llevan a acciones opuestas,
 * así que se distinguen aquí y no se colapsan nunca.
 */
export function resolverImpuesto(i: CloverItem): Impuesto {
  const expansion = i.taxRates;
  const porDefecto = i.defaultTaxRates === true;

  if (expansion === undefined) {
    // Sin expansión no sabemos qué tasas propias tiene. Ni siquiera
    // `defaultTaxRates: true` basta: un ítem puede tener las dos cosas, y
    // afirmar "solo las por defecto" sería inventarse la mitad del dato.
    return { kind: 'sin-resolver' };
  }

  const ids = (expansion.elements ?? [])
    .filter((t): t is CloverTaxRate => esId(t?.id))
    .map((t) => t.id)
    // Ordenados para que el conjunto de enlaces sea estable entre
    // barridos: si el orden cambiara, la comparación de conjuntos podría
    // reportar cambios que no existen.
    .sort();

  if (ids.length === 0) return porDefecto ? { kind: 'por-defecto' } : { kind: 'exento' };
  return porDefecto
    ? { kind: 'defecto-y-explicito', cloverTaxRateIds: ids }
    : { kind: 'explicito', cloverTaxRateIds: ids };
}

/** Los enlaces que hay que escribir en `catalog_item_tax_rates`. */
export function enlacesDeImpuesto(impuesto: Impuesto): readonly string[] | null {
  switch (impuesto.kind) {
    // `null` = NO TOCAR. No es lo mismo que "ningún enlace".
    case 'sin-resolver':
      return null;
    case 'exento':
    // Las por defecto NO se materializan: ya están en `catalog_tax_rates`
    // y las resuelve en lectura la vista `catalog_item_tax_effective`.
    // Copiarlas duplicaría el dato y obligaría a reescribir N filas cada
    // vez que el merchant cambie una.
    case 'por-defecto':
      return [];
    case 'explicito':
    case 'defecto-y-explicito':
      return impuesto.cloverTaxRateIds;
  }
}

// ---------------------------------------------------------------------

function esId(valor: unknown): valor is string {
  return typeof valor === 'string' && valor !== '';
}

function texto(valor: string | undefined): string | null {
  return valor === undefined || valor === '' ? null : valor;
}

function entero<T extends number | null>(valor: number | undefined, porDefecto: T): number | T {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.trunc(valor) : porDefecto;
}

function descarte<T>(motivo: MotivoDescarte, nombre: string | undefined): Mapeo<T> {
  return { ok: false, motivo, nombre: nombre ?? '(sin nombre)' };
}
