/**
 * Paginación y ventanas de tiempo.
 *
 * DOS LÍMITES DE CLOVER QUE NO SE PUEDEN IGNORAR
 *
 * 1. `/items` y sus hermanos devuelven como mucho 100 elementos. Sin
 *    paginar, un merchant con 300 productos sincroniza 100 y los otros 200
 *    simplemente no existen para la app. Es un fallo mudo: no hay error,
 *    hay menos comida.
 *
 * 2. Un filtro por tiempo devuelve como mucho 90 DÍAS. Si pides un rango
 *    mayor, el servidor lo recorta al tramo más reciente sin avisar. Un
 *    barrido "desde el principio de los tiempos" trae solo los últimos 90
 *    días y parece que funcionó.
 *
 * Los dos se resuelven aquí, una vez, para que ningún endpoint tenga que
 * acordarse.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

/** Tope duro de Clover por página. Pedir más no da más. */
export const MAX_PAGE_SIZE = 100;

/** Tope duro del filtro por tiempo, en milisegundos. */
export const MAX_TIME_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

/** Forma de las respuestas de lista de la API v3. */
export interface CloverList<T> {
  readonly elements: readonly T[];
  readonly href?: string;
}

export interface PageParams {
  readonly limit: number;
  readonly offset: number;
}

/**
 * Recorre TODAS las páginas de un listado.
 *
 * Termina cuando una página viene incompleta —menos elementos que el
 * `limit`—, que es la señal fiable de fin. `maxPages` es un cinturón: sin
 * él, un endpoint que devolviera siempre lo mismo dejaría el worker
 * girando para siempre contra el techo compartido de 50 req/s.
 */
export async function* paginate<T>(
  fetchPage: (params: PageParams) => Promise<CloverList<T>>,
  options: { readonly pageSize?: number | undefined; readonly maxPages?: number | undefined } = {},
): AsyncGenerator<readonly T[], void, void> {
  const limit = Math.min(options.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const maxPages = options.maxPages ?? 500;

  let offset = 0;
  for (let pagina = 0; pagina < maxPages; pagina += 1) {
    const lote = await fetchPage({ limit, offset });
    const elementos = lote.elements ?? [];
    if (elementos.length > 0) yield elementos;
    if (elementos.length < limit) return;
    offset += elementos.length;
  }

  throw new Error(
    `La paginación superó ${maxPages} páginas (${offset} elementos). ` +
      'O el catálogo es enorme o el endpoint no avanza; en los dos casos hay que mirarlo ' +
      'antes de seguir gastando presupuesto de la app.',
  );
}

/** Junta todas las páginas. Cómodo, pero carga todo en memoria. */
export async function collect<T>(
  paginas: AsyncGenerator<readonly T[], void, void>,
): Promise<T[]> {
  const salida: T[] = [];
  for await (const lote of paginas) salida.push(...lote);
  return salida;
}

/**
 * Parte un rango en ventanas de 90 días como mucho.
 *
 * Se usa en el barrido por `modifiedTime`: para el día a día sobra una
 * ventana, pero un backfill tras una caída larga necesita varias, y sin
 * partirlo el servidor devolvería solo el tramo reciente.
 */
export function timeWindows(
  fromMs: number,
  toMs: number,
  windowMs: number = MAX_TIME_WINDOW_MS,
): Array<{ readonly from: number; readonly to: number }> {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error('Las marcas de tiempo del rango tienen que ser números finitos.');
  }
  if (toMs <= fromMs) return [];

  const ancho = Math.min(windowMs, MAX_TIME_WINDOW_MS);
  const salida: Array<{ from: number; to: number }> = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const fin = Math.min(cursor + ancho, toMs);
    salida.push({ from: cursor, to: fin });
    cursor = fin;
  }
  return salida;
}

/**
 * El filtro `modifiedTime` tal y como lo espera Clover.
 *
 * El formato es `campo>=valor`, con la marca de tiempo en MILISEGUNDOS,
 * que es la unidad en la que Clover devuelve `modifiedTime`. Mandarlo en
 * segundos no da error: devuelve el catálogo entero, cada vez, contra el
 * presupuesto compartido.
 */
export function modifiedSince(sinceMs: number): string {
  if (!Number.isInteger(sinceMs) || sinceMs < 0) {
    throw new Error(`modifiedTime tiene que ser un entero en milisegundos, no ${sinceMs}`);
  }
  return `modifiedTime>=${sinceMs}`;
}
