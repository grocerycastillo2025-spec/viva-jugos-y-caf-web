/**
 * Los dos topes de Clover que, si se ignoran, fallan EN SILENCIO:
 * 100 elementos por pagina y 90 dias por filtro de tiempo. Ninguno de los
 * dos da error; los dos dan menos datos de los que pediste.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collect,
  MAX_PAGE_SIZE,
  MAX_TIME_WINDOW_MS,
  modifiedSince,
  paginate,
  timeWindows,
  type CloverList,
  type PageParams,
} from '../pagination.ts';

/** Un listado falso de `total` elementos que respeta limit/offset. */
function servidor(total: number) {
  const vistos: PageParams[] = [];
  const fetchPage = async ({ limit, offset }: PageParams): Promise<CloverList<number>> => {
    vistos.push({ limit, offset });
    const elements = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => offset + i);
    return { elements };
  };
  return { fetchPage, vistos };
}

test('recorre todas las paginas y no se deja ninguna', async () => {
  // El fallo real que esto evita: un merchant con 250 productos sincroniza
  // 100 y los otros 150 no existen para la app. Sin error.
  const { fetchPage, vistos } = servidor(250);
  const todos = await collect(paginate(fetchPage));

  assert.equal(todos.length, 250);
  assert.deepEqual(todos[0], 0);
  assert.deepEqual(todos[249], 249);
  assert.deepEqual(
    vistos.map((v) => v.offset),
    [0, 100, 200],
  );
});

test('una pagina incompleta es el final: no pide una de mas', async () => {
  const { fetchPage, vistos } = servidor(40);
  assert.equal((await collect(paginate(fetchPage))).length, 40);
  assert.equal(vistos.length, 1);
});

test('un catalogo vacio no da una vuelta de mas', async () => {
  const { fetchPage, vistos } = servidor(0);
  assert.deepEqual(await collect(paginate(fetchPage)), []);
  assert.equal(vistos.length, 1);
});

test('el tamano de pagina nunca supera el tope de Clover', async () => {
  const { fetchPage, vistos } = servidor(10);
  await collect(paginate(fetchPage, { pageSize: 500 }));
  assert.equal(vistos[0]!.limit, MAX_PAGE_SIZE);
});

test('un endpoint que no avanza se corta en vez de girar para siempre', async () => {
  // Sin este cinturon, un endpoint que devolviera siempre una pagina
  // llena dejaria el worker consumiendo el techo compartido de la app.
  const fetchPage = async (): Promise<CloverList<number>> => ({
    elements: Array.from({ length: 100 }, () => 1),
  });
  await assert.rejects(collect(paginate(fetchPage, { maxPages: 3 })), /no avanza/);
});

test('un rango de mas de 90 dias se parte en ventanas', () => {
  // Clover recorta a los ultimos 90 dias SIN avisar: un backfill de un ano
  // en una sola llamada trae tres meses y parece que funciono.
  const dia = 24 * 60 * 60 * 1000;
  const ventanas = timeWindows(0, 365 * dia);

  assert.equal(ventanas.length, 5);
  assert.equal(ventanas[0]!.from, 0);
  assert.equal(ventanas[4]!.to, 365 * dia);
  for (const v of ventanas) assert.ok(v.to - v.from <= MAX_TIME_WINDOW_MS);

  // Y las ventanas encajan sin huecos: un hueco es un producto perdido.
  for (let i = 1; i < ventanas.length; i += 1) {
    assert.equal(ventanas[i]!.from, ventanas[i - 1]!.to);
  }
});

test('un rango corto es una sola ventana, y uno vacio no es ninguna', () => {
  assert.equal(timeWindows(1000, 2000).length, 1);
  assert.deepEqual(timeWindows(2000, 2000), []);
  assert.deepEqual(timeWindows(2000, 1000), []);
});

test('modifiedTime va en milisegundos, y lo demas se rechaza', () => {
  assert.equal(modifiedSince(1_700_000_000_000), 'modifiedTime>=1700000000000');
  // Mandarlo en segundos no da error en Clover: devuelve el catalogo
  // ENTERO cada vez, contra el presupuesto compartido. Por eso se valida
  // aqui, donde si se puede fallar ruidosamente.
  assert.throws(() => modifiedSince(1.5), /milisegundos/);
  assert.throws(() => modifiedSince(-1), /milisegundos/);
});
