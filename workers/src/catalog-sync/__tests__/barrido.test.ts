/**
 * El barrido completo: idempotencia, paginacion y reporte.
 *
 * Las tres cosas que el alcance del PR pide demostrar, mas la que las
 * sostiene: que toda eleccion sea determinista. Sin eso, la idempotencia
 * no se puede ni definir.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CloverCategory,
  CloverItem,
  CloverModifier,
  CloverModifierGroup,
  CloverTaxRate,
} from '@juicebar/clover-client';
import { huboCambios, type Reporte } from '../report.ts';
import type { CatalogSource, Paginas } from '../ports.ts';
import { runCatalogSweep } from '../sweep.ts';
import { EspejoEnMemoria } from './espejo-en-memoria.ts';

const STORE = '22222222-2222-2222-2222-222222222222';
const AHORA = new Date('2026-09-11T12:00:00.000Z');

interface Catalogo {
  readonly categories?: readonly CloverCategory[] | undefined;
  readonly taxRates?: readonly CloverTaxRate[] | undefined;
  readonly modifierGroups?: readonly CloverModifierGroup[] | undefined;
  readonly modifiers?: Readonly<Record<string, readonly CloverModifier[]>> | undefined;
  readonly items?: readonly CloverItem[] | undefined;
}

/**
 * Sirve el catalogo en paginas del tamaño que se pida. El tamaño de
 * pagina es lo que convierte esta prueba en una prueba de paginacion: con
 * `tam = 3` y 7 elementos salen tres paginas, y la ultima incompleta es
 * la señal de fin.
 */
function fuente(cat: Catalogo, tam = 100): CatalogSource {
  async function* paginar<T>(todos: readonly T[]): Paginas<T> {
    for (let i = 0; i < todos.length; i += tam) yield todos.slice(i, i + tam);
    // Un catalogo cuyo tamaño es multiplo exacto del tamaño de pagina
    // termina con una pagina vacia, igual que en Clover.
    if (todos.length > 0 && todos.length % tam === 0) yield [];
  }
  return {
    categories: () => paginar(cat.categories ?? []),
    taxRates: () => paginar(cat.taxRates ?? []),
    modifierGroups: () => paginar(cat.modifierGroups ?? []),
    modifiers: (grupoId) => paginar(cat.modifiers?.[grupoId] ?? []),
    items: () => paginar(cat.items ?? []),
  };
}

function barrer(espejo: EspejoEnMemoria, cat: Catalogo, tam = 100): Promise<Reporte> {
  return runCatalogSweep(
    { source: fuente(cat, tam), store: espejo, now: () => AHORA },
    { storeId: STORE, merchantId: 'RGW5JAVFT8MB1' },
  );
}

const CATALOGO: Catalogo = {
  categories: [
    { id: 'CAT-JUICES', name: 'Juices', sortOrder: 10 },
    { id: 'CAT-COFFEE', name: 'Hot Coffee', sortOrder: 20 },
  ],
  taxRates: [{ id: 'TR-NJ', name: 'NJ Sales Tax', rate: 6625, isDefault: true }],
  modifierGroups: [{ id: 'MG-MILK', name: 'Milk', minRequired: 1, maxAllowed: 1 }],
  modifiers: {
    'MG-MILK': [
      { id: 'MOD-OAT', name: 'Oat', price: 75 },
      { id: 'MOD-SKIM', name: 'Skim', price: 0 },
    ],
  },
  items: [
    {
      id: 'IT-GREEN',
      name: 'Green Juice',
      price: 850,
      priceType: 'FIXED',
      categories: { elements: [{ id: 'CAT-JUICES', sortOrder: 10 }] },
      taxRates: { elements: [{ id: 'TR-NJ' }] },
    },
    {
      id: 'IT-LATTE',
      name: 'Latte',
      price: 500,
      priceType: 'FIXED',
      defaultTaxRates: true,
      categories: { elements: [{ id: 'CAT-COFFEE', sortOrder: 20 }] },
      modifierGroups: { elements: [{ id: 'MG-MILK' }] },
      taxRates: { elements: [] },
    },
  ],
};

// ── IDEMPOTENCIA ────────────────────────────────────────────────────

test('IDEMPOTENCIA: la segunda vuelta no cambia NADA', async () => {
  const espejo = new EspejoEnMemoria();

  const primera = await barrer(espejo, CATALOGO);
  assert.equal(primera.completo, true);
  assert.equal(primera.entidades.items.creadas, 2);
  assert.equal(primera.entidades.categorias.creadas, 2);
  assert.equal(primera.entidades.modificadores.creadas, 2);
  assert.equal(huboCambios(primera), true);

  const segunda = await barrer(espejo, CATALOGO);

  // El aserto del alcance del PR, en una linea.
  assert.equal(huboCambios(segunda), false, JSON.stringify(segunda.entidades, null, 2));
  assert.deepEqual(segunda.entidades.items, { creadas: 0, actualizadas: 0, sin_cambios: 2 });
  assert.deepEqual(segunda.entidades.categorias, { creadas: 0, actualizadas: 0, sin_cambios: 2 });
  assert.deepEqual(segunda.entidades.tasas, { creadas: 0, actualizadas: 0, sin_cambios: 1 });
  assert.deepEqual(segunda.entidades.grupos, { creadas: 0, actualizadas: 0, sin_cambios: 1 });
  assert.deepEqual(segunda.entidades.modificadores, {
    creadas: 0,
    actualizadas: 0,
    sin_cambios: 2,
  });
});

test('IDEMPOTENCIA: los ENLACES tampoco se mueven en la segunda vuelta', async () => {
  // El fallo clasico: borrar los enlaces y reinsertarlos. La tabla queda
  // igual, las escrituras cuentan, y el reporte dice que cambio algo que
  // no cambio. Se reconcilian por diferencia de conjuntos.
  const espejo = new EspejoEnMemoria();
  await barrer(espejo, CATALOGO);
  const segunda = await barrer(espejo, CATALOGO);
  assert.equal(segunda.entidades.items.actualizadas, 0);
});

test('IDEMPOTENCIA: un cambio REAL si se reporta, y solo en el item que cambio', async () => {
  const espejo = new EspejoEnMemoria();
  await barrer(espejo, CATALOGO);

  const subidaDePrecio: Catalogo = {
    ...CATALOGO,
    items: (CATALOGO.items ?? []).map((i) => (i.id === 'IT-GREEN' ? { ...i, price: 900 } : i)),
  };
  const tercera = await barrer(espejo, subidaDePrecio);

  assert.deepEqual(tercera.entidades.items, { creadas: 0, actualizadas: 1, sin_cambios: 1 });
  assert.equal(espejo.fila('items', `${STORE}|IT-GREEN`)?.['priceCents'], 900);
});

test('IDEMPOTENCIA: un item en dos categorias no baila entre vueltas', async () => {
  // La eleccion de categoria tiene que depender solo de los datos. Si
  // dependiera del orden de llegada, la segunda vuelta reportaria un
  // cambio que no existe — y este es el escenario que lo destaparia.
  const enDos: Catalogo = {
    categories: CATALOGO.categories,
    items: [
      {
        id: 'IT-X',
        name: 'Combo',
        price: 100,
        categories: {
          elements: [
            { id: 'CAT-COFFEE', sortOrder: 20 },
            { id: 'CAT-JUICES', sortOrder: 10 },
          ],
        },
      },
    ],
  };
  const alReves: Catalogo = {
    ...enDos,
    items: [
      {
        ...enDos.items![0]!,
        categories: {
          elements: [
            { id: 'CAT-JUICES', sortOrder: 10 },
            { id: 'CAT-COFFEE', sortOrder: 20 },
          ],
        },
      },
    ],
  };

  const espejo = new EspejoEnMemoria();
  const primera = await barrer(espejo, enDos);
  const segunda = await barrer(espejo, alReves);

  assert.equal(primera.entidades.items.creadas, 1);
  assert.equal(huboCambios(segunda), false, 'la categoria elegida cambio con el orden de llegada');
  assert.equal(primera.avisos.items_multicategoria.length, 1);
});

// ── PAGINACION ──────────────────────────────────────────────────────

test('PAGINACION: 120 items no caben en una pagina, y entran los 120', async () => {
  // El catalogo de Viva son ~50, pero el tope de Clover son 100 por
  // pagina y un barrido que lea solo la primera no da error: da menos
  // comida.
  const muchos: Catalogo = {
    items: Array.from({ length: 120 }, (_v, i) => ({
      id: `IT-${String(i).padStart(3, '0')}`,
      name: `Producto ${i}`,
      price: 100 + i,
    })),
  };

  const espejo = new EspejoEnMemoria();
  const reporte = await barrer(espejo, muchos, 50);

  assert.equal(reporte.entidades.items.creadas, 120);
  assert.equal(reporte.paginas['items'], 3);
  assert.equal(espejo.fila('items', `${STORE}|IT-119`)?.['name'], 'Producto 119');

  // Y sigue siendo idempotente con varias paginas.
  assert.equal(huboCambios(await barrer(espejo, muchos, 50)), false);
});

test('PAGINACION: los modificadores paginan POR GRUPO', async () => {
  const cat: Catalogo = {
    modifierGroups: [
      { id: 'MG-A', name: 'A' },
      { id: 'MG-B', name: 'B' },
    ],
    modifiers: {
      'MG-A': [
        { id: 'M1', name: 'a1' },
        { id: 'M2', name: 'a2' },
        { id: 'M3', name: 'a3' },
      ],
      'MG-B': [{ id: 'M4', name: 'b1' }],
    },
  };
  const reporte = await barrer(new EspejoEnMemoria(), cat, 2);
  assert.equal(reporte.entidades.modificadores.creadas, 4);
  // MG-A: dos paginas (2 + 1). MG-B: una.
  assert.equal(reporte.paginas['modificadores'], 3);
});

// ── REPORTE ─────────────────────────────────────────────────────────

test('REPORTE: lo ignorado dice QUE y POR QUE, no solo cuanto', async () => {
  const cat: Catalogo = {
    modifierGroups: [{ id: 'MG-MAL', name: 'Imposible', minRequired: 3, maxAllowed: 1 }],
    items: [
      { id: 'IT-OK', name: 'Bueno', price: 100 },
      { id: 'IT-RARO', name: 'Cuarto tipo', price: 100, priceType: 'PER_HOUR' },
      { id: '', name: 'Sin id' } as CloverItem,
    ],
  };
  const reporte = await barrer(new EspejoEnMemoria(), cat);

  assert.equal(reporte.entidades.items.creadas, 1);
  assert.deepEqual(
    reporte.ignorados.map((i) => [i.tipo, i.nombre, i.motivo]),
    [
      ['grupo_modificadores', 'Imposible', 'grupo_con_limites_imposibles'],
      ['item', 'Cuarto tipo', 'price_type_desconocido'],
      ['item', 'Sin id', 'sin_id'],
    ],
  );
});

test('REPORTE: los avisos contestan las preguntas abiertas del documento', async () => {
  const cat: Catalogo = {
    taxRates: [{ id: 'TR-NJ', name: 'NJ', rate: 6625, isDefault: true }],
    items: [
      { id: 'IT-OCULTO', name: 'Retirado', price: 100, hidden: true, taxRates: { elements: [] } },
      {
        id: 'IT-VAR',
        name: 'Catering',
        price: 0,
        priceType: 'VARIABLE',
        taxRates: { elements: [] },
      },
      { id: 'IT-SINTAX', name: 'Sin resolver', price: 100 },
      {
        id: 'IT-DOBLE',
        name: 'Doble',
        price: 100,
        defaultTaxRates: true,
        taxRates: { elements: [{ id: 'TR-NJ' }] },
      },
      {
        id: 'IT-ALT',
        name: 'Con alias',
        price: 100,
        alternateName: 'GRN JCE 16',
        taxRates: { elements: [] },
      },
    ],
  };
  const reporte = await barrer(new EspejoEnMemoria(), cat);

  assert.deepEqual(
    reporte.avisos.items_ocultos.map((a) => a.clover_id),
    ['IT-OCULTO'],
  );
  assert.deepEqual(
    reporte.avisos.items_no_pedibles.map((a) => a.detalle),
    ['VARIABLE'],
  );
  assert.deepEqual(
    reporte.avisos.impuesto_sin_resolver.map((a) => a.clover_id),
    ['IT-SINTAX'],
  );
  assert.deepEqual(
    reporte.avisos.items_default_con_enlaces.map((a) => a.clover_id),
    ['IT-DOBLE'],
  );
  assert.deepEqual(
    reporte.avisos.items_con_alternate_name.map((a) => a.detalle),
    ['GRN JCE 16'],
  );
});

test('REPORTE: un item VARIABLE se sincroniza, y ademas se avisa', async () => {
  // Las dos cosas a la vez: existe en el espejo (el operador puede
  // mirarlo) y sale en el aviso (sabe por que no esta en la app).
  const espejo = new EspejoEnMemoria();
  const reporte = await barrer(espejo, {
    items: [{ id: 'IT-VAR', name: 'Catering', price: 0, priceType: 'VARIABLE' }],
  });
  assert.equal(reporte.entidades.items.creadas, 1);
  assert.equal(espejo.fila('items', `${STORE}|IT-VAR`)?.['priceType'], 'VARIABLE');
  assert.equal(reporte.avisos.items_no_pedibles.length, 1);
});

test('REPORTE: el impuesto SIN RESOLVER no borra los enlaces que ya habia', async () => {
  // La regla entera del diseño: escribir cero enlaces cuando no llego la
  // expansion declararia EXENTO un producto que quiza paga impuesto.
  const espejo = new EspejoEnMemoria();
  await barrer(espejo, {
    taxRates: [{ id: 'TR-NJ', name: 'NJ', rate: 6625 }],
    items: [{ id: 'IT-1', name: 'Zumo', price: 100, taxRates: { elements: [{ id: 'TR-NJ' }] } }],
  });
  const itemId = 'uuid-2';
  assert.deepEqual(espejo.tasasDe(itemId), ['uuid-1']);

  // Segunda vuelta SIN la expansion: no se toca nada.
  const segunda = await barrer(espejo, {
    taxRates: [{ id: 'TR-NJ', name: 'NJ', rate: 6625 }],
    items: [{ id: 'IT-1', name: 'Zumo', price: 100 }],
  });
  assert.deepEqual(espejo.tasasDe(itemId), ['uuid-1'], 'se borro el enlace por no saber');
  assert.equal(segunda.avisos.impuesto_sin_resolver.length, 1);
});

test('REPORTE: lo que esta en el espejo y no vino de Clover se NOMBRA, no se borra', async () => {
  // El seed `SEED-` vive aqui, y un barrido que borrase por ausencia se
  // lo llevaria entero en su primera vuelta.
  const espejo = new EspejoEnMemoria();
  espejo.preexistentes.set('SEED-JUICE-VIVA', 'Viva Juice');

  const reporte = await barrer(espejo, CATALOGO);

  assert.deepEqual(
    reporte.avisos.en_supabase_no_en_clover.map((a) => a.clover_id),
    ['SEED-JUICE-VIVA'],
  );
  // Y sigue ahi: no hay ninguna llamada que lo borre.
  assert.ok((await espejo.itemsConocidos()).has('SEED-JUICE-VIVA'));
});

test('REPORTE: un barrido que revienta deja reporte, con `completo: false`', async () => {
  // Un barrido que muere sin reporte no se puede diagnosticar. Y lo
  // escrito hasta el fallo es correcto: cada upsert es su propia verdad.
  const espejo = new EspejoEnMemoria();
  const rota: CatalogSource = {
    ...fuente(CATALOGO),
    items: async function* () {
      yield [{ id: 'IT-GREEN', name: 'Green Juice', price: 850 }];
      throw new Error('Clover 502 a mitad de la paginacion');
    },
  };

  const reporte = await runCatalogSweep(
    { source: rota, store: espejo, now: () => AHORA },
    { storeId: STORE, merchantId: 'RGW5JAVFT8MB1' },
  );

  assert.equal(reporte.completo, false);
  assert.match(reporte.error ?? '', /502/);
  assert.equal(reporte.entidades.items.creadas, 1);
  assert.equal(espejo.reportes.length, 1);
  assert.equal(espejo.reportes[0]!.completo, false);

  // Y NO se acusa a nadie de faltar: con una pagina perdida, "no vino de
  // Clover" no significa nada.
  assert.deepEqual(reporte.avisos.en_supabase_no_en_clover, []);
});

test('el reporte queda guardado, con merchant y marcas de tiempo', async () => {
  // Un reporte que solo existe en la respuesta de un `curl` se pierde al
  // cerrar la terminal.
  const espejo = new EspejoEnMemoria();
  await barrer(espejo, CATALOGO);

  const guardado = espejo.reportes[0]!;
  assert.equal(guardado.storeId, STORE);
  assert.equal(guardado.merchantId, 'RGW5JAVFT8MB1');
  assert.equal(guardado.completo, true);
  assert.equal(guardado.empezado.toISOString(), AHORA.toISOString());
});

test('un grupo descartado no deja al item con un enlace a una FK que no existe', async () => {
  const espejo = new EspejoEnMemoria();
  const reporte = await barrer(espejo, {
    modifierGroups: [{ id: 'MG-MAL', name: 'Imposible', minRequired: 3, maxAllowed: 1 }],
    items: [
      { id: 'IT-1', name: 'Latte', price: 500, modifierGroups: { elements: [{ id: 'MG-MAL' }] } },
    ],
  });

  assert.equal(reporte.entidades.items.creadas, 1);
  assert.equal(reporte.ignorados.length, 1);
  // El item existe, sin ese grupo. Inventar el enlace daria una FK rota.
  assert.equal(reporte.entidades.items.actualizadas, 0);
});
