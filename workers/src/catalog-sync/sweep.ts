/**
 * El barrido completo del catálogo, bajo demanda.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EL ORDEN NO ES ARBITRARIO
 * ─────────────────────────────────────────────────────────────────────
 *
 *   1. categorías        un ítem apunta a una
 *   2. tasas             un ítem enlaza con varias
 *   3. grupos            un ítem enlaza con varios
 *   4. modificadores     cuelgan de su grupo
 *   5. ítems             los ata a todo lo anterior
 *
 * Al revés, un ítem llegaría antes que su categoría y habría que dejarlo
 * sin categoría y volver a pasar. Con este orden, cuando toca un ítem ya
 * existe todo a lo que puede apuntar, y el barrido es una pasada.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LO QUE ESTE BARRIDO NO HACE
 * ─────────────────────────────────────────────────────────────────────
 *
 * NO BORRA NADA. Sabe perfectamente qué ítems tiene el espejo y no vinieron
 * de Clover —los cuenta en `en_supabase_no_en_clover`— y aun así no marca
 * ni un `deleted_at`. Dos razones, las dos de peso:
 *
 *   el seed `SEED-` no se purga en este PR, y un barrido que borrase "lo
 *   que no vino de Clover" se lo llevaría entero en su primera vuelta;
 *
 *   una respuesta PARCIAL —una página que falla, un token que caduca a
 *   mitad— es indistinguible de "el merchant borró medio catálogo".
 *   Borrar por ausencia convierte un fallo de red en una carta vacía.
 *
 * NO TOCA `app_item_overrides`. Ni para leerla. Ver `ports.ts`: no existe
 * el método que podría.
 *
 * NO ES PERIÓDICO. Lo dispara una persona. Ver `supabase/functions/catalog-sync`.
 */

import {
  enlacesDeImpuesto,
  esPedible,
  mapearCategoria,
  mapearGrupo,
  mapearItem,
  mapearModificador,
  mapearTasa,
} from './mapping.ts';
import { Acumulador, type Reporte } from './report.ts';
import {
  SILENT_CATALOG_LOG,
  type CatalogLog,
  type CatalogSource,
  type CatalogStore,
  type EnlaceGrupo,
} from './ports.ts';

export interface SweepDeps {
  readonly source: CatalogSource;
  readonly store: CatalogStore;
  readonly now: () => Date;
  readonly log?: CatalogLog;
}

export interface SweepInput {
  readonly storeId: string;
  readonly merchantId: string | null;
}

export async function runCatalogSweep(deps: SweepDeps, input: SweepInput): Promise<Reporte> {
  const log = deps.log ?? SILENT_CATALOG_LOG;
  const empezado = deps.now();
  const acc = new Acumulador(input.storeId, input.merchantId, empezado);

  // Se lee ANTES de escribir nada: después, todo lo que Clover devolvió
  // estaría ya en el espejo y la resta no diría nada.
  const conocidos = new Map(await deps.store.itemsConocidos(input.storeId));
  const vistos = new Set<string>();

  let error: string | null = null;
  try {
    const categorias = await barrerCategorias(deps, acc, input.storeId);
    const tasas = await barrerTasas(deps, acc, input.storeId);
    const grupos = await barrerGrupos(deps, acc, input.storeId);
    await barrerModificadores(deps, acc, input.storeId, grupos);
    await barrerItems(deps, acc, input.storeId, { categorias, tasas, grupos, vistos });
  } catch (err) {
    // El reporte se cierra IGUAL, con `completo: false` y lo que se
    // hubiera hecho hasta aquí. Un barrido que revienta y no deja reporte
    // no se puede diagnosticar, y lo escrito hasta el fallo es correcto:
    // cada upsert es su propia verdad.
    error = mensajeSeguro(err);
    log.error('barrido_incompleto', { store: input.storeId, error });
  }

  // Solo si el barrido llegó entero al final: con una página perdida,
  // "no vino de Clover" no significa nada.
  if (error === null) {
    for (const [cloverId, nombre] of conocidos) {
      if (!vistos.has(cloverId)) {
        acc.avisar('en_supabase_no_en_clover', { clover_id: cloverId, nombre });
      }
    }
  }

  const reporte = acc.cerrar(deps.now(), error === null, error);
  await deps.store.guardarReporte({
    storeId: input.storeId,
    merchantId: input.merchantId,
    empezado,
    terminado: new Date(reporte.terminado ?? empezado.toISOString()),
    completo: reporte.completo,
    reporte,
  });

  log.info('barrido_terminado', {
    store: input.storeId,
    completo: reporte.completo,
    items: reporte.entidades.items,
  });
  return reporte;
}

// ---------------------------------------------------------------------

/** `clover_id` -> uuid nuestro, para que los ítems puedan apuntar. */
type Indice = ReadonlyMap<string, string>;

async function barrerCategorias(
  deps: SweepDeps,
  acc: Acumulador,
  storeId: string,
): Promise<Indice> {
  const indice = new Map<string, string>();
  for await (const pagina of deps.source.categories()) {
    acc.pagina('categorias');
    for (const bruta of pagina) {
      const mapeo = mapearCategoria(bruta);
      if (!mapeo.ok) {
        acc.ignorar('categoria', bruta.id ?? '', mapeo.nombre, mapeo.motivo);
        continue;
      }
      const guardado = await deps.store.guardarCategoria(storeId, mapeo.valor);
      acc.contar('categorias', guardado.resultado);
      indice.set(mapeo.valor.cloverId, guardado.id);
    }
  }
  return indice;
}

async function barrerTasas(deps: SweepDeps, acc: Acumulador, storeId: string): Promise<Indice> {
  const indice = new Map<string, string>();
  for await (const pagina of deps.source.taxRates()) {
    acc.pagina('tasas');
    for (const bruta of pagina) {
      const mapeo = mapearTasa(bruta);
      if (!mapeo.ok) {
        acc.ignorar('tasa', bruta.id ?? '', mapeo.nombre, mapeo.motivo);
        continue;
      }
      const guardado = await deps.store.guardarTasa(storeId, mapeo.valor);
      acc.contar('tasas', guardado.resultado);
      indice.set(mapeo.valor.cloverId, guardado.id);
    }
  }
  return indice;
}

async function barrerGrupos(deps: SweepDeps, acc: Acumulador, storeId: string): Promise<Indice> {
  const indice = new Map<string, string>();
  for await (const pagina of deps.source.modifierGroups()) {
    acc.pagina('grupos');
    for (const bruto of pagina) {
      const mapeo = mapearGrupo(bruto);
      if (!mapeo.ok) {
        // Un grupo con `maxAllowed < minRequired` no se escribe: la 0002
        // lo rechazaría y se llevaría por delante el barrido entero.
        acc.ignorar('grupo_modificadores', bruto.id ?? '', mapeo.nombre, mapeo.motivo);
        continue;
      }
      const guardado = await deps.store.guardarGrupo(storeId, mapeo.valor);
      acc.contar('grupos', guardado.resultado);
      indice.set(mapeo.valor.cloverId, guardado.id);
    }
  }
  return indice;
}

/**
 * N grupos, N peticiones: Clover no tiene listado plano de modificadores.
 * Por eso todo esto va con prioridad `catalog` (cuota del 25 %) — mientras
 * se sincroniza un menú, alguien está pagando.
 */
async function barrerModificadores(
  deps: SweepDeps,
  acc: Acumulador,
  storeId: string,
  grupos: Indice,
): Promise<void> {
  for (const [grupoCloverId, grupoId] of grupos) {
    // El orden dentro del grupo es el que Clover devuelve: `CloverModifier`
    // no trae `sortOrder`. Es determinista mientras Clover no reordene, y
    // si reordena es un cambio real del menú, no ruido nuestro.
    let posicion = 0;
    for await (const pagina of deps.source.modifiers(grupoCloverId)) {
      acc.pagina('modificadores');
      for (const bruto of pagina) {
        const mapeo = mapearModificador(bruto, posicion);
        posicion += 10;
        if (!mapeo.ok) {
          acc.ignorar('modificador', bruto.id ?? '', mapeo.nombre, mapeo.motivo);
          continue;
        }
        const guardado = await deps.store.guardarModificador(storeId, grupoId, mapeo.valor);
        acc.contar('modificadores', guardado.resultado);
      }
    }
  }
}

async function barrerItems(
  deps: SweepDeps,
  acc: Acumulador,
  storeId: string,
  ctx: {
    readonly categorias: Indice;
    readonly tasas: Indice;
    readonly grupos: Indice;
    readonly vistos: Set<string>;
  },
): Promise<void> {
  for await (const pagina of deps.source.items()) {
    acc.pagina('items');
    for (const bruto of pagina) {
      const mapeo = mapearItem(bruto);
      if (!mapeo.ok) {
        acc.ignorar('item', bruto.id ?? '', mapeo.nombre, mapeo.motivo);
        continue;
      }

      const { fila, categoriaCloverId, todasLasCategorias, gruposCloverIds, impuesto } =
        mapeo.valor;
      ctx.vistos.add(fila.cloverId);

      const categoriaId =
        categoriaCloverId === null ? null : (ctx.categorias.get(categoriaCloverId) ?? null);
      const guardado = await deps.store.guardarItem(storeId, fila, categoriaId);
      acc.contar('items', guardado.resultado);

      // ── los enlaces ────────────────────────────────────────────────
      const enlacesGrupo: EnlaceGrupo[] = [];
      gruposCloverIds.forEach((cloverId, indice) => {
        const grupoId = ctx.grupos.get(cloverId);
        // Un grupo que se descartó por límites imposibles no está en el
        // índice. El ítem se queda sin ese grupo y ya salió en
        // `ignorados`: inventar el enlace daría una FK rota.
        if (grupoId !== undefined) {
          enlacesGrupo.push({ modifierGroupId: grupoId, sortOrder: indice * 10 });
        }
      });
      if ((await deps.store.enlazarGrupos(guardado.id, enlacesGrupo)) > 0) {
        acc.enlaceMovido('items');
      }

      const tasasDeseadas = enlacesDeImpuesto(impuesto);
      const tasaIds =
        tasasDeseadas === null
          ? null
          : tasasDeseadas
              .map((cloverId) => ctx.tasas.get(cloverId))
              .filter((id): id is string => id !== undefined);
      if ((await deps.store.enlazarTasas(guardado.id, tasaIds)) > 0) {
        acc.enlaceMovido('items');
      }

      if (impuesto.kind === 'sin-resolver') {
        // No se marca `tax_synced_at`: cero enlaces con la marca puesta
        // significaría EXENTO, y no sabemos eso.
        acc.avisar('impuesto_sin_resolver', { clover_id: fila.cloverId, nombre: fila.name });
      } else if (
        await deps.store.marcarImpuestoResuelto(guardado.id, mapeo.valor.defaultTaxRates)
      ) {
        acc.enlaceMovido('items');
      }

      // ── los avisos, que son las preguntas abiertas del documento ────
      if (fila.hidden) {
        acc.avisar('items_ocultos', { clover_id: fila.cloverId, nombre: fila.name });
      }
      if (!esPedible(fila.priceType)) {
        acc.avisar('items_no_pedibles', {
          clover_id: fila.cloverId,
          nombre: fila.name,
          detalle: fila.priceType,
        });
      }
      if (todasLasCategorias.length > 1) {
        acc.avisar('items_multicategoria', {
          clover_id: fila.cloverId,
          nombre: fila.name,
          detalle: todasLasCategorias.join(', '),
        });
      }
      if (impuesto.kind === 'defecto-y-explicito') {
        acc.avisar('items_default_con_enlaces', {
          clover_id: fila.cloverId,
          nombre: fila.name,
          detalle: impuesto.cloverTaxRateIds.join(', '),
        });
      }
      if (fila.alternateName !== null) {
        acc.avisar('items_con_alternate_name', {
          clover_id: fila.cloverId,
          nombre: fila.name,
          detalle: fila.alternateName,
        });
      }
    }
  }
}

function mensajeSeguro(err: unknown, maxChars = 500): string {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}…` : texto;
}
