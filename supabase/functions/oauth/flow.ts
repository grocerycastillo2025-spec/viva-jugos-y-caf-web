/**
 * El flujo de conexión de un merchant, sin red y sin base.
 *
 * DOS PASOS Y UN SOLO SITIO DONDE SE DECIDE
 *
 *   start     el merchant abre el enlace que le mandó el operador y lo
 *             despachamos a Clover con nuestro `redirect_uri`;
 *   callback  Clover lo devuelve con un `code`, lo canjeamos por el primer
 *             par de tokens y la sucursal queda `connected`.
 *
 * QUIÉN AUTORIZA, Y POR QUÉ NO PUEDE SER OTRO
 * El merchant, con sus credenciales de Clover (§0.3 de la arquitectura). El
 * super admin no puede hacerlo por él: lo único que puede hacer es generar
 * el enlace y mirar cómo queda. De ahí que el `state` sea un token que
 * vive en la fila (`connect_token`) y no una cookie: entre que se genera el
 * enlace y se abre pasan horas, en otro navegador y en otra ciudad.
 *
 * EL `state` NO ES DECORACIÓN. Es lo que ata este callback a UNA sucursal.
 * Sin él, cualquiera que consiga un `code` de Clover podría hacer que
 * nuestro backend lo canjee y escriba tokens en la fila que no es. Por eso
 * es de un solo uso: al conectar se borra, y el mismo enlace ya no vuelve a
 * valer.
 */

import {
  type CloverAuthorizeUrlBuilder,
  type CloverExchangeApi,
  type CloverFor,
  type ConnectLog,
  type ConnectStore,
  type ConnectionRef,
  type TokenVault,
} from './ports.ts';

/**
 * Valor de reserva si el canje no trae `access_token_expiration`. Sí lo
 * trae: medido en sandbox el 2026-09-05, con ~24 h de vida real. Se queda
 * en los 30 minutos documentados a propósito — el razonamiento entero está
 * en `policy.ts` del worker y en docs/REFRESCO-TOKENS.md.
 */
export const ACCESS_TOKEN_TTL_MS = 30 * 60_000;

export interface StartDeps {
  readonly store: ConnectStore;
  readonly cloverFor: CloverFor<CloverAuthorizeUrlBuilder>;
  readonly appId: string;
  /** La cadena exacta registrada en el dashboard. Ver `redirect-uri.ts`. */
  readonly redirectUri: string;
  readonly log: ConnectLog;
}

export interface CallbackDeps {
  readonly store: ConnectStore;
  readonly vault: TokenVault;
  readonly cloverFor: CloverFor<CloverExchangeApi>;
  readonly log: ConnectLog;
}

/**
 * Lo que la ruta tiene que devolver. Deliberadamente sin `Response`: así
 * esto se prueba con asserts sobre datos y no leyendo cuerpos HTTP.
 */
export type FlowOutcome =
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'ok'; readonly titulo: string; readonly detalle: string }
  | {
      readonly kind: 'rechazo';
      readonly status: number;
      readonly titulo: string;
      readonly detalle: string;
    };

// ---------------------------------------------------------------------
// PASO 1 — el merchant abre el enlace
// ---------------------------------------------------------------------

export async function startConnect(
  deps: StartDeps,
  input: { readonly connectToken: string | null; readonly now: Date },
): Promise<FlowOutcome> {
  if (input.connectToken === null || input.connectToken === '') {
    return rechazo(400, 'Falta el enlace', 'Abre el enlace completo que te envió el restaurante.');
  }

  const conn = await deps.store.findByConnectToken(input.connectToken);
  if (conn === null) {
    // Mismo mensaje para "no existe" y para "ya se usó" a propósito: son
    // indistinguibles desde fuera y distinguirlos le diría a quien prueba
    // tokens al azar cuándo ha acertado uno.
    return rechazo(
      404,
      'Enlace no válido',
      'Este enlace ya se usó o no existe. Pídele uno nuevo al restaurante.',
    );
  }
  if (enlaceCaducado(conn, input.now)) {
    return rechazo(410, 'Enlace caducado', 'Pídele al restaurante un enlace nuevo.');
  }

  // El entorno sale de la conexión, no del despliegue: ver `CloverFor`.
  const url = deps.cloverFor(conn.environment).authorizeUrl({
    appId: deps.appId,
    redirectUri: deps.redirectUri,
    state: input.connectToken,
  });
  deps.log.info('oauth_start', { conexion: conn.id, sucursal: conn.storeId });
  return { kind: 'redirect', url };
}

// ---------------------------------------------------------------------
// PASO 2 — Clover devuelve al merchant
// ---------------------------------------------------------------------

export interface CallbackParams {
  readonly code: string | null;
  readonly merchantId: string | null;
  readonly state: string | null;
  /** Clover manda `error`/`error_description` cuando el merchant dice que no. */
  readonly error: string | null;
}

export async function completeCallback(
  deps: CallbackDeps,
  input: { readonly params: CallbackParams; readonly now: Date },
): Promise<FlowOutcome> {
  const { params } = input;

  // El merchant canceló. No es un fallo NUESTRO y no se apunta como tal:
  // marcar la conexión aquí llenaría `last_error` de ruido y podría
  // degradar una sucursal que estaba funcionando.
  if (params.error !== null && params.error !== '') {
    deps.log.info('oauth_denegado', { motivo: params.error });
    return rechazo(
      400,
      'No se autorizó la conexión',
      'Clover no concedió el permiso. Si fue sin querer, vuelve a abrir el enlace.',
    );
  }

  if (params.code === null || params.code === '') {
    return rechazo(400, 'Respuesta incompleta', 'Clover no devolvió el código de autorización.');
  }
  if (params.merchantId === null || params.merchantId === '') {
    // Sin `merchant_id` no sabemos a qué mId pertenece el par que estamos
    // a punto de guardar, y una conexión con tokens buenos apuntando al
    // merchant equivocado es peor que una sin tokens.
    return rechazo(400, 'Respuesta incompleta', 'Clover no devolvió el identificador del comercio.');
  }

  const resuelta = await resolverConexion(deps, params, input.now);
  if (resuelta.kind !== 'conexion') return resuelta;
  const conn = resuelta.conn;

  // EL MERCHANT TIENE QUE SER EL MISMO. Si esta sucursal ya estuvo
  // conectada a otro mId, el enlace se envió a quien no era: conectar
  // ahora repuntaría la sucursal al Clover de otro restaurante, y los
  // pedidos empezarían a imprimirse en la cocina equivocada.
  if (conn.merchantId !== null && conn.merchantId !== params.merchantId) {
    await deps.store.markFailure(
      conn.id,
      'El callback de OAuth llegó con un merchant distinto al que ya tenía esta sucursal.',
    );
    deps.log.error('oauth_merchant_distinto', { conexion: conn.id, sucursal: conn.storeId });
    return rechazo(
      409,
      'Comercio distinto',
      'Esta sucursal ya está asociada a otro comercio de Clover. Avisa al restaurante.',
    );
  }

  // EL CANJE NO SE REINTENTA. El `code` es de un solo uso: un segundo
  // intento con el mismo código falla siempre y, si el primero llegó a
  // emitir un par, deja ese par vivo y sin dueño. Lo mismo que hace el
  // cliente con el refresh (ver `endpoints/oauth.ts`).
  let par;
  try {
    par = await deps.cloverFor(conn.environment).exchangeCode({ code: params.code });
  } catch (err) {
    const mensaje = mensajeSeguro(err);
    await deps.store.markFailure(conn.id, mensaje);
    deps.log.error('oauth_canje_fallido', { conexion: conn.id, error: mensaje });
    return rechazo(
      502,
      'Clover rechazó la conexión',
      'No se pudo canjear el código. Vuelve a intentarlo con un enlace nuevo.',
    );
  }

  if (typeof par.access_token !== 'string' || par.access_token === '') {
    await deps.store.markFailure(conn.id, 'Clover devolvió un canje sin access_token.');
    return rechazo(502, 'Respuesta inesperada de Clover', 'El canje no trajo token de acceso.');
  }
  // SIN REFRESH NO SE GUARDA NADA. Una conexión con access token y sin
  // refresh funciona treinta minutos y luego muere sin que nadie lo vea
  // venir: el worker de refresco ni siquiera la reclama, porque su claim
  // exige `refresh_token_secret_id is not null` (0013). Mejor fallar aquí,
  // donde hay una persona delante del navegador que puede reintentar.
  if (typeof par.refresh_token !== 'string' || par.refresh_token === '') {
    await deps.store.markFailure(conn.id, 'Clover devolvió un canje sin refresh_token.');
    deps.log.error('oauth_sin_refresh', { conexion: conn.id, sucursal: conn.storeId });
    return rechazo(
      502,
      'Respuesta inesperada de Clover',
      'El canje no trajo token de refresco, así que la conexión no duraría ni media hora.',
    );
  }

  // ORDEN DE ESCRITURA: primero Vault, después la fila, y un solo update.
  // Al revés —fila primero— habría un instante con ids de secreto que
  // apuntan a nada, y ahí el worker de refresco leería un secreto
  // inexistente y degradaría una sucursal recién conectada.
  const accessId = await deps.vault.create(
    nombreSecreto(conn.storeId, 'access', input.now),
    par.access_token,
  );
  const refreshId = await deps.vault.create(
    nombreSecreto(conn.storeId, 'refresh', input.now),
    par.refresh_token,
  );

  try {
    await deps.store.applyInitialTokens(conn.id, {
      merchantId: params.merchantId,
      accessTokenSecretId: accessId,
      accessTokenExpiresAt: accessTokenExpiryFrom(par.access_token_expiration, input.now),
      refreshTokenSecretId: refreshId,
      refreshTokenExpiresAt: refreshTokenExpiryFrom(par.refresh_token_expiration),
    });
  } catch (err) {
    // LOS SECRETOS NO SE BORRAN AQUÍ, y es a propósito. Si el update falló
    // de verdad, quedan dos secretos huérfanos: basura, molesta y barata.
    // Si lo que falló fue solo la confirmación —el update sí entró—,
    // borrarlos deja la fila apuntando a secretos que ya no existen, o sea
    // la sucursal muerta el día que estrena. Se apuntan los ids y se
    // limpian a mano; el runbook está en docs/OAUTH-CONEXION.md.
    deps.log.error('oauth_secretos_huerfanos', {
      conexion: conn.id,
      secretos: [accessId, refreshId],
      error: mensajeSeguro(err),
    });
    throw err;
  }

  deps.log.info('oauth_conectada', { conexion: conn.id, sucursal: conn.storeId });
  return {
    kind: 'ok',
    titulo: 'Sucursal conectada',
    detalle: 'Ya puedes cerrar esta ventana.',
  };
}

// ---------------------------------------------------------------------

type Resuelta = { readonly kind: 'conexion'; readonly conn: ConnectionRef } | FlowOutcome;

/**
 * De qué conexión habla este callback.
 *
 * DOS CAMINOS, Y EL SEGUNDO NO ES UN LUJO. Con `state` es el flujo que
 * originamos nosotros. Sin `state` es una instalación desde el App Market
 * de Clover: ahí el merchant no pasó por nuestro enlace, así que no hay
 * nada que validar más que el mId — y el mId solo sirve si esa sucursal YA
 * estuvo conectada alguna vez. Si no, no hay forma de saber a qué
 * restaurante pertenece, y adivinarlo sería peor que pedir el enlace.
 */
async function resolverConexion(
  deps: CallbackDeps,
  params: CallbackParams,
  now: Date,
): Promise<Resuelta> {
  if (params.state !== null && params.state !== '') {
    const conn = await deps.store.findByConnectToken(params.state);
    if (conn === null) {
      return rechazo(
        404,
        'Enlace no válido',
        'Este enlace ya se usó o no existe. Pídele uno nuevo al restaurante.',
      );
    }
    if (enlaceCaducado(conn, now)) {
      return rechazo(410, 'Enlace caducado', 'Pídele al restaurante un enlace nuevo.');
    }
    return { kind: 'conexion', conn };
  }

  // El `environment` de la reinstalación no lo dice Clover: lo dice el
  // host que atendió el canje, que es el de la fila. Se busca en los dos
  // porque un mId es único dentro de su entorno, no entre entornos, y la
  // restricción de la 0002 es `(environment, merchant_id)`.
  if (params.merchantId !== null && params.merchantId !== '') {
    for (const entorno of ['production', 'sandbox'] as const) {
      const conn = await deps.store.findByMerchant(entorno, params.merchantId);
      if (conn !== null) {
        deps.log.info('oauth_reinstalacion', { conexion: conn.id, sucursal: conn.storeId });
        return { kind: 'conexion', conn };
      }
    }
  }

  return rechazo(
    400,
    'No sabemos de qué sucursal se trata',
    'Abre el enlace que te envió el restaurante en vez de entrar desde el App Market de Clover.',
  );
}

function enlaceCaducado(conn: ConnectionRef, now: Date): boolean {
  // `null` = sin caducidad apuntada. Se trata como caducado, que es el
  // lado barato de equivocarse: pedir otro enlace cuesta un correo.
  if (conn.connectTokenExpiresAt === null) return true;
  return conn.connectTokenExpiresAt.getTime() <= now.getTime();
}

/** Mismo formato que el worker, para que un incidente se lea de corrido. */
function nombreSecreto(storeId: string, tipo: string, ahora: Date): string {
  return `clover/${storeId}/${tipo}/${ahora.getTime()}`;
}

/**
 * Cuándo caduca el access token recién llegado.
 *
 * Copia deliberada de `policy.ts` del worker, y no un import: esta función
 * se despliega en Deno, dentro del bundle de la Edge Function, y arrastrar
 * el paquete de workers entero por dos fórmulas de cuatro líneas ataría el
 * despliegue del callback a una dependencia que no usa. Si la vida del
 * token cambia, cambia en los dos sitios; hay una prueba en cada uno.
 */
export function accessTokenExpiryFrom(unixSeconds: number | undefined, now: Date): Date {
  const porDefecto = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS);
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds)) return porDefecto;
  const fecha = new Date(unixSeconds * 1000);
  return fecha.getTime() > now.getTime() ? fecha : porDefecto;
}

/** El del refresh es informativo: si no viene, no se inventa. */
export function refreshTokenExpiryFrom(unixSeconds: number | undefined): Date | null {
  if (unixSeconds === undefined || !Number.isFinite(unixSeconds)) return null;
  return new Date(unixSeconds * 1000);
}

function rechazo(status: number, titulo: string, detalle: string): FlowOutcome {
  return { kind: 'rechazo', status, titulo, detalle };
}

/** `last_error` se enseña en el SaaS: se recorta y no lleva el `code`. */
function mensajeSeguro(err: unknown, maxChars = 500): string {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}…` : texto;
}
