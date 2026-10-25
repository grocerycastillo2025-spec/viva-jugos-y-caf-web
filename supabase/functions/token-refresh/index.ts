/**
 * Edge Function `token-refresh`: lo que hace que el worker corra solo.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DÓNDE ENCAJA ESTO
 * ─────────────────────────────────────────────────────────────────────
 *
 *   pg_cron  ──cada 5 min──▶  app.run_token_refresh_worker()   (0015)
 *                                      │ net.http_post
 *                                      ▼
 *                             POST /functions/v1/token-refresh  (esto)
 *                                      │
 *                                      ▼
 *                             runTokenRefresh(...)   (workers/src)
 *
 * La lógica —cuándo toca, con qué token se recupera, qué se escribe y en
 * qué orden— está entera en `workers/src/token-refresh` y se prueba sin
 * red y sin base. Aquí solo se leen variables de entorno, se abre una
 * conexión, se comprueba quién llama y se traduce el resumen a JSON.
 *
 * LAS DOS RUTAS, QUE SON UN MÉTODO
 *
 *   POST   una vuelta del worker. Es lo que dispara el cron.
 *   GET    comprobación: contesta sin tocar ninguna conexión. Sirve para
 *          verificar, después de desplegar, que el secreto es el bueno y
 *          que la expresión de cron que espera el código es la que está
 *          programada — sin rotar tokens para averiguarlo.
 *
 * SE DESPLIEGA SIN VERIFICACIÓN DE JWT, Y NO ES LO MISMO QUE EN `oauth`
 * Allí es un requisito del navegador de Clover; aquí es que la
 * comprobación del gateway la pasa cualquier clave del proyecto —la
 * anónima incluida, que viaja dentro del APK—, así que no autorizaría
 * nada. La puerta es `WORKER_CRON_SECRET`. El razonamiento entero está en
 * `auth.ts`.
 *
 * POR QUÉ LA RESPUESTA IMPORTA
 * `pg_net` guarda el cuerpo en `net._http_response`, y la 0015 apunta el
 * id de cada petición. O sea que este JSON es lo que se ve desde SQL al
 * preguntar «¿corrió, y qué hizo?». Por eso lleva el recuento entero y no
 * un `ok`. No lleva ningún token, ningún id de Vault y ningún id de
 * conexión: eso vive en los logs de la función, que los lee menos gente.
 */

import postgres from 'npm:postgres@3.4.5';

import { CloverClient } from '../../../packages/clover-client/src/index.ts';
import {
  bindCloverTokenApi,
  postgresConnectionStore,
  runTokenRefresh,
  vaultTokenStore,
  WORKER_PERIOD_MS,
  type CloverTokenApi,
  type SqlRunner,
} from '../../../workers/src/token-refresh/index.ts';
import { cloverEnvironment } from '../_shared/clover-environment.ts';
import { secretFingerprint } from '../_shared/secret-fingerprint.ts';
import { assertCronSecret, authorizeCronRequest } from './auth.ts';
import { attemptsInsideMargin, CRON_SCHEDULE, FUNCTION_NAME } from './schedule.ts';

// ---------------------------------------------------------------------
// Arranque. Todo lo que puede estar mal configurado, falla AQUÍ.
// ---------------------------------------------------------------------

const DB_URL = requerida('SUPABASE_DB_URL');
const APP_ID = requerida('CLOVER_APP_ID');
const APP_SECRET = requerida('CLOVER_APP_SECRET');
const CRON_SECRET = assertCronSecret(requerida('WORKER_CRON_SECRET'));

/**
 * `prepare: false` no es opcional: el pooler de Supabase en modo
 * transacción no soporta sentencias preparadas, y sin esto la primera
 * consulta falla con un error que no menciona el pooler por ningún lado.
 * `max: 2` porque una Edge Function es efímera y no debe acaparar
 * conexiones del pool compartido.
 */
const sql = postgres(DB_URL, { prepare: false, max: 2 });
const run: SqlRunner = (text, params) => sql.unsafe(text, params);

const store = postgresConnectionStore(run);
const vault = vaultTokenStore(run);

/**
 * UN CLIENTE POR ENTORNO, NO UNO POR CONEXIÓN NI UNO POR PETICIÓN.
 *
 * El limitador de 50 req/s y los breakers viven dentro del cliente, y dos
 * instancias son dos limitadores que no se hablan, cada uno convencido de
 * tener el techo entero. Ese techo es de la APP y se comparte con el
 * tráfico que está cobrando: pasarse no lo paga el worker, lo paga alguien
 * intentando pagar un zumo. Ver `client.ts` y `policy.ts`.
 *
 * El mapa vive fuera del handler a propósito: el isolate se reutiliza
 * entre invocaciones y con él el estado del limitador.
 */
const clientes = new Map<string, CloverClient>();
const apis = new Map<string, CloverTokenApi>();

function apiFor(environment: string): CloverTokenApi {
  let api = apis.get(environment);
  if (api === undefined) {
    let cliente = clientes.get(environment);
    if (cliente === undefined) {
      cliente = new CloverClient({ environment: cloverEnvironment(environment), appId: APP_ID });
      clientes.set(environment, cliente);
    }
    // El App Secret se ata aquí, una vez, y no viaja por el bucle de
    // rotación: en `worker.ts` no aparece la palabra `appSecret` ni una
    // sola vez. Ver `workers/src/token-refresh/clover.ts`.
    api = bindCloverTokenApi(cliente.oauth, { appId: APP_ID, appSecret: APP_SECRET });
    apis.set(environment, api);
  }
  return api;
}

const log = {
  info: (event: string, datos?: Record<string, unknown>) =>
    console.log(JSON.stringify({ nivel: 'info', fn: FUNCTION_NAME, event, ...datos })),
  warn: (event: string, datos?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ nivel: 'warn', fn: FUNCTION_NAME, event, ...datos })),
  error: (event: string, datos?: Record<string, unknown>) =>
    console.error(JSON.stringify({ nivel: 'error', fn: FUNCTION_NAME, event, ...datos })),
};

/**
 * La huella del App Secret en el arranque.
 *
 * Contesta de un vistazo la pregunta que si no se contesta probando:
 * "¿esta función lee el secreto que acabo de rotar, o el viejo?". No sale
 * el secreto, ni un prefijo, ni su longitud — solo un sha256 truncado.
 * Cómo compararlo, en `_shared/secret-fingerprint.ts`.
 *
 * OJO CON LO QUE **NO** DEMUESTRA: `/oauth/v2/refresh` no manda el App
 * Secret (solo `client_id` + `refresh_token`), así que una huella
 * correcta no descarta un `refresco_401` — es que el secreto nunca
 * estuvo en esa ecuación. Donde sí cuenta es en `/oauth/v2/recovery`.
 */
log.info('arranque', {
  cron: CRON_SCHEDULE,
  periodoMs: WORKER_PERIOD_MS,
  appId: APP_ID,
  secreto: await secretFingerprint(APP_SECRET),
});

// ---------------------------------------------------------------------
// El handler
// ---------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const auth = authorizeCronRequest(req.headers.get('authorization'), CRON_SECRET);
  if (!auth.ok) {
    // El motivo va al log y NO al cuerpo: decirle a quien llama en qué
    // falló su credencial es ayudarle a acertar a la siguiente.
    log.warn('no_autorizado', { motivo: auth.motivo, metodo: req.method });
    return json(401, { error: 'no autorizado' });
  }

  if (req.method === 'GET') {
    // Comprobación: no toca ninguna conexión. Lo que devuelve es lo que
    // hay que comparar con `app.token_refresh_worker_status()`.
    return json(200, {
      ok: true,
      cronEsperado: CRON_SCHEDULE,
      periodoMs: WORKER_PERIOD_MS,
      intentosDentroDelMargen: attemptsInsideMargin(),
    });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'solo GET (comprobación) y POST (una vuelta)' });
  }

  try {
    const resumen = await runTokenRefresh({
      store,
      vault,
      cloverFor: apiFor,
      now: () => new Date(),
      log,
    });
    return json(200, { ...resumen });
  } catch (err) {
    // Aquí solo llega lo que el worker no pudo ni registrar: la base
    // caída, el arranque de una conexión, un entorno sin mapear. Cada
    // conexión concreta ya se apunta sola en `last_error`.
    //
    // Se contesta 500 a propósito, aunque nadie humano lo lea: `pg_net`
    // guarda el código en `net._http_response` y es lo que hace que una
    // vuelta rota se DISTINGA de una vuelta sin trabajo. Las dos serían
    // un 200 silencioso, y esa confusión es justo la que deja una
    // sucursal sin token sin que salte nada.
    log.error('vuelta_no_completada', { error: err instanceof Error ? err.message : String(err) });
    return json(500, { error: 'la vuelta no se completó; mirar los logs de la función' });
  }
});

function json(status: number, cuerpo: Record<string, unknown>): Response {
  return new Response(`${JSON.stringify(cuerpo)}\n`, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Un worker de refresco a medio configurar ` +
        'no falla al desplegar: falla la noche que a una sucursal le caduca el token.',
    );
  }
  return valor;
}
