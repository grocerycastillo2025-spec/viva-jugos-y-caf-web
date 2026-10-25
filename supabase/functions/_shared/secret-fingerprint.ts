/**
 * La huella de un secreto: para comprobar CUÁL está leyendo el despliegue
 * sin llegar a enseñarlo nunca.
 *
 * EL PROBLEMA QUE RESUELVE
 * "Roté el App Secret y sigue fallando." A partir de ahí solo hay dos
 * mundos posibles —la función lee el valor viejo, o lee el nuevo y el
 * problema es otro— y sin una huella no se distinguen: hay que ir
 * probando. Con ella se contesta en un vistazo.
 *
 * Y sobre todo caza la familia de fallos que NO se ve mirando el valor,
 * porque a ojo son idénticos:
 *
 *   - un salto de línea final al pegar en la terminal;
 *   - un espacio al principio o al final;
 *   - las comillas metidas dentro del valor (`set X="abc"` en algunos
 *     shells guarda las comillas);
 *   - un pegado truncado.
 *
 * Los cuatro cambian la huella por completo.
 *
 * POR QUÉ UN HASH Y NO UNA LONGITUD NI UN PREFIJO
 * La regla de `WorkerLog` (§14 de la arquitectura) es explícita: de una
 * credencial no sale "ni el valor, ni un prefijo, ni una longitud". Un
 * hash truncado no es ninguna de las tres: no es un trozo del secreto, no
 * se puede volver atrás, y de un valor de alta entropía como un App
 * Secret no acota la búsqueda de forma útil.
 *
 * Y no hace falta la longitud: si el valor difiere aunque sea en un byte,
 * la huella ya difiere. La longitud no añadiría nada y sí rompería la
 * regla.
 *
 * CÓMO SE USA
 * En el log de arranque sale `secreto: "a1b2c3d4e5f6"`. Para comparar con
 * lo que se pegó, sin que el secreto salga del sitio donde ya está:
 *
 *     printf '%s' "$CLOVER_APP_SECRET" | sha256sum | cut -c1-12
 *
 * `printf` y no `echo`, precisamente porque `echo` añade el salto de
 * línea que estamos intentando cazar.
 *
 * Si las dos cadenas coinciden, el despliegue lee exactamente lo que se
 * pegó y el problema está en otro sitio. Si no, está aquí.
 */

/** Cuántos caracteres hex del sha256. 12 son 48 bits: de sobra para comparar. */
const CARACTERES = 12;

export async function secretFingerprint(valor: string): Promise<string> {
  const bytes = new TextEncoder().encode(valor);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, CARACTERES);
}
