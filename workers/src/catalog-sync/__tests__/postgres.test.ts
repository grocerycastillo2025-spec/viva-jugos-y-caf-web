/**
 * El adaptador de Postgres, con el espia sobre `SqlRunner` que ya usa el
 * worker de refresco.
 *
 * PARECE FONTANERIA Y NO LO ES. La idempotencia del barrido vive en este
 * SQL, no en el bucle: si el `update` dejara de comparar los valores
 * viejos, el barrido seguiria dejando la base correcta y el REPORTE
 * empezaria a mentir — diria que la segunda vuelta actualizo 48 items—,
 * que es justo lo que hay que poder demostrar que no pasa.
 *
 * Estas pruebas fijan las cuatro propiedades de las que depende:
 *
 *   1. se lee la fila ANTERIOR en el mismo statement (`antes`);
 *   2. `synced_at` NO entra en la comparacion;
 *   3. `deleted_at` SI entra: resucitar es un cambio;
 *   4. los enlaces se reconcilian por diferencia, no borrando y
 *      reinsertando.
 *
 * El SQL que sale de aqui se ejecuto contra un Postgres 16 con las
 * diecisiete migraciones aplicadas, comprobando las cuatro respuestas
 * —crear, no cambiar, cambiar, resucitar—. Lo que estas pruebas fijan es
 * que siga saliendo el mismo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { postgresCatalogStore, type SqlRunner } from '../postgres.ts';

interface Ejecutada {
  readonly text: string;
  readonly params: readonly unknown[];
}

function espia(respuestas: Array<readonly Record<string, unknown>[]> = []): {
  sql: SqlRunner;
  ejecutadas: Ejecutada[];
} {
  const ejecutadas: Ejecutada[] = [];
  const cola = [...respuestas];
  const sql: SqlRunner = async (text, params) => {
    ejecutadas.push({ text, params });
    return cola.shift() ?? [{ id: 'uuid-1', creada: true, cambiada: false }];
  };
  return { sql, ejecutadas };
}

const STORE = '22222222-2222-2222-2222-222222222222';

const CATEGORIA = {
  cloverId: 'CAT-JUICES',
  name: 'Juices',
  sortOrder: 10,
  cloverModifiedTime: 1757000000000,
};

test('el upsert LEE LA FILA ANTERIOR en el mismo statement', async () => {
  // Sin el CTE `antes` no hay forma de saber despues si cambio algo: el
  // upsert ya piso los valores viejos. Es toda la idempotencia.
  const { sql, ejecutadas } = espia();
  await postgresCatalogStore(sql).guardarCategoria(STORE, CATEGORIA);

  const { text } = ejecutadas[0]!;
  assert.match(text, /antes as \(/);
  assert.match(text, /from public\.catalog_categories t, nuevo n/);
  assert.match(text, /is distinct from/);
  assert.match(text, /on conflict \(store_id, clover_category_id\) do update/);
});

test('`synced_at` se escribe SIEMPRE y no cuenta como cambio', async () => {
  // Dice cuando se miro, no cuando cambio. Compararlo haria que todo
  // barrido pareciese haber cambiado todo, y la segunda vuelta reportaria
  // el catalogo entero como actualizado.
  const { sql, ejecutadas } = espia();
  await postgresCatalogStore(sql).guardarCategoria(STORE, CATEGORIA);

  const { text } = ejecutadas[0]!;
  assert.match(text, /synced_at = now\(\)/);
  const comparacion = /\(a\.[^)]*\)\s*is distinct from/.exec(text)?.[0] ?? '';
  assert.ok(!comparacion.includes('synced_at'), comparacion);
});

test('`deleted_at` SI entra en la comparacion: resucitar es un cambio', async () => {
  // Una fila borrada logicamente que vuelve a venir de Clover no es "sin
  // cambios": el producto ha vuelto al menu.
  const { sql, ejecutadas } = espia();
  await postgresCatalogStore(sql).guardarCategoria(STORE, CATEGORIA);

  const { text } = ejecutadas[0]!;
  assert.match(text, /deleted_at = null/);
  assert.match(/\(a\.[^)]*\)\s*is distinct from/.exec(text)?.[0] ?? '', /a\.deleted_at/);
});

test('las tres respuestas se traducen a los tres resultados', async () => {
  const casos: Array<[Record<string, unknown>, string]> = [
    [{ id: 'u1', creada: true, cambiada: false }, 'creada'],
    [{ id: 'u1', creada: false, cambiada: true }, 'actualizada'],
    [{ id: 'u1', creada: false, cambiada: false }, 'sin-cambios'],
  ];
  for (const [fila, esperado] of casos) {
    const { sql } = espia([[fila]]);
    const guardado = await postgresCatalogStore(sql).guardarCategoria(STORE, CATEGORIA);
    assert.equal(guardado.resultado, esperado);
    assert.equal(guardado.id, 'u1');
  }
});

test('un upsert que no devuelve fila FALLA, no se inventa un id', async () => {
  // Devolver un id inventado ataria los enlaces del item a una fila que
  // no existe, y eso se descubre al abrir la app.
  const { sql } = espia([[]]);
  await assert.rejects(
    postgresCatalogStore(sql).guardarCategoria(STORE, CATEGORIA),
    /no devolvió ninguna fila/,
  );
});

test('el ITEM no escribe `tax_synced_at` ni `default_tax_rates`', async () => {
  // Solo se escriben cuando el impuesto se resolvio de verdad. Meterlos
  // aqui obligaria a mandar un valor siempre, y el que habria que mandar
  // cuando no sabemos nada es justo el que no existe.
  const { sql, ejecutadas } = espia();
  await postgresCatalogStore(sql).guardarItem(
    STORE,
    {
      cloverId: 'IT-1',
      name: 'Green Juice',
      alternateName: null,
      sku: null,
      priceCents: 850,
      priceType: 'FIXED',
      available: true,
      hidden: false,
      cloverModifiedTime: null,
    },
    'uuid-categoria',
  );

  const { text } = ejecutadas[0]!;
  assert.ok(!text.includes('tax_synced_at'), text);
  assert.ok(!text.includes('default_tax_rates'), text);
  assert.match(text, /price_type = excluded\.price_type/);
  assert.match(text, /hidden = excluded\.hidden/);
});

test('ENLACES: diferencia de conjuntos, nunca borrar-y-reinsertar', async () => {
  // Borrar e insertar lo mismo deja la tabla identica y cuenta como dos
  // escrituras: la segunda vuelta reportaria cambios que no existen.
  const { sql, ejecutadas } = espia([[{ movidos: 0 }]]);
  await postgresCatalogStore(sql).enlazarGrupos('uuid-item', [
    { modifierGroupId: 'uuid-g1', sortOrder: 0 },
  ]);

  const { text } = ejecutadas[0]!;
  // El `delete` solo alcanza lo que NO esta en el conjunto deseado.
  assert.match(text, /delete from public\.catalog_item_modifier_groups/);
  assert.match(text, /not exists \(\s*select 1 from deseados/);
  // Y reescribir el mismo orden no cuenta como cambio.
  assert.match(text, /where catalog_item_modifier_groups\.sort_order is distinct from excluded/);
});

test('ENLACES DE IMPUESTO: `null` no ejecuta NI UNA sentencia', async () => {
  // `null` significa "no sabemos si paga impuesto". Cualquier escritura
  // aqui afirmaria algo: borrarlos diria "exento", escribirlos diria algo
  // que Clover no ha dicho. Lo unico honesto es no tocar la base.
  const { sql, ejecutadas } = espia();
  assert.equal(await postgresCatalogStore(sql).enlazarTasas('uuid-item', null), 0);
  assert.equal(ejecutadas.length, 0);
});

test('ENLACES DE IMPUESTO: `[]` SI ejecuta: exento es una afirmacion', async () => {
  // Con la lista vacia hay que borrar los enlaces que hubiera: el
  // merchant declaro el producto exento y el espejo tiene que decirlo.
  const { sql, ejecutadas } = espia([[{ movidos: 1 }]]);
  assert.equal(await postgresCatalogStore(sql).enlazarTasas('uuid-item', []), 1);
  assert.equal(ejecutadas.length, 1);
  assert.match(ejecutadas[0]!.text, /delete from public\.catalog_item_tax_rates/);
});

test('marcar el impuesto resuelto escribe la marca y compara el booleano', async () => {
  const { sql, ejecutadas } = espia([[{ cambiada: true }]]);
  assert.equal(await postgresCatalogStore(sql).marcarImpuestoResuelto('uuid-item', true), true);

  const { text, params } = ejecutadas[0]!;
  assert.match(text, /tax_synced_at = now\(\)/);
  assert.match(text, /antes\.previo is distinct from/);
  assert.deepEqual(params, ['uuid-item', true]);
});

test('EL BARRIDO NO NOMBRA `app_item_overrides` EN NINGUNA SENTENCIA', async () => {
  // La frontera de propiedad hecha codigo: no existe el `update` que
  // podria borrar una foto, asi que no hay que acordarse de no hacerlo.
  const { sql, ejecutadas } = espia();
  const store = postgresCatalogStore(sql);

  await store.guardarCategoria(STORE, CATEGORIA);
  await store.guardarTasa(STORE, { cloverId: 'TR', name: 'NJ', rate: 6625, isDefault: true });
  await store.guardarGrupo(STORE, {
    cloverId: 'MG',
    name: 'Milk',
    minRequired: 0,
    maxAllowed: null,
    sortOrder: 0,
    cloverModifiedTime: null,
  });
  await store.guardarModificador(STORE, 'uuid-g', {
    cloverId: 'MOD',
    name: 'Oat',
    priceCents: 75,
    available: true,
    sortOrder: 0,
    cloverModifiedTime: null,
  });
  await store.guardarItem(
    STORE,
    {
      cloverId: 'IT',
      name: 'Zumo',
      alternateName: null,
      sku: null,
      priceCents: 100,
      priceType: 'FIXED',
      available: true,
      hidden: false,
      cloverModifiedTime: null,
    },
    null,
  );
  await store.enlazarGrupos('uuid-item', []);
  await store.enlazarTasas('uuid-item', ['uuid-t']);
  await store.marcarImpuestoResuelto('uuid-item', false);
  await store.itemsConocidos(STORE);

  for (const { text } of ejecutadas) {
    assert.ok(!text.includes('app_item_overrides'), text);
    // Ni las columnas de marketing por si alguien las moviera de tabla.
    for (const prohibida of ['image_url', 'marketing_copy', 'featured', 'app_visible', 'badge']) {
      assert.ok(!text.includes(prohibida), `${prohibida} en: ${text}`);
    }
  }
  assert.ok(ejecutadas.length >= 9);
});

test('el reporte se guarda como jsonb, con las marcas y el `complete`', async () => {
  const { sql, ejecutadas } = espia();
  await postgresCatalogStore(sql).guardarReporte({
    storeId: STORE,
    merchantId: 'RGW5JAVFT8MB1',
    empezado: new Date('2026-09-11T12:00:00.000Z'),
    terminado: new Date('2026-09-11T12:00:09.000Z'),
    completo: true,
    reporte: { entidades: {} },
  });

  const { text, params } = ejecutadas[0]!;
  assert.match(text, /insert into app\.catalog_sync_runs/);
  assert.match(text, /\$6::jsonb/);
  assert.equal(params[1], 'RGW5JAVFT8MB1');
  assert.equal(params[4], true);
  assert.equal(JSON.parse(String(params[5])).entidades !== undefined, true);
});
