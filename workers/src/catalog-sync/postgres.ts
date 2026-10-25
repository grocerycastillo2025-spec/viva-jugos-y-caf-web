/**
 * El espejo, contra Postgres. SQL explícito, sin ORM (§17).
 *
 * ─────────────────────────────────────────────────────────────────────
 * AQUÍ VIVE LA IDEMPOTENCIA, Y NO ES UN `on conflict` A SECAS
 * ─────────────────────────────────────────────────────────────────────
 *
 * Un `insert … on conflict do update` deja la fila correcta las dos
 * veces, pero no sabe decir si la SEGUNDA cambió algo: siempre contesta
 * "actualizada". Un reporte construido así diría que el segundo barrido
 * actualizó 48 ítems, que es exactamente lo contrario de lo que hay que
 * demostrar.
 *
 * Así que el "¿cambió?" lo calcula la BASE, comparando los valores viejos
 * con los nuevos dentro del mismo statement:
 *
 *   nuevo     los valores que traemos, con sus tipos
 *   antes     la fila como estaba, leída en el MISMO snapshot
 *   guardado  el upsert de siempre
 *   select    creada = no había fila; cambiada = los valores difieren
 *
 * Sin el CTE `antes`, no hay forma de saberlo después: el upsert ya pisó
 * los valores viejos.
 *
 * POR QUÉ NO `xmax = 0`. Es el truco habitual para distinguir insert de
 * update en un `returning`, y funciona, pero solo contesta "¿se insertó?".
 * No contesta "¿el update cambió algo?", que es la pregunta que importa
 * aquí. Y apoyarse en una columna de sistema para una propiedad que se
 * puede escribir en SQL normal es pagar oscuridad por nada.
 *
 * `synced_at` NUNCA entra en la comparación. Se escribe siempre —dice
 * cuándo se miró, no cuándo cambió— y contarlo haría que todo barrido
 * pareciese haber cambiado todo.
 *
 * QUIÉN PUEDE EJECUTAR ESTO
 * Solo `service_role`. Las tablas de catálogo tienen RLS y `app.` no está
 * expuesto a los roles de la app.
 */

import type { FilaCategoria, FilaGrupo, FilaItem, FilaModificador, FilaTasa } from './mapping.ts';
import type { CatalogStore, EnlaceGrupo, EntradaReporte, Guardado, Resultado } from './ports.ts';

export type { SqlRunner } from '../sql.ts';
import type { SqlRunner } from '../sql.ts';

/** Una columna que se escribe: su nombre, su valor y su tipo en Postgres. */
interface Columna {
  readonly nombre: string;
  readonly valor: unknown;
  readonly tipo: string;
}

/**
 * El upsert que sabe si cambió algo. Uno solo para las cinco entidades:
 * la parte difícil se escribe y se prueba UNA vez.
 *
 * `clave` son las columnas del índice único —`(store_id, clover_*_id)`—,
 * que no se comparan porque por definición no cambiaron: si hubieran
 * cambiado, sería otra fila.
 */
function construirUpsert(
  tabla: string,
  clave: readonly Columna[],
  datos: readonly Columna[],
): { readonly text: string; readonly params: readonly unknown[] } {
  const todas = [...clave, ...datos];
  const params = todas.map((c) => c.valor);
  const decl = todas.map((c, i) => `$${i + 1}::${c.tipo} as ${c.nombre}`).join(', ');
  const nombres = todas.map((c) => c.nombre);

  const condicionClave = clave.map((c) => `t.${c.nombre} = n.${c.nombre}`).join(' and ');
  const setDatos = datos.map((c) => `${c.nombre} = excluded.${c.nombre}`).join(', ');
  // `deleted_at = null`: una fila que estaba borrada y vuelve a venir de
  // Clover resucita, y eso SÍ es un cambio — por eso entra en la
  // comparación de abajo.
  const comparadas = [...datos.map((c) => c.nombre), 'deleted_at'];

  const text = `
    with nuevo as (select ${decl}),
    antes as (
      select ${comparadas.map((c) => `t.${c}`).join(', ')}, t.id
        from ${tabla} t, nuevo n
       where ${condicionClave}
    ),
    guardado as (
      insert into ${tabla} (${nombres.join(', ')}, synced_at, deleted_at)
      select ${nombres.map((c) => `n.${c}`).join(', ')}, now(), null from nuevo n
      on conflict (${clave.map((c) => c.nombre).join(', ')}) do update
         set ${setDatos}, synced_at = now(), deleted_at = null
      returning id
    )
    select g.id,
           (a.id is null) as creada,
           (a.id is not null
            and (${comparadas.map((c) => `a.${c}`).join(', ')})
                is distinct from
                (${datos.map((c) => `n.${c.nombre}`).join(', ')}, null::timestamptz)) as cambiada
      from guardado g cross join nuevo n left join antes a on true`;

  return { text, params };
}

async function ejecutarUpsert(
  sql: SqlRunner,
  tabla: string,
  clave: readonly Columna[],
  datos: readonly Columna[],
): Promise<Guardado> {
  const { text, params } = construirUpsert(tabla, clave, datos);
  const filas = await sql(text, params);
  const fila = filas[0];
  if (fila === undefined) {
    throw new Error(`El upsert sobre ${tabla} no devolvió ninguna fila.`);
  }
  return { id: String(fila['id']), resultado: resultadoDe(fila) };
}

function resultadoDe(fila: Record<string, unknown>): Resultado {
  if (fila['creada'] === true) return 'creada';
  return fila['cambiada'] === true ? 'actualizada' : 'sin-cambios';
}

export function postgresCatalogStore(sql: SqlRunner): CatalogStore {
  return {
    async guardarCategoria(storeId: string, fila: FilaCategoria): Promise<Guardado> {
      return ejecutarUpsert(
        sql,
        'public.catalog_categories',
        [
          { nombre: 'store_id', valor: storeId, tipo: 'uuid' },
          { nombre: 'clover_category_id', valor: fila.cloverId, tipo: 'text' },
        ],
        [
          { nombre: 'name', valor: fila.name, tipo: 'text' },
          { nombre: 'sort_order', valor: fila.sortOrder, tipo: 'int' },
          { nombre: 'clover_modified_time', valor: fila.cloverModifiedTime, tipo: 'bigint' },
        ],
      );
    },

    async guardarTasa(storeId: string, fila: FilaTasa): Promise<Guardado> {
      return ejecutarUpsert(
        sql,
        'public.catalog_tax_rates',
        [
          { nombre: 'store_id', valor: storeId, tipo: 'uuid' },
          { nombre: 'clover_tax_rate_id', valor: fila.cloverId, tipo: 'text' },
        ],
        [
          { nombre: 'name', valor: fila.name, tipo: 'text' },
          // MILÉSIMAS DE PORCENTAJE, no fracción. Ver el aviso del doc.
          { nombre: 'rate', valor: fila.rate, tipo: 'bigint' },
          { nombre: 'is_default', valor: fila.isDefault, tipo: 'boolean' },
        ],
      );
    },

    async guardarGrupo(storeId: string, fila: FilaGrupo): Promise<Guardado> {
      return ejecutarUpsert(
        sql,
        'public.catalog_modifier_groups',
        [
          { nombre: 'store_id', valor: storeId, tipo: 'uuid' },
          { nombre: 'clover_group_id', valor: fila.cloverId, tipo: 'text' },
        ],
        [
          { nombre: 'name', valor: fila.name, tipo: 'text' },
          { nombre: 'min_required', valor: fila.minRequired, tipo: 'smallint' },
          { nombre: 'max_allowed', valor: fila.maxAllowed, tipo: 'smallint' },
          { nombre: 'sort_order', valor: fila.sortOrder, tipo: 'int' },
          { nombre: 'clover_modified_time', valor: fila.cloverModifiedTime, tipo: 'bigint' },
        ],
      );
    },

    async guardarModificador(
      storeId: string,
      grupoId: string,
      fila: FilaModificador,
    ): Promise<Guardado> {
      return ejecutarUpsert(
        sql,
        'public.catalog_modifiers',
        [
          { nombre: 'store_id', valor: storeId, tipo: 'uuid' },
          { nombre: 'clover_modifier_id', valor: fila.cloverId, tipo: 'text' },
        ],
        [
          // Un modificador puede cambiarse de grupo en Clover, así que el
          // grupo es dato y no clave.
          { nombre: 'modifier_group_id', valor: grupoId, tipo: 'uuid' },
          { nombre: 'name', valor: fila.name, tipo: 'text' },
          { nombre: 'price_cents', valor: fila.priceCents, tipo: 'bigint' },
          { nombre: 'available', valor: fila.available, tipo: 'boolean' },
          { nombre: 'sort_order', valor: fila.sortOrder, tipo: 'int' },
          { nombre: 'clover_modified_time', valor: fila.cloverModifiedTime, tipo: 'bigint' },
        ],
      );
    },

    async guardarItem(
      storeId: string,
      fila: FilaItem,
      categoriaId: string | null,
    ): Promise<Guardado> {
      // NI `default_tax_rates` NI `tax_synced_at` ENTRAN AQUÍ, y no es un
      // olvido: solo se escriben cuando el impuesto se resolvió de verdad
      // (`marcarImpuestoResuelto`). Meterlos en este upsert obligaría a
      // mandar un valor siempre, y el valor que habría que mandar cuando
      // no sabemos nada es justo el que no existe.
      return ejecutarUpsert(
        sql,
        'public.catalog_items',
        [
          { nombre: 'store_id', valor: storeId, tipo: 'uuid' },
          { nombre: 'clover_item_id', valor: fila.cloverId, tipo: 'text' },
        ],
        [
          { nombre: 'category_id', valor: categoriaId, tipo: 'uuid' },
          { nombre: 'name', valor: fila.name, tipo: 'text' },
          { nombre: 'alternate_name', valor: fila.alternateName, tipo: 'text' },
          { nombre: 'sku', valor: fila.sku, tipo: 'text' },
          { nombre: 'price_cents', valor: fila.priceCents, tipo: 'bigint' },
          { nombre: 'price_type', valor: fila.priceType, tipo: 'text' },
          { nombre: 'available', valor: fila.available, tipo: 'boolean' },
          { nombre: 'hidden', valor: fila.hidden, tipo: 'boolean' },
          { nombre: 'clover_modified_time', valor: fila.cloverModifiedTime, tipo: 'bigint' },
        ],
      );
    },

    /**
     * Diferencia de conjuntos, no borrar-e-insertar.
     *
     * Borrar e insertar lo mismo deja la tabla idéntica y cuenta como dos
     * escrituras: el segundo barrido reportaría cambios que no existen, y
     * la idempotencia dejaría de ser demostrable.
     */
    async enlazarGrupos(itemId: string, grupos: readonly EnlaceGrupo[]): Promise<number> {
      const filas = await sql(
        `with deseados as (
           select unnest($2::uuid[]) as modifier_group_id,
                  unnest($3::int[])  as sort_order
         ),
         borrados as (
           delete from public.catalog_item_modifier_groups l
            where l.item_id = $1
              and not exists (
                select 1 from deseados d where d.modifier_group_id = l.modifier_group_id
              )
           returning 1
         ),
         escritos as (
           insert into public.catalog_item_modifier_groups (item_id, modifier_group_id, sort_order)
           select $1, d.modifier_group_id, d.sort_order from deseados d
           on conflict (item_id, modifier_group_id) do update
              set sort_order = excluded.sort_order
            -- Solo si de verdad cambia. Sin este \`where\`, reescribir el
            -- mismo orden contaría como cambio en cada barrido.
            where catalog_item_modifier_groups.sort_order is distinct from excluded.sort_order
           returning 1
         )
         select (select count(*) from borrados) + (select count(*) from escritos) as movidos`,
        [itemId, grupos.map((g) => g.modifierGroupId), grupos.map((g) => g.sortOrder)],
      );
      return Number(filas[0]?.['movidos'] ?? 0);
    },

    /**
     * `null` = NO TOCAR. Es el caso de "no sabemos si paga impuesto", y
     * dejar los enlaces como estaban es lo único honesto: borrarlos diría
     * "exento" y escribirlos diría algo que Clover no ha dicho.
     */
    async enlazarTasas(itemId: string, tasaIds: readonly string[] | null): Promise<number> {
      if (tasaIds === null) return 0;
      const filas = await sql(
        `with deseados as (select unnest($2::uuid[]) as tax_rate_id),
         borrados as (
           delete from public.catalog_item_tax_rates l
            where l.item_id = $1
              and not exists (select 1 from deseados d where d.tax_rate_id = l.tax_rate_id)
           returning 1
         ),
         escritos as (
           insert into public.catalog_item_tax_rates (item_id, tax_rate_id)
           select $1, d.tax_rate_id from deseados d
           on conflict (item_id, tax_rate_id) do nothing
           returning 1
         )
         select (select count(*) from borrados) + (select count(*) from escritos) as movidos`,
        [itemId, tasaIds],
      );
      return Number(filas[0]?.['movidos'] ?? 0);
    },

    /**
     * `tax_synced_at` se escribe SIEMPRE que se resolvió —dice cuándo se
     * miró— pero no cuenta como cambio, igual que `synced_at`. Lo que
     * cuenta es que `default_tax_rates` sea otro.
     */
    async marcarImpuestoResuelto(
      itemId: string,
      defaultTaxRates: boolean | null,
    ): Promise<boolean> {
      const filas = await sql(
        `with antes as (select default_tax_rates as previo from public.catalog_items where id = $1)
         update public.catalog_items c
            set default_tax_rates = $2::boolean, tax_synced_at = now()
           from antes
          where c.id = $1
         returning (antes.previo is distinct from $2::boolean) as cambiada`,
        [itemId, defaultTaxRates],
      );
      return filas[0]?.['cambiada'] === true;
    },

    async itemsConocidos(storeId: string): Promise<ReadonlyMap<string, string>> {
      const filas = await sql(
        `select clover_item_id, name from public.catalog_items
          where store_id = $1 and deleted_at is null`,
        [storeId],
      );
      return new Map(filas.map((f) => [String(f['clover_item_id']), String(f['name'])]));
    },

    async guardarReporte(entrada: EntradaReporte): Promise<void> {
      await sql(
        `insert into app.catalog_sync_runs
           (store_id, merchant_id, started_at, finished_at, complete, report)
         values ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          entrada.storeId,
          entrada.merchantId,
          entrada.empezado.toISOString(),
          entrada.terminado.toISOString(),
          entrada.completo,
          JSON.stringify(entrada.reporte),
        ],
      );
    },
  };
}

/** Para las pruebas del constructor de SQL, que es la pieza delicada. */
export const _construirUpsert = construirUpsert;
