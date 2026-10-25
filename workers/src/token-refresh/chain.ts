/**
 * La cadena de recuperación: qué se escribe después de rotar, y qué NO.
 *
 * Este módulo es puro y existe para un solo motivo: la regla correcta es
 * contraintuitiva, y escrita en prosa dentro de una función de 200 líneas
 * se pisa con una línea bien intencionada. Aquí está sola, con tipos que
 * no dejan expresar la versión equivocada, y con pruebas encima.
 *
 * ─────────────────────────────────────────────────────────────────────
 * SON DOS REGLAS, UNA POR RUTA. Y las implementa una sola línea.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Clover lo aclaró el 2026-09-16, y conviene leerlo como dos reglas y no
 * como una, porque son dos endpoints distintos:
 *
 *   /oauth/v2/refresh    el refresh que SE ACABA DE CONSUMIR pasa a ser
 *                        el token de recuperación del par nuevo
 *   /oauth/v2/recovery   el Token A original SIGUE siendo el token de
 *                        recuperación del par C, y la ventana de dos
 *                        semanas se reancla a la creación de C
 *
 * Textual: *"Persist the most recently consumed refresh token during
 * standard daily refreshes. Only retain Token A as the recovery token
 * when a recovery flow is specifically triggered."*
 *
 *   docs.clover.com/dev/docs/refresh-access-tokens#reauthenticate-with-a-recovery-token
 *   docs.clover.com/dev/docs/high-trust-app-auth-flow
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ UNA SOLA LÍNEA BASTA PARA LAS DOS
 * ─────────────────────────────────────────────────────────────────────
 *
 * `planChain` escribe `recuperación := el token que se MANDÓ`, sin
 * mirar la ruta. Eso satisface las dos reglas, y no por casualidad:
 *
 *   en /refresh   se manda el vigente, y una llamada que triunfa CONSUME
 *                 lo que mandó. "El que se mandó" y "el más recientemente
 *                 consumido" son el mismo token;
 *
 *   en /recovery  el endpoint SOLO acepta el Token A. Cualquier otro
 *                 candidato se lleva un 401 y no llega a escribirse nada
 *                 (ver el bucle de candidatos en `worker.ts`). Así que un
 *                 `/recovery` que triunfa demuestra que lo que se mandó
 *                 ERA A.
 *
 * Esa segunda es la que hay que tener presente antes de tocar nada aquí:
 * la línea única no es una simplificación que dé la casualidad de valer,
 * es que en la ruta de recuperación **no existe** un token distinto de A
 * que pueda llegar hasta este punto.
 *
 * Y por eso "el de recuperación es el refresh que acabo de SUSTITUIR" es
 * falso, aunque suene igual: al recuperar, lo que se sustituye es B —el
 * par que se perdió— y B está muerto. Escribir eso deja la conexión
 * apuntando a un token muerto justo después del susto en el que se usó la
 * red.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LA VENTANA SE REANCLA AL PAR NUEVO, POR LAS DOS RUTAS
 * ─────────────────────────────────────────────────────────────────────
 *
 *   /refresh    recuperación := el consumido,  ventana := ahora + 2 sem
 *   /recovery   recuperación := A (sin mover), ventana := ahora + 2 sem
 *
 * La ventana cuelga de CUÁNDO SE GENERÓ EL PAR ACTUAL, no de cuándo nació
 * el token de recuperación. Emitir un par la reancla, venga del endpoint
 * que venga; en `/recovery` lo dice la aclaración con esas palabras.
 *
 * ESTO ANTES ERA AL REVÉS, Y CONVIENE SABER POR QUÉ CAMBIÓ. Hasta la
 * 0016 el código tomaba la lectura pesimista —la ventana no se movía al
 * recuperar— porque la documentación pública admite las dos lecturas y no
 * había forma de medirlo sin perder un refresh y esperar dos semanas. La
 * 0012 llegó a imponer esa lectura con un trigger, y dejó escrito que si
 * algún día se confirmaba lo contrario se quitaba con un `drop trigger`.
 * La 0016 lo quitó.
 *
 * La consecuencia práctica es la que importa: una conexión que vive de
 * recuperaciones encadenadas ya no arrastra una fecha cada vez más vieja
 * hasta que el operador la ve vencida y llama al restaurante sin motivo.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LA CONTRADICCIÓN QUE HUBO AQUÍ: RESUELTA EL 2026-09-16
 * ─────────────────────────────────────────────────────────────────────
 *
 * Durante unos días este comentario decía que Clover se había
 * contradicho. No se había contradicho: las dos respuestas hablaban de
 * RUTAS DISTINTAS, y leerlas como una sola regla fue el error.
 *
 *   lo que se leyó como respuesta 1   era la regla de /recovery
 *   lo que se leyó como respuesta 2   era la regla de /refresh
 *
 * Y donde se creyó ver el conflicto —encadenar recuperaciones— las dos
 * decían lo mismo, porque allí siempre se manda A.
 *
 * No hizo falta cambiar `planChain`: ya se comportaba así en las dos
 * rutas. Lo que cambió es que ahora hay una prueba por ruta que lo dice
 * con las palabras de la aclaración, en vez de una sola que las mezclaba.
 *
 * ─────────────────────────────────────────────────────────────────────
 * QUÉ SECRETO SE BORRA DE VAULT
 * ─────────────────────────────────────────────────────────────────────
 *
 * El reflejo al rotar es limpiar el secreto anterior, y hacerlo aquí
 * destruye la red en el mismo instante en que se crea. En vez de una
 * lista de casos, se calcula: obsoleto = lo que la fila referenciaba
 * ANTES menos lo que referencia DESPUÉS. Con esa resta sale solo que en
 * un refresco A→B se borra el de recuperación viejo y NO se borra A, y
 * que en una recuperación A→C se borra B y NO se borra A.
 *
 * Fuentes: docs/CLOVER-ENDPOINTS.md, supabase/migrations/0012_recovery_token.sql
 * y supabase/migrations/0016_recovery_window_reanclada.sql
 */

import { RECOVERY_WINDOW_MS } from './policy.ts';

/** Por qué endpoint vino el par nuevo. */
export type TokenPath = 'refresh' | 'recovery';

/** Lo que la fila tiene guardado ANTES de la rotación. */
export interface ChainState {
  /** Id en Vault del refresh que la fila daba por vigente. */
  readonly refreshTokenSecretId: string;
  readonly recoveryTokenSecretId: string | null;
  readonly recoveryTokenExpiresAt: Date | null;
}

/**
 * Qué se hace con el par de columnas de recuperación.
 *
 * Son tres casos y no dos valores sueltos a propósito: el id y la fecha
 * van SIEMPRE juntos (la 0012 tiene un `check` que exige que o estén las
 * dos o ninguna), así que un tipo que permita mover una sin la otra es un
 * tipo que permite escribir una fila que la base rechaza.
 */
export type RecoveryWrite =
  /**
   * Ni se mencionan en el `update`. Una rotación con éxito nunca sale
   * así —siempre hay par nuevo, y todo par nuevo reancla la ventana—;
   * es lo que escribe `markFailure` cuando no hay nada que cambiar.
   */
  | { readonly kind: 'sin-cambios' }
  /** Las dos, juntas. */
  | { readonly kind: 'apuntar'; readonly secretId: string; readonly expiresAt: Date }
  /** Las dos a null: no hay red. Solo desde `worker.ts`, y solo si Clover lo dice. */
  | { readonly kind: 'limpiar' };

export interface ChainPlan {
  readonly path: TokenPath;
  readonly recovery: RecoveryWrite;
  /**
   * Secretos que la fila deja de referenciar. Se borran DESPUÉS de que la
   * fila esté escrita, y que fallen no rompe nada: un secreto huérfano es
   * basura; un secreto borrado de más es la conexión muerta.
   */
  readonly obsoleteSecretIds: readonly string[];
}

export interface ChainInput {
  readonly path: TokenPath;
  readonly before: ChainState;
  /**
   * Id en Vault del token que SE MANDÓ a Clover. No el que se recibió, no
   * el que estaba guardado: el que se mandó. Es toda la regla.
   */
  readonly sentSecretId: string;
  /** Id del secreto RECIÉN CREADO con el refresh nuevo. Nunca uno reutilizado. */
  readonly newRefreshSecretId: string;
  readonly now: Date;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║ SEGURO TEMPORAL — sigue puesto, y el motivo CAMBIÓ el 2026-09-16  ║
 * ║ Poner esto a `false` es todo lo que hace falta para revertirlo.   ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 *
 * Mientras esté en `true`, el token de recuperación DESPLAZADO no se
 * borra de Vault: se queda huérfano en vez de destruirse.
 *
 * ─────────────────────────────────────────────────────────────────────
 * OJO AL QUITARLO: EL CRITERIO YA NO ES "QUE CONTESTE CLOVER"
 * ─────────────────────────────────────────────────────────────────────
 *
 * Se puso el 2026-09-12 porque parecía que Clover se había contradicho y
 * no se sabía si borrar era correcto. **Eso ya está resuelto**: la
 * aclaración del 2026-09-16 (arriba) confirma que el borrado ES correcto.
 *
 * Y sin embargo el seguro se queda. La razón es otra, y es deliberada:
 * `/oauth/v2/recovery` **no se ha ejercido nunca de verdad**. Todo lo que
 * sabemos de esa ruta viene de leer documentación y de pruebas con un
 * Clover de mentira. El día que se ejecute contra el sandbox y se vea la
 * cadena completa funcionando, se decide con datos.
 *
 * QUIEN VENGA A QUITARLO: no basta con «Clover ya contestó». Hace falta
 * haber recorrido una recuperación real. Si se quita solo por la
 * aclaración, se estará retirando una red por un motivo que nunca fue el
 * que la sostenía desde el 16.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESPERAR SALE BARATO
 * ─────────────────────────────────────────────────────────────────────
 *
 * De las dos formas de equivocarse, una es barata y la otra no:
 *
 *   no borramos y el borrado era correcto  -> quedan secretos huérfanos
 *                                             en Vault. Feo, inofensivo,
 *                                             y se limpia con un barrido;
 *   borramos y no lo era                   -> hay que reconectar merchant
 *                                             por merchant, a mano.
 *
 * Y lo que decide: con el worker rotando cada cinco minutos, «las
 * conexiones que ya perdieron su token» son TODAS a las pocas horas. Hoy,
 * con un merchant de prueba, da igual. Con veinte clientes en producción
 * no, y esto se despliega antes que ellos.
 *
 * QUÉ **NO** CUBRE, Y A PROPÓSITO. El borrado de `worker.ts` cuando
 * Clover contesta `X-Clover-Recovery-Available: false` sigue en pie: ahí
 * Clover ha dicho con esas palabras que ese token ya no sirve, y eso no
 * depende de nada de lo anterior. Conservarlo sería guardar un token que
 * su propio emisor ha repudiado.
 *
 * ─────────────────────────────────────────────────────────────────────
 * AL RESTAURAR EL BORRADO HARÁ FALTA UN BARRIDO DE HUÉRFANOS
 * ─────────────────────────────────────────────────────────────────────
 *
 * Poner esto a `false` corta la hemorragia hacia adelante y NO limpia lo
 * ya acumulado: cada rotación que haya ocurrido mientras tanto dejó un
 * secreto en Vault que ninguna fila referencia. Son ~1 por conexión y por
 * rotación, o sea ~288 al día por sucursal con el periodo de 5 minutos.
 *
 * El barrido es el de siempre —borrar los secretos `clover/<store>/…` que
 * no aparezcan en ninguna de las tres columnas de `clover_connections`—
 * y la consulta está en docs/REFRESCO-TOKENS.md, "Barrer los secretos
 * huérfanos de Vault". NO se puede automatizar a la ligera: un barrido
 * que se equivoque borra tokens vivos, que es justo lo que este seguro
 * existe para evitar.
 */
export const CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO = true;

export function planChain(input: ChainInput): ChainPlan {
  const { path, before, sentSecretId, newRefreshSecretId, now } = input;

  // Una sola línea para los dos caminos, y es toda la regla: el token de
  // recuperación es el que se mandó, y la ventana cuelga del par que
  // acaba de nacer. Que no haya un `if` por camino no es economía de
  // líneas: es que no hay dos reglas.
  const recovery: RecoveryWrite = {
    kind: 'apuntar',
    secretId: sentSecretId,
    expiresAt: new Date(now.getTime() + RECOVERY_WINDOW_MS),
  };

  return {
    path,
    recovery,
    obsoleteSecretIds: secretosObsoletos(
      before,
      sentSecretId,
      newRefreshSecretId,
      CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO,
    ),
  };
}

/**
 * La resta: obsoleto = lo que la fila referenciaba ANTES menos lo que
 * referencia DESPUÉS.
 *
 * Sale suelta y con el seguro como PARÁMETRO —en vez de leer la constante
 * aquí dentro— para que las pruebas puedan fijar las dos conductas: la de
 * hoy y la que volverá cuando llegue la aclaración. Así el día que alguien
 * ponga la constante a `false` no está estrenando un camino sin probar.
 */
export function secretosObsoletos(
  before: ChainState,
  sentSecretId: string,
  newRefreshSecretId: string,
  conservarRecuperacionDesplazada: boolean,
): readonly string[] {
  const antes = new Set(
    [before.refreshTokenSecretId, before.recoveryTokenSecretId].filter(
      (id): id is string => id !== null,
    ),
  );
  const despues = new Set([newRefreshSecretId, sentSecretId]);

  // EL SEGURO. Meter el de recuperación anterior en `despues` es decir
  // "esto sigue referenciado", y con eso la resta ya no lo devuelve.
  //
  // Solo protege a ESE. El refresh del par que se perdió —B en una
  // recuperación A→C— se sigue borrando: las dos respuestas de Clover
  // coinciden en que B queda inválido, así que ahí no hay nada que
  // decidir y guardarlo sería basura sin contrapartida.
  if (conservarRecuperacionDesplazada && before.recoveryTokenSecretId !== null) {
    despues.add(before.recoveryTokenSecretId);
  }

  return [...antes].filter((id) => !despues.has(id));
}

/**
 * Las dos formas de romper la cadena escribiendo una fila que "parece"
 * bien. Ninguna de las dos da error en la base, y las dos se descubren el
 * día que hace falta la red — o sea, tarde.
 *
 * `recuperacion-apunta-al-par-nuevo` es el fallo de la familia de
 * `applyInitialTokens`: apuntar la recuperación al token RECIÉN EMITIDO.
 * Clover no lo acepta como token de recuperación de sí mismo, así que la
 * fila prometería una red que no existe.
 *
 * `se-borra-el-token-que-se-mando` es el otro: destruir en Vault el
 * secreto que en ese mismo instante ha pasado a ser la red.
 */
export type ChainViolation = 'recuperacion-apunta-al-par-nuevo' | 'se-borra-el-token-que-se-mando';

/**
 * Comprueba el plan antes de escribirlo. Ya no hay ningún trigger que
 * pare esto —la 0016 quitó el de la ventana—, así que este chequeo es lo
 * único que queda entre un plan mal calculado y la fila.
 */
export function chainViolation(input: ChainInput, plan: ChainPlan): ChainViolation | null {
  if (plan.recovery.kind === 'apuntar' && plan.recovery.secretId === input.newRefreshSecretId) {
    return 'recuperacion-apunta-al-par-nuevo';
  }
  if (plan.obsoleteSecretIds.includes(input.sentSecretId)) {
    return 'se-borra-el-token-que-se-mando';
  }
  return null;
}
