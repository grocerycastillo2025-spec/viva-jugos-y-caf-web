/**
 * El mapeo. Cada prueba de aqui es una linea de
 * docs/SINCRONIZACION-CATALOGO.md, y las tres que mas importan son las de
 * los tres campos que el analisis inicial marco como problematicos:
 * visibilidad, tipo de precio e impuesto.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  elegirCategoria,
  enlacesDeImpuesto,
  esPedible,
  mapearCategoria,
  mapearGrupo,
  mapearItem,
  mapearModificador,
  mapearTasa,
  resolverImpuesto,
} from '../mapping.ts';

function item(extra: Record<string, unknown> = {}) {
  return { id: 'IT-1', name: 'Green Juice', price: 850, ...extra };
}

// ── PRICE TYPE ──────────────────────────────────────────────────────

test('PRICE TYPE: solo FIXED se puede pedir', () => {
  assert.equal(esPedible('FIXED'), true);
  assert.equal(esPedible('VARIABLE'), false);
  assert.equal(esPedible('PER_UNIT'), false);
  // Clover omite el mas comun. Omitido = FIXED, no = "no se sabe".
  assert.equal(esPedible(undefined), true);
});

test('PRICE TYPE: un VARIABLE se sincroniza igual, no se rechaza', () => {
  // Rechazarlo lo dejaria fuera del espejo, y el operador que se pregunte
  // por que no esta en la app no tendria donde mirar. Se sincroniza y se
  // marca no pedible; de no dejarlo pedir se encarga `menu_items`.
  const mapeo = mapearItem(item({ priceType: 'VARIABLE', price: 0 }));
  assert.equal(mapeo.ok, true);
  assert.ok(mapeo.ok);
  assert.equal(mapeo.valor.fila.priceType, 'VARIABLE');
  assert.equal(mapeo.valor.fila.priceCents, 0);
  assert.equal(esPedible(mapeo.valor.fila.priceType), false);
});

test('PRICE TYPE: un cuarto tipo se ignora con motivo, no revienta el barrido', () => {
  // El `check` de la 0017 lo rechazaria y se llevaria por delante la
  // transaccion entera. Un barrido no se aborta por un item raro.
  const mapeo = mapearItem(item({ priceType: 'PER_HOUR' }));
  assert.equal(mapeo.ok, false);
  assert.ok(!mapeo.ok);
  assert.equal(mapeo.motivo, 'price_type_desconocido');
  assert.equal(mapeo.nombre, 'Green Juice');
});

// ── VISIBILIDAD ─────────────────────────────────────────────────────

test('VISIBILIDAD: `hidden` se espeja tal cual, sin interpretarlo', () => {
  // La columna es de Clover y se copia. Que un item oculto deba o no
  // listarse en la app es una decision sobre la app, y no se toma aqui ni
  // se toma a ciegas: ver el CLOVER-PENDING de la 0017.
  assert.equal(mapearItemOk(item({ hidden: true })).fila.hidden, true);
  assert.equal(mapearItemOk(item({ hidden: false })).fila.hidden, false);
  // Ausente = visible. Es lo que hace Clover con el caso comun.
  assert.equal(mapearItemOk(item()).fila.hidden, false);
});

test('VISIBILIDAD: `available` ausente es DISPONIBLE, no agotado', () => {
  // Colapsar ausente en `false` agotaria el catalogo entero de un
  // merchant que no lleva control de stock, que es el caso habitual.
  assert.equal(mapearItemOk(item()).fila.available, true);
  assert.equal(mapearItemOk(item({ available: false })).fila.available, false);
});

// ── IMPUESTO ────────────────────────────────────────────────────────

test('IMPUESTO: AUSENTE no es VACIO. Son estados distintos', () => {
  // La distincion entera del diseño. Sin expansion no sabemos nada;
  // con expansion y sin tasas, el item esta exento. En la base los dos se
  // verian igual —cero filas de enlace— y piden acciones opuestas.
  assert.equal(resolverImpuesto(item()).kind, 'sin-resolver');
  assert.equal(resolverImpuesto(item({ taxRates: { elements: [] } })).kind, 'exento');
});

test('IMPUESTO: sin resolver NO TOCA los enlaces; exento los deja en cero', () => {
  // `null` y `[]` son ordenes distintas para el adaptador, y ahi esta la
  // diferencia entre "no sabemos" y "no paga".
  assert.equal(enlacesDeImpuesto({ kind: 'sin-resolver' }), null);
  assert.deepEqual(enlacesDeImpuesto({ kind: 'exento' }), []);
});

test('IMPUESTO: las tasas por defecto NO se materializan', () => {
  // Ya estan en `catalog_tax_rates`; copiarlas al enlace duplicaria el
  // dato y obligaria a reescribir N filas cada vez que el merchant
  // cambie una. Las resuelve en lectura `catalog_item_tax_effective`.
  const imp = resolverImpuesto(item({ defaultTaxRates: true, taxRates: { elements: [] } }));
  assert.equal(imp.kind, 'por-defecto');
  assert.deepEqual(enlacesDeImpuesto(imp), []);
});

test('IMPUESTO: tasas explicitas, ordenadas para que el conjunto sea estable', () => {
  const imp = resolverImpuesto(item({ taxRates: { elements: [{ id: 'TR-Z' }, { id: 'TR-A' }] } }));
  assert.equal(imp.kind, 'explicito');
  // El orden de Clover no es una promesa. Si el conjunto llegara en otro
  // orden, la comparacion podria reportar cambios que no existen.
  assert.deepEqual(enlacesDeImpuesto(imp), ['TR-A', 'TR-Z']);
});

test('IMPUESTO: `defaultTaxRates` Y enlaces propios es un caso aparte', () => {
  // Si esto ocurre de verdad, `catalog_item_tax_effective` podria contar
  // doble. Por eso tiene su propio estado y su propio aviso en el reporte.
  const imp = resolverImpuesto(
    item({ defaultTaxRates: true, taxRates: { elements: [{ id: 'TR-A' }] } }),
  );
  assert.equal(imp.kind, 'defecto-y-explicito');
  assert.deepEqual(enlacesDeImpuesto(imp), ['TR-A']);
});

test('IMPUESTO: sin expansion no basta `defaultTaxRates` para afirmar nada', () => {
  // Un item puede tener las dos cosas. Decir "solo las por defecto" sin
  // haber visto la expansion es inventarse la mitad del dato.
  assert.equal(resolverImpuesto(item({ defaultTaxRates: true })).kind, 'sin-resolver');
});

// ── CATEGORIA ───────────────────────────────────────────────────────

test('CATEGORIA: la eleccion es DETERMINISTA, o la idempotencia se cae sola', () => {
  // Dos barridos seguidos elegirian categorias distintas y el segundo
  // reportaria cambios que no existen. Menor sortOrder; a igualdad,
  // menor id.
  const cats = [
    { id: 'CAT-B', sortOrder: 20 },
    { id: 'CAT-A', sortOrder: 10 },
    { id: 'CAT-C', sortOrder: 10 },
  ];
  assert.equal(elegirCategoria(cats), 'CAT-A');
  // El orden de llegada no puede cambiar el resultado.
  assert.equal(elegirCategoria([...cats].reverse()), 'CAT-A');
  assert.equal(elegirCategoria([]), null);
});

test('CATEGORIA: sin sortOrder cuentan como 0 y desempata el id', () => {
  assert.equal(elegirCategoria([{ id: 'CAT-Z' }, { id: 'CAT-A' }]), 'CAT-A');
});

test('CATEGORIA: se guardan todas para poder avisar de los multicategoria', () => {
  const m = mapearItemOk(
    item({ categories: { elements: [{ id: 'CAT-B', sortOrder: 20 }, { id: 'CAT-A' }] } }),
  );
  assert.equal(m.categoriaCloverId, 'CAT-A');
  assert.deepEqual(m.todasLasCategorias, ['CAT-B', 'CAT-A']);
});

// ── LO DEMAS ────────────────────────────────────────────────────────

test('un objeto sin id se ignora con motivo: no hay clave natural', () => {
  for (const mapeo of [
    mapearCategoria({ id: '' } as never),
    mapearTasa({ id: '' } as never),
    mapearGrupo({ id: '' } as never),
    mapearModificador({ id: '' } as never, 0),
    mapearItem({ id: '' } as never),
  ]) {
    assert.equal(mapeo.ok, false);
    assert.ok(!mapeo.ok);
    assert.equal(mapeo.motivo, 'sin_id');
  }
});

test('un grupo con maxAllowed < minRequired se ignora, no se escribe', () => {
  // La 0002 tiene un `check`. Escribirlo abortaria la transaccion y con
  // ella el barrido entero, por un grupo mal configurado en el POS.
  const mapeo = mapearGrupo({ id: 'MG-1', name: 'Leche', minRequired: 2, maxAllowed: 1 });
  assert.equal(mapeo.ok, false);
  assert.ok(!mapeo.ok);
  assert.equal(mapeo.motivo, 'grupo_con_limites_imposibles');
});

test('un modificador puede costar NEGATIVO, y se respeta', () => {
  // "Sin azucar -50" es legitimo, y por eso `catalog_modifiers` no tiene
  // `check (>= 0)`. Recortarlo a cero cambiaria el precio del menu.
  const mapeo = mapearModificador({ id: 'MOD-1', name: 'Sin azucar', price: -50 }, 0);
  assert.ok(mapeo.ok);
  assert.equal(mapeo.valor.priceCents, -50);
});

test('un ITEM con precio negativo se recorta a cero: ahi si hay `check`', () => {
  // Un precio negativo en un item no es un descuento, es un dato roto, y
  // `catalog_items.price_cents` tiene `check (>= 0)` desde la 0002.
  assert.equal(mapearItemOk(item({ price: -100 })).fila.priceCents, 0);
});

test('la tasa va en MILESIMAS DE PORCENTAJE, tal cual la da Clover', () => {
  // 8250 = 8,25 %. Ojo con `stores.surcharge_rate`, que es una FRACCION.
  const mapeo = mapearTasa({ id: 'TR-1', name: 'NJ', rate: 6625, isDefault: true });
  assert.ok(mapeo.ok);
  assert.equal(mapeo.valor.rate, 6625);
  assert.equal(mapeo.valor.isDefault, true);
});

test('un nombre ausente es cadena vacia, no null: la columna es not null', () => {
  // Un nombre vacio es feo; una fila rechazada a mitad del barrido es
  // peor, porque se lleva por delante todo lo que venia detras.
  const mapeo = mapearCategoria({ id: 'CAT-1' });
  assert.ok(mapeo.ok);
  assert.equal(mapeo.valor.name, '');
});

test('`alternateName` se espeja, y no es una descripcion', () => {
  // `menu_items.description` cae a esta columna. En Clover suele ser una
  // abreviatura de ticket. Por eso el reporte los cuenta.
  assert.equal(
    mapearItemOk(item({ alternateName: 'GRN JCE 16' })).fila.alternateName,
    'GRN JCE 16',
  );
  // Vacio es null, para que no cuente como "trae algo".
  assert.equal(mapearItemOk(item({ alternateName: '' })).fila.alternateName, null);
});

function mapearItemOk(bruto: ReturnType<typeof item>) {
  const mapeo = mapearItem(bruto);
  assert.ok(mapeo.ok, 'el item se descarto y la prueba esperaba que no');
  return mapeo.valor;
}
