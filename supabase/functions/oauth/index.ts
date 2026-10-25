/**
 * Edge Function `oauth`: el cableado, y nada más.
 *
 * LAS CUATRO RUTAS
 *
 *   GET /functions/v1/oauth/start?t=<connect_token>
 *       Donde aterriza el merchant desde el enlace que le envió el
 *       operador. Redirige a Clover con nuestro `redirect_uri`.
 *
 *   GET /functions/v1/oauth/callback
 *       LO QUE SE REGISTRA EN EL DEVELOPER DASHBOARD DE CLOVER como
 *       *Default OAuth Response URL*. Canjea el `code` por el primer par
 *       de tokens y deja la sucursal conectada.
 *
 *   GET /functions/v1/oauth/launch
 *       LO QUE SE REGISTRA COMO *Alternate Launch Path*. Aquí cae el
 *       merchant al instalar la app desde el App Market. NO conecta nada:
 *       explica. Es la ÚNICA página en inglés, y el porqué está abajo,
 *       en la ruta.
 *
 *   GET /functions/v1/oauth/redirect-uri
 *       Devuelve en texto plano la cadena exacta que hay que pegar en el
 *       dashboard, para no teclearla desde un documento. Ver
 *       `redirect-uri.ts`.
 *
 * ESTA FUNCIÓN SE DESPLIEGA SIN VERIFICACIÓN DE JWT, Y ES OBLIGATORIO
 * Clover redirige el navegador del merchant aquí: no manda —ni puede
 * mandar— la cabecera `Authorization` que Supabase exige por defecto. Con
 * la verificación puesta, el callback contesta 401 a Clover, el merchant ve
 * una página de error y en nuestros logs no aparece nada útil. Está fijado
 * en `supabase/config.toml` (`[functions.oauth] verify_jwt = false`); si se
 * despliega a mano, va con `--no-verify-jwt`.
 *
 * Que sea público no lo deja abierto: lo que autoriza es el `connect_token`
 * del enlace, que es de un solo uso y caduca. Ver `flow.ts`.
 *
 * QUÉ NO ESTÁ AQUÍ
 * Ninguna regla. Todas viven en `flow.ts` y se prueban sin red y sin base.
 * Aquí solo se leen variables de entorno, se abre una conexión y se
 * traduce el resultado a una respuesta HTTP.
 *
 * LAS PÁGINAS VAN EN TEXTO PLANO
 * No por gusto: Supabase reescribe a `text/plain` cualquier `text/html`
 * que salga de una Edge Function sin dominio propio, y de paso le quita
 * el `charset`. El porqué y cómo se recupera el HTML, en `pagina()`.
 */

import postgres from 'npm:postgres@3.4.5';

import { CloverClient } from '../../../packages/clover-client/src/index.ts';
import { cloverEnvironment } from '../_shared/clover-environment.ts';
import { secretFingerprint } from '../_shared/secret-fingerprint.ts';
import {
  completeCallback,
  startConnect,
  type CallbackDeps,
  type FlowOutcome,
  type StartDeps,
} from './flow.ts';
import { postgresConnectStore, vaultTokenStore, type SqlRunner } from './postgres.ts';
import {
  assertRegisteredRedirectUri,
  cloverRedirectUri,
  FUNCTION_NAME,
  FUNCTIONS_PREFIX,
  ROUTES,
} from './redirect-uri.ts';

// ---------------------------------------------------------------------
// Arranque. Todo lo que puede estar mal configurado, falla AQUÍ.
// ---------------------------------------------------------------------

const SUPABASE_URL = requerida('SUPABASE_URL');
const DB_URL = requerida('SUPABASE_DB_URL');
const APP_ID = requerida('CLOVER_APP_ID');
const APP_SECRET = requerida('CLOVER_APP_SECRET');

/**
 * La cadena que va en `redirect_uri`.
 *
 * Si alguien puso `CLOVER_REDIRECT_URL` a mano, se comprueba que sea
 * exactamente la que esta función atiende y el arranque revienta si no.
 * Un `redirect_uri` que no coincide no da un error nuestro: da una página
 * de Clover, del lado del merchant, sin dejar rastro en estos logs.
 */
const REDIRECT_URI = (() => {
  const configurada = Deno.env.get('CLOVER_REDIRECT_URL');
  return configurada === undefined || configurada === ''
    ? cloverRedirectUri(SUPABASE_URL)
    : assertRegisteredRedirectUri(configurada, SUPABASE_URL);
})();

/**
 * `prepare: false` no es opcional: el pooler de Supabase en modo
 * transacción no soporta sentencias preparadas, y sin esto la primera
 * consulta falla con un error que no menciona el pooler por ningún lado.
 * `max: 2` porque una Edge Function es efímera y no debe acaparar
 * conexiones del pool compartido.
 */
const sql = postgres(DB_URL, { prepare: false, max: 2 });
const run: SqlRunner = (text, params) => sql.unsafe(text, params);

const store = postgresConnectStore(run);
const vault = vaultTokenStore(run);

/**
 * Un cliente por entorno, creado a demanda y reutilizado.
 *
 * NO SE CREA UNO POR PETICIÓN: el limitador de 50 req/s y los breakers
 * viven dentro del cliente, y dos instancias son dos limitadores que no se
 * hablan, cada uno convencido de tener el techo entero. Ver `client.ts`.
 */
const clientes = new Map<string, CloverClient>();
function clienteFor(environment: string): CloverClient {
  let c = clientes.get(environment);
  if (c === undefined) {
    c = new CloverClient({ environment: cloverEnvironment(environment), appId: APP_ID });
    clientes.set(environment, c);
  }
  return c;
}

const log = {
  info: (event: string, datos?: Record<string, unknown>) =>
    console.log(JSON.stringify({ nivel: 'info', fn: FUNCTION_NAME, event, ...datos })),
  warn: (event: string, datos?: Record<string, unknown>) =>
    console.warn(JSON.stringify({ nivel: 'warn', fn: FUNCTION_NAME, event, ...datos })),
  error: (event: string, datos?: Record<string, unknown>) =>
    console.error(JSON.stringify({ nivel: 'error', fn: FUNCTION_NAME, event, ...datos })),
};

const startDeps: StartDeps = {
  store,
  cloverFor: (env) => clienteFor(env).oauth,
  appId: APP_ID,
  redirectUri: REDIRECT_URI,
  log,
};

const callbackDeps: CallbackDeps = {
  store,
  vault,
  // El App Secret se ata aquí, una vez, y no viaja por `flow.ts`: en toda
  // la lógica no aparece la palabra `appSecret`. Mismo motivo que en
  // `workers/src/token-refresh/clover.ts`.
  cloverFor: (env) => {
    const oauth = clienteFor(env).oauth;
    return {
      exchangeCode: ({ code }) => oauth.exchangeCode({ appId: APP_ID, appSecret: APP_SECRET, code }),
    };
  },
  log,
};

// La huella del App Secret: la misma pregunta que en `token-refresh`,
// pero aquí sí cuenta de verdad — `exchangeCode` manda el secreto, así
// que un secreto malo rompe el callback del OAuth. Ver
// `_shared/secret-fingerprint.ts`.
log.info('arranque', {
  redirectUri: REDIRECT_URI,
  appId: APP_ID,
  secreto: await secretFingerprint(APP_SECRET),
});

// ---------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const ruta = rutaRelativa(url.pathname);

  if (req.method !== 'GET') {
    // Clover siempre devuelve al merchant con un GET; cualquier otra cosa
    // no viene de este flujo.
    return pagina(405, 'Método no permitido', 'Esta dirección solo responde a GET.');
  }

  try {
    switch (ruta) {
      case ROUTES.redirectUri:
        // Un dato público —es una URL— y el antídoto contra el error más
        // caro de este flujo, que es teclearla con una barra de más.
        return new Response(`${REDIRECT_URI}\n`, {
          status: 200,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
        });

      case ROUTES.launch:
        return aterrizajeAppMarket(url);

      case ROUTES.start:
        return responder(
          await startConnect(startDeps, {
            connectToken: url.searchParams.get('t'),
            now: new Date(),
          }),
        );

      case ROUTES.callback:
        return responder(
          await completeCallback(callbackDeps, {
            params: {
              code: url.searchParams.get('code'),
              merchantId: url.searchParams.get('merchant_id'),
              state: url.searchParams.get('state'),
              error: url.searchParams.get('error'),
            },
            now: new Date(),
          }),
        );

      default:
        return pagina(404, 'No existe', 'Esta dirección no forma parte del flujo de conexión.');
    }
  } catch (err) {
    // El mensaje NO se le enseña al merchant: puede traer detalles de la
    // base o de Clover. Va al log, donde ya hay un evento con los ids.
    log.error('excepcion', { ruta, error: err instanceof Error ? err.message : String(err) });
    return pagina(
      500,
      'Algo se rompió por nuestro lado',
      'Vuelve a intentarlo. Si sigue igual, avisa al restaurante.',
    );
  }
});

/**
 * El aterrizaje del App Market. Informativa, y NADA MÁS.
 *
 * LA ÚNICA PÁGINA EN INGLÉS DE ESTA FUNCIÓN, Y NO ES UNA INCOHERENCIA
 * NO UNIFICAR con las demás. Las otras páginas (`/start`, `/callback`)
 * las ve alguien que YA está en nuestro flujo porque recibió un enlace
 * del operador. Esta la ve cualquiera que instale desde el listado
 * público de Clover en Estados Unidos, sin haber hablado con nadie: es
 * la única que funciona como ESCAPARATE.
 *
 * De ahí que `pagina()` acepte el idioma. No es decoración: le dice al
 * lector de pantalla cómo pronunciarlo y al navegador si ofrecer
 * traducción. Como estas páginas van en texto plano (ver `pagina()`), no
 * hay `<html lang>` donde ponerlo y viaja en la cabecera
 * `content-language`. Está en `docs/OAUTH-CONEXION.md`.
 *
 * QUÉ PASA AQUÍ
 * Clover abre esta URL cuando el merchant instala la app desde el App
 * Market o pulsa su icono. Trae `merchant_id`, `employee_id` y
 * `client_id`. NO trae `code` ni `state`: no es el callback del OAuth, es
 * el sitio donde una app normal ARRANCARÍA su OAuth.
 *
 * POR QUÉ NO LO ARRANCA
 * Porque nuestro flujo lo inicia el OPERADOR, y el `connect_token` es lo
 * único que ata un callback a UNA sucursal. Un aterrizaje del App Market
 * no lo trae. Emparejar por `merchant_id` sería inventarse ese ancla, y
 * el coste de equivocarse no es simétrico:
 *
 *   una página informativa   confunde a alguien un momento;
 *   un emparejamiento malo   mete los tokens de un comercio en la fila de
 *                            otro, y los pedidos de un restaurante se
 *                            imprimen en la cocina de otro.
 *
 * Además hoy no habría con qué emparejar: `apps/admin` no existe, así que
 * no hay dónde emitir códigos de invitación.
 *
 * ESTO ES UN PASO INTERMEDIO, NO LA SOLUCIÓN
 * Cuando exista `apps/admin` y lleguen merchants por el App Market, esta
 * página pasa a ser un FORMULARIO que pide un código emitido por el
 * operador. Está escrito en `docs/OAUTH-CONEXION.md` para que nadie lo
 * tome por definitivo.
 *
 * NO TOCA LA BASE, y es una propiedad que conviene conservar: es la
 * primera pantalla que ve un merchant nuevo, así que no puede depender de
 * que el pooler responda. Tampoco consulta el `merchant_id`, ni siquiera
 * para decir "ya estás conectado": eso le contaría a cualquiera que
 * probara mIds cuáles están dados de alta.
 */
function aterrizajeAppMarket(url: URL): Response {
  // Se apunta el mId y NO el `employee_id`: el primero le sirve al
  // operador para saber a quién mandarle el enlace; el segundo identifica
  // a una persona y no responde a ninguna pregunta que tengamos.
  log.info('app_market_aterrizaje', {
    merchant: url.searchParams.get('merchant_id'),
  });

  return pagina(
    200,
    'One step left to connect your store',
    [
      'The app is installed on your Clover account. Connecting your store takes ' +
        'one more step, and it does not happen on this page.',
      'Open the link your provider sent you, in this same browser. Clover will ask ' +
        'you to authorize the connection, and that is it.',
      'No link? Ask whoever set up the app for you. Each link works for a single ' +
        'store, which is why one cannot be issued from this page.',
    ],
    'en',
  );
}

/**
 * La ruta dentro de esta función.
 *
 * Se tolera que el nombre de la función y el prefijo `functions/v1` vengan
 * o no en el `pathname`: cambia entre el runtime local de `supabase start`
 * y el desplegado, y una ruta que solo funciona en uno de los dos se
 * descubre en el peor momento.
 */
function rutaRelativa(pathname: string): string {
  let p = pathname;
  if (p.startsWith(FUNCTIONS_PREFIX)) p = p.slice(FUNCTIONS_PREFIX.length);
  if (p.startsWith(`/${FUNCTION_NAME}`)) p = p.slice(FUNCTION_NAME.length + 1);
  return p === '' ? '/' : p.replace(/\/$/, '');
}

function responder(salida: FlowOutcome): Response {
  switch (salida.kind) {
    case 'redirect':
      return new Response(null, {
        status: 302,
        headers: { location: salida.url, 'cache-control': 'no-store' },
      });
    case 'ok':
      return pagina(200, salida.titulo, salida.detalle);
    case 'rechazo':
      return pagina(salida.status, salida.titulo, salida.detalle);
  }
}

/**
 * La página que ve el merchant.
 *
 * VA EN TEXTO PLANO, Y NO ES UNA ELECCIÓN DE ESTILO
 * Supabase NO SIRVE HTML desde una Edge Function en el dominio por
 * defecto: *"Serving of HTML content is only supported with custom
 * domains (Otherwise GET requests that return text/html will be rewritten
 * to text/plain)"*. No es un aviso, es una reescritura silenciosa. Lo que
 * pasa si se manda HTML:
 *
 *   content-type: text/html; charset=utf-8   <- lo que mandamos
 *   content-type: text/plain                 <- lo que llega
 *   + content-security-policy: default-src 'none'; sandbox
 *
 * Y de ahí salen DOS destrozos, que parecen dos fallos y son uno:
 *
 *   1. el navegador enseña el CÓDIGO FUENTE en vez de la página;
 *   2. al degradar el tipo se cae el `charset`, el navegador deja de
 *      asumir UTF-8 y "envió" se lee "enviÃ³".
 *
 * Comprobado en producción el 2026-09-06 contra el proyecto de Viva, en
 * los dos hostnames (`<ref>.supabase.co/functions/v1` y
 * `<ref>.functions.supabase.co`): idéntico en los dos.
 *
 * LO QUE SÍ PASA INTACTO es `text/plain; charset=utf-8` — con su charset,
 * sin CSP añadida. Es lo que lleva sirviendo `/redirect-uri` desde el
 * principio, y por eso a ese nunca le pasó nada. Así que las páginas se
 * sirven en texto plano: austero, pero legible y sin acentos rotos.
 *
 * CÓMO SE RECUPERA EL HTML
 * Con un dominio propio (plan Pro + add-on de Custom Domain). Ese día
 * esto vuelve a ser HTML, y hay que acordarse de que cambiar el dominio
 * cambia el `redirect_uri`: HAY QUE VOLVER AL DASHBOARD DE CLOVER. El
 * detalle está en `docs/OAUTH-CONEXION.md`.
 *
 * NO SE ESCAPA NADA, y es correcto: en texto plano un `&` es un `&`, y
 * escaparlo enseñaría `&amp;`. Tampoco hay superficie que proteger — los
 * títulos y los cuerpos son literales del código, nunca entrada de nadie.
 * Si algún día vuelve el HTML, vuelve el escapado con él.
 */
function pagina(
  status: number,
  titulo: string,
  detalle: string | readonly string[],
  // Ya no hay `<html lang>` que rellenar, así que el idioma viaja en la
  // cabecera `content-language`. La decisión de qué página va en qué
  // idioma no cambia: está en `aterrizajeAppMarket`.
  lang: 'es' | 'en' = 'es',
): Response {
  const cuerpos = typeof detalle === 'string' ? [detalle] : detalle;

  // Sin cortar líneas a mano: el navegador ya ajusta el texto plano al
  // ancho que haya. Un corte fijo se ve bien en un monitor y deja el
  // texto dentado en un teléfono, que es donde peor viene.
  const cuerpo = `${titulo}\n\n${cuerpos.join('\n\n')}\n`;

  return new Response(cuerpo, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-language': lang,
      // La URL lleva el `code` y el `state` en la query: que no se cachee
      // ni en el navegador ni en ningún intermedio.
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  });
}

function requerida(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (valor === undefined || valor === '') {
    throw new Error(
      `Falta la variable de entorno ${nombre}. Un flujo de OAuth a medio configurar ` +
        'no falla al desplegar, falla cuando un merchant real está conectando.',
    );
  }
  return valor;
}
