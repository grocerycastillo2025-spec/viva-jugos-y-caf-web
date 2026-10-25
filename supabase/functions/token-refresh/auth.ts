/**
 * Quién puede disparar una vuelta del worker.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ LA AUTORIZACIÓN ES NUESTRA Y NO DEL GATEWAY
 * ─────────────────────────────────────────────────────────────────────
 *
 * Esta función se despliega con `verify_jwt = false`, igual que `oauth`,
 * pero por un motivo distinto y que conviene no confundir. En `oauth` es
 * un requisito: Clover redirige un NAVEGADOR y no puede mandar la
 * cabecera. Aquí quien llama es `pg_net` desde nuestra propia base, que
 * puede mandar lo que le digamos. La razón es otra:
 *
 *   la comprobación del gateway la pasa CUALQUIER clave del proyecto,
 *   y la clave anónima es pública — viaja dentro del APK.
 *
 * O sea que `verify_jwt = true` no autorizaría nada: dejaría entrar a
 * cualquiera que tenga la app instalada, y encima obligaría a guardar una
 * segunda credencial en la base para que el cron la mandase. Así que la
 * puerta la ponemos aquí, con un secreto que existe SOLO para esto:
 * `WORKER_CRON_SECRET`.
 *
 * QUÉ PASA SI ESE SECRETO SE FILTRA
 * Poco, y merece la pena decirlo porque explica por qué no hace falta más
 * que esto: quien lo tenga puede pedir vueltas del worker antes de tiempo.
 * No lee nada —la respuesta es un recuento— y no rota nada que no tocara:
 * el claim de la 0013 solo devuelve conexiones cuyo access token caduca
 * dentro del margen, así que una vuelta de más no encuentra trabajo. Lo
 * único que se gana disparando mil veces es carga, y para eso está el
 * arriendo. Comparado con mandar la clave `service_role` en cada tic —que
 * es la receta habitual— esto es un secreto de un solo uso y sin poder.
 */

/** Lo que devuelve la puerta. `motivo` va al log, NUNCA a la respuesta. */
export type CronAuth = { readonly ok: true } | { readonly ok: false; readonly motivo: string };

/**
 * Un secreto corto es un secreto adivinable, y este endpoint no tiene a
 * nadie que limite intentos. Se comprueba en el ARRANQUE, no en la
 * petición: un despliegue mal configurado tiene que caerse al desplegar,
 * no la primera noche que haga falta rotar.
 *
 * El mismo mínimo está en `app.configure_token_refresh_worker` (0015), y a
 * propósito: son los dos extremos del mismo cable y cada uno se defiende
 * solo.
 */
export const MIN_SECRET_CHARS = 32;

export class CronSecretError extends Error {
  override readonly name = 'CronSecretError';
}

export function assertCronSecret(valor: string): string {
  if (valor.trim().length < MIN_SECRET_CHARS) {
    throw new CronSecretError(
      `WORKER_CRON_SECRET tiene menos de ${MIN_SECRET_CHARS} caracteres. ` +
        'Genera uno con `openssl rand -base64 32` y ponlo en los dos sitios: ' +
        '`supabase secrets set` y `app.configure_token_refresh_worker`.',
    );
  }
  return valor.trim();
}

/**
 * `Authorization: Bearer <secreto>`.
 *
 * Se usa `Bearer` y no una cabecera propia porque es lo que ya sabe mandar
 * `net.http_post` sin ceremonia, y porque el día que esto se ponga detrás
 * de un gateway de verdad la forma ya es la correcta.
 */
export function authorizeCronRequest(authorization: string | null, esperado: string): CronAuth {
  if (authorization === null || authorization === '') {
    return { ok: false, motivo: 'sin cabecera Authorization' };
  }
  const [esquema, ...resto] = authorization.split(' ');
  if (esquema?.toLowerCase() !== 'bearer' || resto.length !== 1) {
    return { ok: false, motivo: 'la cabecera Authorization no es un Bearer' };
  }
  if (!iguales(resto[0] ?? '', esperado)) {
    return { ok: false, motivo: 'el secreto no coincide' };
  }
  return { ok: true };
}

/**
 * Comparación de tiempo constante.
 *
 * `a === b` sobre cadenas se corta en el primer byte distinto, y eso —con
 * suficientes intentos— dice cuántos caracteres del principio son
 * correctos. Aquí se recorren SIEMPRE los dos hasta el final del más
 * largo, y la diferencia se acumula en un entero.
 *
 * Lo que sí se filtra es la LONGITUD del secreto, que se acepta: quien
 * mide eso ya sabe que `openssl rand -base64 32` da 44 caracteres.
 */
function iguales(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const largo = Math.max(x.length, y.length);
  for (let i = 0; i < largo; i += 1) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}
