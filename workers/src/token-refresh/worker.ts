/**
 * El worker de refresco proactivo de tokens de Clover.
 *
 * QUÉ RESUELVE
 * El access token dura 30 minutos y el refresh token es de UN SOLO USO.
 * Sin nadie que rote, cada sucursal se cae cada media hora. Rotando mal,
 * se cae para siempre: dos refrescos a la vez, o un par nuevo perdido
 * entre que Clover lo emite y nosotros lo guardamos, dejan la conexión sin
 * ningún token válido, y volver de ahí exige que el dueño del restaurante
 * entre a su Clover a autorizar la app otra vez.
 *
 * LAS CUATRO COSAS QUE HACE, EN ORDEN DE IMPORTANCIA
 *
 *   1. REFRESCA CON MARGEN, no en el último momento. `policy.ts`.
 *   2. NO SOBRESCRIBE NUNCA EL SECRETO DEL REFRESH VIGENTE. El token nuevo
 *      va a un secreto NUEVO de Vault, y la fila se repunta con un solo
 *      `update`. Si el proceso se corta a mitad, el token anterior sigue
 *      entero en Vault y sigue siendo la red — que es justo lo que hace
 *      falta cuando algo se corta a mitad.
 *   3. ANTE UN 401, INTENTA RECUPERAR. Siempre. Nuestra fecha estimada de
 *      ventana no vale para decidir que no; la autoridad es Clover.
 *   4. UNA CONEXIÓN, UNA ROTACIÓN A LA VEZ. El arriendo de la 0013.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CON QUÉ TOKEN SE RECUPERA: LO MENOS OBVIO DE TODO EL WORKER
 * ─────────────────────────────────────────────────────────────────────
 *
 * `/oauth/v2/recovery` quiere "el refresh token ANTERIOR". Lo natural es
 * pensar que ese es el que tenemos guardado en `recovery_token_secret_id`,
 * y en el caso de la documentación lo es. Pero mira el accidente para el
 * que existe toda esta red:
 *
 *   la fila dice   vigente = A,  recuperación = Z
 *   mandamos A a /refresh, Clover emite B y mata a Z
 *   nos caemos ANTES de guardar B
 *   la fila sigue diciendo   vigente = A,  recuperación = Z
 *
 * En ese momento, para Clover el par actual es B y su token de
 * recuperación es A — o sea, LO QUE NOSOTROS TENEMOS APUNTADO COMO
 * VIGENTE. Y Z, que es lo que tenemos apuntado como de recuperación, está
 * muerto: lo mató el refresco que sí funcionó.
 *
 * Un worker que en el 401 mandase solo `recovery_token_secret_id` fallaría
 * en el único escenario para el que se construyó la red. Por eso se
 * prueban los dos, y el vigente primero:
 *
 *   1. el VIGENTE. Cubre el accidente de arriba, que es el frecuente.
 *   2. el APUNTADO como de recuperación. Cubre el otro: que el par nuevo
 *      se guardara bien y sea el secreto del vigente lo que se perdió o no
 *      se puede leer.
 *
 * Mandar un token que no toca no rompe nada: Clover contesta 401 y ya. No
 * intentarlo sí rompe: deja muerta una conexión que tenía salvación.
 *
 * Y cuando la recuperación funciona, el token de recuperación pasa a ser
 * EL QUE SE MANDÓ (`chain.ts`), que con esta regla sale bien tanto en el
 * caso de la documentación como en el de arriba.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LO QUE ESTE WORKER NO HACE
 * ─────────────────────────────────────────────────────────────────────
 *
 * No reintenta la misma petición. Ni el refresco ni la recuperación se
 * reintentan (el cliente no reintenta un POST sin clave de idempotencia,
 * y es a propósito): si Clover emitió el par y perdimos la respuesta, un
 * segundo intento con el mismo token mataría el par recién creado. Se
 * vuelve a empezar en la siguiente vuelta, y ahí la red ya está puesta.
 *
 * No borra el secreto del token de recuperación al rotar. Ver `chain.ts`.
 *
 * No decide nada por la fecha de la ventana. Ver `docs/REFRESCO-TOKENS.md`.
 */

import { chainViolation, planChain, type ChainInput, type TokenPath } from './chain.ts';
import {
  CLAIM_CHUNK,
  FAILURES_BEFORE_DEGRADED,
  LEASE_MS,
  MAX_BATCH,
  PER_CONNECTION_BUDGET_MS,
  accessTokenExpiryFrom,
  failureBackoffMs,
  recoveryWindowLooksClosed,
  refreshDueBefore,
  refreshTokenExpiryFrom,
} from './policy.ts';
import {
  SILENT_LOG,
  asCloverError,
  type ClaimedConnection,
  type CloverTokenApi,
  type ConnectionStore,
  type ManagedStatus,
  type TokenVault,
  type WorkerLog,
} from './ports.ts';
import type { CloverTokenPair } from '@juicebar/clover-client';

export interface TokenRefreshDeps {
  readonly store: ConnectionStore;
  readonly vault: TokenVault;
  /** Un cliente por entorno: sandbox y producción no comparten hosts. */
  readonly cloverFor: (environment: string) => CloverTokenApi;
  readonly now: () => Date;
  readonly log?: WorkerLog;
}

export interface TokenRefreshOptions {
  readonly limit?: number;
  readonly leaseMs?: number;
}

export interface TokenRefreshSummary {
  readonly claimed: number;
  /** Rotadas por el camino normal. */
  readonly refreshed: number;
  /** Rescatadas con el token de recuperación. Si esto no es 0, mirar los logs. */
  readonly recovered: number;
  readonly degraded: number;
  readonly failed: number;
}

/**
 * Un error nuestro, no de la base: el plan de escritura habría roto la
 * cadena de recuperación.
 *
 * Antes había un trigger detrás (la 0012) que paraba la única forma de
 * romperla que existía entonces. La 0016 lo quitó, porque la regla que
 * imponía resultó ser falsa. Así que esto ya no es un aviso temprano de
 * algo que la base pararía igual: ES LA ÚNICA COMPROBACIÓN. Si sale, es
 * un fallo de `chain.ts`, no un problema de la conexión.
 */
export class RecoveryChainError extends Error {
  override readonly name = 'RecoveryChainError';
}

type Outcome = 'refrescada' | 'recuperada' | 'degradada' | 'fallo';

/**
 * Una vuelta del worker. La dispara pg_cron cada `WORKER_PERIOD_MS`.
 *
 * Secuencial a propósito: el techo de 50 req/s es de la app y lo comparten
 * los merchants con el tráfico que está cobrando. Un lote en paralelo se
 * come esa cuota en ráfaga para adelantar un trabajo que no tiene ninguna
 * prisa —para eso está el margen—.
 */
export async function runTokenRefresh(
  deps: TokenRefreshDeps,
  options: TokenRefreshOptions = {},
): Promise<TokenRefreshSummary> {
  const log = deps.log ?? SILENT_LOG;
  const limite = options.limit ?? MAX_BATCH;
  const leaseMs = options.leaseMs ?? LEASE_MS;

  let claimed = 0;
  let refreshed = 0;
  let recovered = 0;
  let degraded = 0;
  let failed = 0;
  let cortado = false;

  while (claimed < limite && !cortado) {
    const inicio = deps.now();
    const lote = await deps.store.claimDue({
      dueBefore: refreshDueBefore(inicio),
      leaseSeconds: Math.round(leaseMs / 1000),
      limit: Math.min(CLAIM_CHUNK, limite - claimed),
    });
    if (lote.length === 0) break;

    // El arriendo empezó a contar en la base, con el reloj de la base. Se
    // toma el nuestro como referencia porque es el que tenemos, y por eso
    // el margen de `PER_CONNECTION_BUDGET_MS` es generoso: cubre la deriva
    // entre los dos relojes además del trabajo.
    const finArriendo = inicio.getTime() + leaseMs;

    for (const [indice, conn] of lote.entries()) {
      if (deps.now().getTime() + PER_CONNECTION_BUDGET_MS > finArriendo) {
        // Queda menos arriendo del que puede tardar esta conexión.
        // Pararse es lo único seguro: pasado el arriendo, otra ejecución
        // puede coger esta misma fila, y dos canjes del mismo refresh
        // token dejan la conexión muerta. Las que quedan se cogerán en la
        // siguiente vuelta, cuando su arriendo caduque.
        log.warn('lote_cortado_por_arriendo', { sin_procesar: lote.length - indice });
        cortado = true;
        break;
      }

      claimed += 1;
      let resultado: Outcome;
      try {
        resultado = await rotarConexion(deps, log, conn);
      } catch (err) {
        // Aquí solo llega lo que no se pudo ni registrar como fallo (la
        // propia escritura falló). No se toca nada más: el arriendo hace
        // de espera y la siguiente vuelta lo reintenta entero.
        log.error('rotacion_no_persistida', {
          conexion: conn.id,
          store: conn.storeId,
          error: mensajeSeguro(err),
        });
        resultado = 'fallo';
      }

      if (resultado === 'refrescada') refreshed += 1;
      else if (resultado === 'recuperada') recovered += 1;
      else if (resultado === 'degradada') degraded += 1;
      else failed += 1;
    }
  }

  const resumen = { claimed, refreshed, recovered, degraded, failed };
  log.info('vuelta_terminada', resumen);
  return resumen;
}

async function rotarConexion(
  deps: TokenRefreshDeps,
  log: WorkerLog,
  conn: ClaimedConnection,
): Promise<Outcome> {
  const api = deps.cloverFor(conn.environment);
  const traza = { conexion: conn.id, store: conn.storeId };

  // ── 1. El refresh que la fila da por vigente ───────────────────────
  let vigente: string | null = null;
  try {
    vigente = await deps.vault.read(conn.refreshTokenSecretId);
  } catch (err) {
    // No se aborta. Que el secreto del vigente no se pueda leer es uno de
    // los dos escenarios para los que existe la red; se va derecho a la
    // recuperación con el token apuntado.
    log.error('vault_vigente_ilegible', {
      ...traza,
      secreto: conn.refreshTokenSecretId,
      error: mensajeSeguro(err),
    });
  }

  // Lo último que Clover ha dicho sobre si queda red. `undefined` = no lo
  // ha dicho, que NO es lo mismo que decir que no.
  let cabecera: boolean | undefined;

  // ── 2. El camino normal ────────────────────────────────────────────
  //
  // El `try` envuelve la llamada y NADA MÁS. Meter dentro la escritura
  // haría que un fallo al guardar se leyese como un fallo del token —y un
  // 401 y una base caída piden cosas opuestas: uno recuperar, la otra
  // volver a intentarlo entero sin tocar los punteros—.
  if (vigente !== null) {
    let par: CloverTokenPair | null = null;
    try {
      par = await api.refresh({ refreshToken: vigente });
    } catch (err) {
      const clover = asCloverError(err);
      if (clover === null || clover.status !== 401) {
        // Un 500, un timeout, el breaker abierto: no dicen nada del
        // token. Se reintenta la vuelta entera con backoff, nunca la
        // misma petición.
        return await fallar(deps, log, conn, err, { porAuth: false, limpiar: false });
      }
      cabecera = clover.recoveryAvailable;
      // El detalle va AQUÍ y no solo en `last_error`, porque este 401 no
      // termina en `fallar` con este error: sigue a la recuperación y lo
      // que acaba en la columna es un mensaje sintético. Sin esta línea,
      // el cuerpo que mandó Clover se pierde en memoria.
      log.warn('refresco_401', {
        ...traza,
        recoveryAvailable: cabecera ?? 'ausente',
        requestId: clover.requestId ?? 'ausente',
        cuerpo: clover.body ?? 'ausente',
      });
    }
    if (par !== null) {
      return await persistir(deps, log, conn, 'refresh', conn.refreshTokenSecretId, par);
    }
  }

  // ── 3. La red ──────────────────────────────────────────────────────
  //
  // Se intenta SIEMPRE, incluso si nuestra fecha dice que la ventana ya
  // se cerró: esa fecha la calculamos nosotros y Clover no la confirma.
  // Intentarlo de más cuesta una llamada; no intentarlo cuesta la tienda.
  if (recoveryWindowLooksClosed(conn.recoveryTokenExpiresAt, deps.now())) {
    log.warn('ventana_vencida_segun_nosotros', {
      ...traza,
      // Sale como aviso, no como decisión: se intenta igual.
      recoveryAvailable: cabecera ?? 'ausente',
    });
  }

  const candidatos: Array<{ readonly secretId: string; readonly token: string | null }> = [];
  // El vigente primero: ver la cabecera del módulo. En el accidente que
  // esta red cubre, el token de recuperación de Clover es el que nosotros
  // tenemos apuntado como vigente.
  if (vigente !== null) candidatos.push({ secretId: conn.refreshTokenSecretId, token: vigente });
  if (
    conn.recoveryTokenSecretId !== null &&
    conn.recoveryTokenSecretId !== conn.refreshTokenSecretId
  ) {
    candidatos.push({ secretId: conn.recoveryTokenSecretId, token: null });
  }

  for (const candidato of candidatos) {
    let token = candidato.token;
    if (token === null) {
      try {
        token = await deps.vault.read(candidato.secretId);
      } catch (err) {
        log.error('vault_recuperacion_ilegible', {
          ...traza,
          secreto: candidato.secretId,
          error: mensajeSeguro(err),
        });
        continue;
      }
    }

    // Otra vez: el `try` solo envuelve la llamada.
    let par: CloverTokenPair | null = null;
    try {
      par = await api.recovery({ refreshToken: token });
    } catch (err) {
      const clover = asCloverError(err);
      if (clover === null || clover.status !== 401) {
        // Igual que arriba: un fallo sin respuesta no dice nada del
        // token, y probar el siguiente candidato sería gastar tokens por
        // un problema de red. Se corta y se reintenta la vuelta entera.
        return await fallar(deps, log, conn, err, { porAuth: false, limpiar: false });
      }
      // Lo más reciente que ha dicho Clover manda sobre lo anterior.
      if (clover.recoveryAvailable !== undefined) cabecera = clover.recoveryAvailable;
      // Este 401 no se registraba en ningún sitio, y es el que dice si la
      // red llegó a intentarse y con qué respuesta. Sin él, desde fuera
      // un `refresco_401` seguido de `conexion_degradada` no distingue
      // "se intentó recuperar y Clover dijo que no" de "ni se intentó".
      log.warn('recuperacion_401', {
        ...traza,
        con: candidato.secretId === conn.refreshTokenSecretId ? 'el vigente' : 'el apuntado',
        recoveryAvailable: clover.recoveryAvailable ?? 'ausente',
        requestId: clover.requestId ?? 'ausente',
        cuerpo: clover.body ?? 'ausente',
      });
    }
    if (par !== null) {
      log.warn('recuperacion_usada', {
        ...traza,
        con: candidato.secretId === conn.refreshTokenSecretId ? 'el vigente' : 'el apuntado',
      });
      return await persistir(deps, log, conn, 'recovery', candidato.secretId, par);
    }
  }

  // ── 4. No hay salvación automática ─────────────────────────────────
  //
  // Se limpian las columnas de recuperación SOLO si Clover ha dicho que
  // no queda red, con esas palabras. Que no venga la cabecera no es un
  // "no": borrar por su ausencia tiraría la red de una conexión sana el
  // día que Clover deje de mandarla en algún 401.
  const limpiar = cabecera === false;
  if (limpiar) {
    log.error('red_de_recuperacion_perdida', {
      ...traza,
      // Esto es lo que hay que enseñar en el SaaS: a partir de aquí la
      // única salida es que el merchant vuelva a autorizar la app.
      accion: 'rehacer el flujo OAuth con el merchant',
    });
  }
  return await fallar(
    deps,
    log,
    conn,
    new Error(
      'Ningún token sirvió: ni el refresco ni la recuperación. ' +
        (limpiar
          ? 'Clover confirma que no queda token de recuperación.'
          : 'Clover no confirma si queda token de recuperación.'),
    ),
    { porAuth: true, limpiar },
  );
}

/**
 * El momento delicado: Clover ya emitió el par y hay que guardarlo sin
 * perder la red por el camino.
 *
 * EL ORDEN NO ES DECORATIVO
 *   1. el refresh nuevo va a un secreto NUEVO. El del vigente no se toca:
 *      es el token de recuperación desde el instante en que se mandó.
 *   2. el access se sobrescribe en sitio, que no tiene red que conservar.
 *   3. UN solo `update` mueve todos los punteros a la vez. Que sea uno es
 *      lo que hace que no exista un instante en el que la fila apunte al
 *      refresh nuevo sin apuntar todavía al de recuperación.
 *   4. y solo entonces se borra lo que ha dejado de referenciarse.
 *
 * Si algo se rompe entre el 1 y el 3, la fila se queda como estaba: el
 * refresh anterior entero en Vault, que es exactamente el token con el
 * que la vuelta siguiente recupera. Se queda un secreto huérfano en
 * Vault, y ese es el precio: basura a cambio de que no haya un solo
 * instante en el que la conexión no tenga con qué volver.
 */
async function persistir(
  deps: TokenRefreshDeps,
  log: WorkerLog,
  conn: ClaimedConnection,
  path: TokenPath,
  sentSecretId: string,
  par: CloverTokenPair,
): Promise<Outcome> {
  const traza = { conexion: conn.id, store: conn.storeId };

  if (!par.refresh_token || !par.access_token) {
    // No se rota nada a medias: mover el puntero del refresh a un secreto
    // sin token es perder la conexión de forma definitiva. Se falla, y la
    // vuelta siguiente se encuentra el 401 con la red ya puesta.
    return await fallar(
      deps,
      log,
      conn,
      new Error('Clover devolvió un par incompleto (sin access_token o sin refresh_token)'),
      { porAuth: false, limpiar: false },
    );
  }

  const ahora = deps.now();

  // 1. NUNCA `update` sobre `conn.refreshTokenSecretId`.
  const nuevoRefreshId = await deps.vault.create(
    nombreSecreto(conn, 'refresh', ahora),
    par.refresh_token,
  );

  // 2. El access no es parte de ninguna cadena: se reutiliza su secreto.
  let accessId: string;
  if (conn.accessTokenSecretId !== null) {
    await deps.vault.update(conn.accessTokenSecretId, par.access_token);
    accessId = conn.accessTokenSecretId;
  } else {
    accessId = await deps.vault.create(nombreSecreto(conn, 'access', ahora), par.access_token);
  }

  const entrada: ChainInput = {
    path,
    before: {
      refreshTokenSecretId: conn.refreshTokenSecretId,
      recoveryTokenSecretId: conn.recoveryTokenSecretId,
      recoveryTokenExpiresAt: conn.recoveryTokenExpiresAt,
    },
    sentSecretId,
    newRefreshSecretId: nuevoRefreshId,
    now: ahora,
  };
  const plan = planChain(entrada);

  // Ya no hay trigger detrás. Se comprueba aquí para que el mensaje diga
  // qué regla se rompió y en qué camino, en vez de descubrirlo el día que
  // hace falta la red.
  const violacion = chainViolation(entrada, plan);
  if (violacion !== null) {
    throw new RecoveryChainError(
      `La rotación de la conexión ${conn.id} por el camino de ${path} habría roto la ` +
        `cadena de recuperación (${violacion}). El token de recuperación es SIEMPRE el ` +
        'que se acaba de mandar, y ese secreto no se borra: ver chain.ts.',
    );
  }

  // 3. Un solo update.
  await deps.store.applyRotation(conn.id, {
    accessTokenSecretId: accessId,
    accessTokenExpiresAt: accessTokenExpiryFrom(par.access_token_expiration, ahora),
    refreshTokenSecretId: nuevoRefreshId,
    refreshTokenExpiresAt: refreshTokenExpiryFrom(par.refresh_token_expiration),
    recovery: plan.recovery,
  });

  // 4. Y ahora sí, la basura.
  await borrarSecretos(deps, log, plan.obsoleteSecretIds, traza);

  log.info(path === 'refresh' ? 'refrescada' : 'recuperada', {
    ...traza,
    recuperacion: plan.recovery.kind,
  });
  return path === 'refresh' ? 'refrescada' : 'recuperada';
}

async function fallar(
  deps: TokenRefreshDeps,
  log: WorkerLog,
  conn: ClaimedConnection,
  err: unknown,
  opciones: { readonly porAuth: boolean; readonly limpiar: boolean },
): Promise<Outcome> {
  const fallos = conn.consecutiveFailures + 1;
  // Un 401 sin recuperación posible es definitivo: no hay token con el que
  // hablar con Clover y la sucursal no puede aceptar pedidos nuevos (§10).
  // Lo demás puede ser un mal rato de la red, y para eso está el contador.
  const status: ManagedStatus =
    opciones.porAuth || fallos >= FAILURES_BEFORE_DEGRADED ? 'degraded' : conn.status;

  await deps.store.markFailure(conn.id, {
    error: mensajeSeguro(err),
    status,
    leaseUntil: new Date(deps.now().getTime() + failureBackoffMs(fallos)),
    recovery: opciones.limpiar ? { kind: 'limpiar' } : { kind: 'sin-cambios' },
  });

  if (opciones.limpiar && conn.recoveryTokenSecretId !== null) {
    await borrarSecretos(deps, log, [conn.recoveryTokenSecretId], {
      conexion: conn.id,
      store: conn.storeId,
    });
  }

  const traza = {
    conexion: conn.id,
    store: conn.storeId,
    fallos,
    status,
    error: mensajeSeguro(err),
  };
  if (status === 'degraded') log.error('conexion_degradada', traza);
  else log.warn('refresco_fallido', traza);

  return status === 'degraded' ? 'degradada' : 'fallo';
}

/**
 * Borrar un secreto que ya no se referencia es higiene, no correctitud:
 * si falla, queda basura cifrada en Vault y nada más. Por eso nunca
 * propaga — al revés que borrar uno de más, que es la conexión muerta.
 */
async function borrarSecretos(
  deps: TokenRefreshDeps,
  log: WorkerLog,
  ids: readonly string[],
  traza: Readonly<Record<string, unknown>>,
): Promise<void> {
  for (const id of ids) {
    try {
      await deps.vault.destroy(id);
    } catch (err) {
      log.warn('secreto_huerfano', { ...traza, secreto: id, error: mensajeSeguro(err) });
    }
  }
}

/** Único e irrepetible: el arriendo garantiza que no hay dos a la vez. */
function nombreSecreto(conn: ClaimedConnection, tipo: string, ahora: Date): string {
  return `clover/${conn.storeId}/${tipo}/${ahora.getTime()}`;
}

/**
 * Los errores del cliente de Clover salen ya redactados de origen (§14 y
 * `errors.ts`). Esto recorta, que es lo que falta: `last_error` va a una
 * columna que se enseña en el SaaS.
 */
function mensajeSeguro(err: unknown, maxChars = 500): string {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}…` : texto;
}
