/**
 * Edge Function `catalog-sync`: el barrido completo del catálogo, a mano.
 *
 * ─────────────────────────────────────────────────────────────────────
 * BAJO DEMANDA, NO PERIÓDICO
 * ─────────────────────────────────────────────────────────────────────
 *
 * No hay `pg_cron` detrás de esto, al revés que en `token-refresh`. Lo
 * dispara una persona:
 *
 *   curl -sS -X POST \
 *     -H "Authorization: Bearer $WORKER_CRON_SECRET" \
 *     -H 'Content-Type: application/json' \
 *     -d '{"store_id":"<uuid>"}' \
 *     https://<ref>.supabase.co/functions/v1/catalog-sync
 *
 * El barrido periódico y los webhooks de inventario van en PR posteriores.
 * Lo que sí queda hecho es que el MAPEO sea reutilizable: vive entero en
 * `workers/src/catalog-sync/mapping.ts` y no sabe si le llegan mil ítems
 * o uno.
 *
 * LA PUERTA ES LA MISMA QUE LA DEL WORKER DE REFRESCO, y por la misma
 * razón: la comprobación del gateway la pasa cualquier clave del proyecto
 * —la anónima viaja dentro del APK—, así que `verify_jwt` no autorizaría
 * nada. Se reutiliza `WORKER_CRON_SECRET` en vez de inventar una
 * credencial nueva: una credencial más es una credencial más que rotar.
 * El razonamiento entero está en `token-refresh/auth.ts`.
 *
 * QUÉ DEVUELVE
 * El reporte completo, que es lo que se lee para validar el mapeo. También
 * queda en `app.catalog_sync_runs`, porque un reporte que solo existe en
 * la salida de un `curl` se pierde al cerrar la terminal.
 */

import postgres from 'npm:postgres@3.4.5';

import { CloverClient } from '../../../packages/clover-client/src/index.ts';
import {
  postgresCatalogStore,
  runCatalogSweep,
  type SqlRunner,
} from '../../../workers/src/catalog-sync/index.ts';
import { cloverEnvironment } from '../_shared/clover-environment.ts';
import { assertCronSecret, authorizeCronRequest } from '../token-refresh/auth.ts';
import { leerAccessToken, reservarSucursal, soltarSucursal } from './lease.ts';
import { cloverCatalogSource } from './source.ts';
import { leerStoreId } from './peticion.ts';

const FUNCTION_NAME = 'catalog-sync';

const DB_URL = requerida('SUPABASE_DB_URL');
const APP_ID = requerida('CLOVER_APP_ID');
const CRON_SECRET = assertCronSecret(requerida('WORKER_CRON_SECRET'));

// `prepare: false`: el pooler de Supabase en modo transacción no soporta
// sentencias preparadas. `max: 2`: una Edge Function es efímera y no debe
// acaparar conexiones del pool compartido.
const sql = postgres(DB_URL, { prepare: false, max: 2 });
const run: SqlRunner = (text, params) => sql.unsafe(text, params);
const store = postgresCatalogStore(run);

/**
 * UN CLIENTE POR ENTORNO. El limitador de 50 req/s vive dentro, y dos
 * instancias son dos limitadores que no se hablan, cada uno convencido de
 * tener el techo entero. Ese techo se comparte con el tráfico que está
 * cobrando: un barrido de catálogo no puede comérselo en ráfaga.
 *
 * Fuera del handler a propósito: el isolate se reutiliza entre
 * invocaciones y con él el estado del limitador.
 */
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
  const auth = authorizeCronRequest(req.headers.get('authorization'), CRON_SECRET);
  if (!auth.ok) {
    // El motivo va al log y NO al cuerpo: decirle a quien llama en qué
    // falló su credencial es ayudarle a acertar a la siguiente.
    log.warn('no_autorizado', { motivo: auth.motivo, metodo: req.method });
    return json(401, { error: 'no autorizado' });
  }

  if (req.method === 'GET') {
    // Comprobación tras desplegar: no toca ni Clover ni el catálogo.
    return json(200, { ok: true, funcion: FUNCTION_NAME, pide: { store_id: 'uuid' } });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'solo GET (comprobación) y POST (un barrido)' });
  }

  const storeId = leerStoreId(await cuerpo(req));
  if (storeId === null) {
    return json(400, { error: 'falta store_id, o no es un uuid' });
  }

  const sucursal = await reservarSucursal(run, storeId);
  if (sucursal === null) {
    // Las dos causas se contestan igual a propósito: "ya hay un barrido"
    // y "esta sucursal no está conectada" son ambas "ahora no", y
    // distinguirlas por HTTP le diría a quien prueba uuids al azar cuándo
    // ha acertado uno. En el log sí se distinguen.
    log.warn('sin_reserva', { store: storeId });
    return json(409, {
      error:
        'no se pudo reservar la sucursal: o hay un barrido en marcha, o no está conectada a Clover',
    });
  }

  try {
    const accessToken = await leerAccessToken(run, sucursal.connectionId);
    const reporte = await runCatalogSweep(
      {
        source: cloverCatalogSource(
          clienteFor(sucursal.environment),
          sucursal.merchantId,
          accessToken,
        ),
        store,
        now: () => new Date(),
        log,
      },
      { storeId: sucursal.storeId, merchantId: sucursal.merchantId },
    );

    // 200 aunque `completo` sea false: el barrido corrió y el reporte es
    // la respuesta. Lo que dice si sirve para algo es ese campo, no el
    // código HTTP, y meterlo en un 500 escondería el reporte parcial —que
    // es justo lo que hay que leer cuando algo falló a medias—.
    return json(200, reporte as unknown as Record<string, unknown>);
  } catch (err) {
    // Aquí solo llega lo que el barrido no pudo ni reportar: el token
    // ilegible, la base caída. Un fallo DENTRO del barrido ya sale como
    // `completo: false` con su reporte.
    const error = err instanceof Error ? err.message : String(err);
    log.error('barrido_no_completado', { store: storeId, error });
    return json(500, { error: 'el barrido no se completó; mirar los logs de la función' });
  } finally {
    // EL ARRIENDO SE SUELTA PASE LO QUE PASE. Sin esto, un barrido que
    // revienta deja la sucursal bloqueada hasta que caduque el arriendo,
    // y quien lo reintente se lleva un 409 sin entender por qué.
    await soltarSucursal(run, sucursal.connectionId).catch((err: unknown) => {
      log.error('arriendo_no_soltado', {
        conexion: sucursal.connectionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
});

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

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') {
    throw new Error(`Falta la variable de entorno ${nombre}.`);
  }
  return valor;
}
