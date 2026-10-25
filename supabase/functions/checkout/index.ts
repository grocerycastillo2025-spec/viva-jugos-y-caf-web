/**
 * Edge Function `checkout`: crear el pedido en Clover y cobrarlo.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO PODÍA SEGUIR SIENDO UNA RPC
 * ─────────────────────────────────────────────────────────────────────
 *
 * Lo dejó escrito la propia 0008: crear el pedido y cobrarlo tienen que
 * ocurrir bajo la MISMA idempotencia, porque el fallo que hay que evitar
 * es cobrar sin pedido o pedir sin cobro. Y eso no cabe en un RPC:
 * Postgres no puede llamar a una API externa y esperar la respuesta.
 *
 * Lo que NO se mudó es la validación. Sigue en la base
 * (`app.open_checkout_attempt`, 0018) porque valida contra datos que están
 * allí y porque lo que no se le puede creer al teléfono no se le puede
 * creer en ningún sitio. Aquí no se mira ni un precio del cuerpo de la
 * petición: las líneas que van a Clover salen de la base.
 *
 * ─────────────────────────────────────────────────────────────────────
 * EL ORDEN, QUE ES TODO
 * ─────────────────────────────────────────────────────────────────────
 *
 *   checkouts -> crear orden -> COBRAR -> imprimir
 *
 * La orden se crea ANTES de cobrar. Si el cobro falla, se anula. Al revés
 * —cobrar y luego crear— deja dinero cobrado sin pedido: la cocina no lo
 * ve, el merchant no lo puede reembolsar desde su POS y el cliente tiene
 * un cargo y ninguna comida. Es el riesgo R10.
 *
 * El orden vive en `workers/src/checkout/maquina.ts` como un tipo, no como
 * cinco `await` que alguien pueda reordenar.
 *
 * Ver docs/PEDIDOS-COBRO.md.
 */

import postgres from 'npm:postgres@3.4.5';

import { CloverClient } from '../../../packages/clover-client/src/index.ts';
import {
  abrirIntento,
  ejecutarCheckout,
  postgresCheckoutStore,
  yaSeCobro,
  type SqlRunner,
} from '../../../workers/src/checkout/index.ts';
import { cloverEnvironment } from '../_shared/clover-environment.ts';
import { identificar, leerBearer } from './auth.ts';
import { cloverCheckoutApi } from './clover.ts';
import { itemsParaLaBase, leerPeticion } from './peticion.ts';

const FUNCTION_NAME = 'checkout';

const DB_URL = requerida('SUPABASE_DB_URL');
const SUPABASE_URL = requerida('SUPABASE_URL');
const ANON_KEY = requerida('SUPABASE_ANON_KEY');
const APP_ID = requerida('CLOVER_APP_ID');

const sql = postgres(DB_URL, { prepare: false, max: 4 });
const run: SqlRunner = (text, params) => sql.unsafe(text, params);
const store = postgresCheckoutStore(run);

// UN CLIENTE POR ENTORNO: el limitador de 50 req/s vive dentro, y dos
// instancias son dos limitadores que no se hablan. Aquí además es tráfico
// `transactional`, que es el único que puede robarle cuota a los demás.
const clientes = new Map<string, CloverClient>();
function clienteFor(environment: string): CloverClient {
  let cliente = clientes.get(environment);
  if (cliente === undefined) {
    cliente = new CloverClient({ environment: cloverEnvironment(environment), appId: APP_ID });
    clientes.set(environment, cliente);
  }
  return cliente;
}

const log = {
  info: (event: string, datos?: Record<string, unknown>) =>
    console.log(JSON.stringify({ nivel: 'info', fn: FUNCTION_NAME, event, ...datos })),
  warn: (event: string, datos?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ nivel: 'warn', fn: FUNCTION_NAME, event, ...datos })),
  error: (event: string, datos?: Record<string, unknown>) =>
    console.error(JSON.stringify({ nivel: 'error', fn: FUNCTION_NAME, event, ...datos })),
};

log.info('arranque', { appId: APP_ID });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json(405, { error: 'solo POST' });

  const token = leerBearer(req.headers.get('authorization'));
  if (token === null) return json(401, { error: 'no autorizado' });

  const identidad = await identificar(fetch, {
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    token,
  });
  if (!identidad.ok) {
    // El motivo va al log y NO al cuerpo: distinguirle a quien llama entre
    // "token caducado" y "token sin usuario" es ayudarle a acertar.
    log.warn('no_autorizado', { motivo: identidad.motivo });
    return json(401, { error: 'no autorizado' });
  }

  const lectura = leerPeticion(await cuerpo(req));
  if (!lectura.ok) return json(400, { error: lectura.error });
  const peticion = lectura.peticion;

  // ── 1. Abrir el intento, o recuperarlo ────────────────────────────
  //
  // Aquí se valida TODO: sucursal, horario, capacidad, precios,
  // modificadores y la politica de recargo. Un reintento con la misma
  // clave no crea un segundo pedido: devuelve el que hay, con su estado,
  // para retomar la secuencia donde se quedó.
  let intento;
  try {
    intento = await abrirIntento(run, {
      userId: identidad.userId,
      storeId: peticion.storeId,
      idempotencyKey: peticion.idempotencyKey,
      pickupAt: peticion.pickupAt,
      isAsap: peticion.isAsap,
      customerNote: peticion.customerNote,
      items: itemsParaLaBase(peticion.items),
    });
  } catch (err) {
    const motivo = motivoDeNegocio(err);
    if (motivo !== null) {
      log.warn('checkout_rechazado', { motivo, store: peticion.storeId });
      return json(motivo === 'idempotency_key_conflict' ? 409 : 422, { error: motivo });
    }
    log.error('no_se_pudo_abrir_el_intento', { error: mensaje(err) });
    return json(500, { error: 'no se pudo abrir el pedido' });
  }

  const traza = { intento: intento.id, pedido: intento.orderId, store: intento.storeId };

  // ── 2. La secuencia con Clover ────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = await leerAccessToken(intento.storeId);
  } catch (err) {
    // Sin token no se puede ni empezar. El pedido queda abierto y el
    // reintento con la misma clave lo retoma cuando el worker de refresco
    // arregle la conexión, que como mucho es en cinco minutos.
    log.error('sin_access_token', { ...traza, error: mensaje(err) });
    return json(503, {
      error: 'la sucursal no puede cobrar ahora mismo',
      order_id: intento.orderId,
    });
  }

  const resultado = await ejecutarCheckout(
    {
      api: cloverCheckoutApi(clienteFor(intento.environment), intento.merchantId, accessToken),
      store,
      log,
    },
    { intento, source: peticion.source, tipCents: peticion.tipCents },
  );

  if (resultado.ordenHuerfana) {
    // El cobro falló Y la anulación también: hay una orden sin pagar viva
    // en el POS del merchant. Sale en `checkouts_atascados` para que
    // alguien la anule a mano.
    log.error('orden_huerfana_en_clover', {
      ...traza,
      clover_order_id: resultado.cloverOrderId,
      accion: 'anular a mano; ver la vista checkouts_atascados',
    });
  }

  const cobrado = resultado.cobrado || yaSeCobro(resultado.estado);
  if (!cobrado) {
    // NO se dice "vuelve a intentarlo" sin más: si el pedido ya estuviera
    // cobrado, eso sería invitar a pagar dos veces. Aquí no lo está, así
    // que reintentar con LA MISMA clave es seguro y es lo que hay que
    // hacer — y por eso se devuelve la clave.
    return json(402, {
      error: 'no se pudo cobrar',
      order_id: intento.orderId,
      idempotency_key: intento.idempotencyKey,
      reintentable: true,
    });
  }

  return json(200, {
    order_id: intento.orderId,
    order_number: intento.orderNumber,
    pickup_code: intento.pickupCode,
    clover_order_id: resultado.cloverOrderId,
    // El pedido es válido aunque esto sea `false`: un fallo de impresión
    // es operativo, no financiero. El restaurante lo ve en su app de
    // Orders igual.
    impreso: resultado.impreso,
    estado: resultado.estado,
  });
});

/**
 * El access token vigente de la sucursal, desde Vault.
 *
 * NO SE REFRESCA AQUÍ. De rotar se encarga su worker, con su propio
 * arriendo: un checkout que además rotase sería un segundo escritor de un
 * token de un solo uso, y dos escritores de eso dejan la conexión muerta.
 */
async function leerAccessToken(storeId: string): Promise<string> {
  const filas = await run(
    `select s.decrypted_secret
       from public.clover_connections c
       join vault.decrypted_secrets s on s.id = c.access_token_secret_id
      where c.store_id = $1`,
    [storeId],
  );
  const valor = filas[0]?.['decrypted_secret'];
  if (typeof valor !== 'string' || valor === '') {
    throw new Error(`la sucursal ${storeId} no tiene access token legible en Vault`);
  }
  return valor;
}

/**
 * Los errores que `app.open_checkout_attempt` levanta a propósito.
 *
 * Son mensajes para el cliente —"esa franja está llena", "ese producto se
 * agotó"— y se distinguen de un fallo de verdad por la forma: son
 * identificadores sin espacios. Lo demás es un 500.
 */
function motivoDeNegocio(err: unknown): string | null {
  const texto = mensaje(err);
  const primera = texto.split('\n')[0]?.trim() ?? '';
  return /^[a-z_]+(:.*)?$/.test(primera) ? primera : null;
}

async function cuerpo(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function json(status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(`${JSON.stringify(cuerpo)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function mensaje(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}
