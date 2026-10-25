/**
 * El orden de operaciones, como tipo y no como secuencia de llamadas.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO ES UN MÓDULO PURO Y NO UN `async function` CON CINCO AWAIT
 * ─────────────────────────────────────────────────────────────────────
 *
 * Porque el orden **no es negociable** y un `await` detrás de otro se
 * reordena sin querer. Aquí el orden es un dato:
 *
 *   1. tokenizar             (lo hace el cliente, no nosotros)
 *   2. checkouts             totales e impuestos REALES
 *   3. atomic_order/orders   la orden existe en el POS
 *   4. /pay                  se cobra LA ORDEN
 *   5. print_event           el ticket llega a cocina
 *
 * LA ORDEN SE CREA ANTES DE COBRAR. Al revés —cobrar y luego crear— deja
 * dinero cobrado sin pedido, que es el riesgo R10 y el peor estado
 * posible: la cocina no lo ve, el merchant no lo puede reembolsar desde
 * su POS, y el cliente tiene un cargo y ninguna comida.
 *
 * Este módulo no llama a nadie. Dado un estado, dice qué toca ahora; dado
 * un fallo, dice qué hay que deshacer. Se prueba entero sin red.
 *
 * Ver docs/PEDIDOS-COBRO.md y docs/AJUSTES-FLUJO-CLOVER.md, variable 3.
 */

/**
 * El estado del intento, tal como se persiste en `checkout_attempts`.
 *
 * Los cinco primeros son progreso; `voiding` y `failed` son el final
 * malo. La lista es la misma que el `check` de la 0018: si alguien añade
 * uno aquí sin añadirlo allí, la base rechaza la escritura.
 */
export const ESTADOS = [
  'started',
  'totals_ok',
  'order_created',
  'paid',
  'printed',
  'done',
  'voiding',
  'failed',
] as const;
export type Estado = (typeof ESTADOS)[number];

/** Lo que toca hacer ahora. `nada` = el intento ya terminó. */
export type Paso =
  | { readonly kind: 'totales' }
  | { readonly kind: 'crear-orden' }
  | { readonly kind: 'cobrar' }
  | { readonly kind: 'imprimir' }
  | { readonly kind: 'anular-orden' }
  | { readonly kind: 'nada'; readonly porque: 'terminado' | 'fallido' };

/**
 * De un estado, el paso siguiente. UNA SOLA TABLA, y es todo el orden.
 *
 * `voiding` devuelve `anular-orden` y no `nada`: un intento que murió
 * cobrando dejó una orden viva en el POS del merchant, y mientras no se
 * anule es basura que el restaurante ve en su caja. Un reintento la
 * recoge.
 */
export function siguientePaso(estado: Estado): Paso {
  switch (estado) {
    case 'started':
      return { kind: 'totales' };
    case 'totals_ok':
      return { kind: 'crear-orden' };
    case 'order_created':
      return { kind: 'cobrar' };
    case 'paid':
      return { kind: 'imprimir' };
    case 'printed':
    case 'done':
      return { kind: 'nada', porque: 'terminado' };
    case 'voiding':
      return { kind: 'anular-orden' };
    case 'failed':
      return { kind: 'nada', porque: 'fallido' };
  }
}

/**
 * El estado que se escribe ANTES de cada llamada.
 *
 * No después. Si el proceso muere entre el `update` y la respuesta, el
 * reintento tiene que saber que esa llamada PUDO haber ocurrido; con el
 * orden al revés se encontraría el estado anterior y la repetiría, que
 * en el paso de cobrar significa cobrar dos veces.
 *
 * `null` = ese paso no necesita anunciarse porque no puede dejar nada a
 * medias en Clover.
 */
export function estadoAntesDe(paso: Paso): Estado | null {
  switch (paso.kind) {
    // Un `checkouts` no crea nada: si se pierde la respuesta, se repite
    // sin consecuencias.
    case 'totales':
      return null;
    // Estos tres sí. Cada uno puede dejar algo en el POS del merchant.
    case 'crear-orden':
      return 'totals_ok';
    case 'cobrar':
      return 'order_created';
    case 'imprimir':
      return 'paid';
    case 'anular-orden':
      return 'voiding';
    case 'nada':
      return null;
  }
}

/** El estado al que se pasa cuando el paso sale bien. */
export function estadoTrasExito(paso: Paso): Estado {
  switch (paso.kind) {
    case 'totales':
      return 'totals_ok';
    case 'crear-orden':
      return 'order_created';
    case 'cobrar':
      return 'paid';
    case 'imprimir':
      return 'printed';
    // Anular con éxito no rescata el intento: el cliente no pagó y no
    // tiene pedido. Lo que se consigue es no dejar basura en el POS.
    case 'anular-orden':
      return 'failed';
    case 'nada':
      return 'done';
  }
}

/**
 * Qué se hace cuando un paso falla.
 *
 * ES LA PIEZA QUE MÁS IMPORTA DE TODO EL MÓDULO, y se reduce a tres
 * frases:
 *
 *   antes de cobrar   no hay nada que deshacer. Nadie pagó
 *   cobrando          SE ANULA LA ORDEN. Es la compensación
 *   imprimiendo       NO SE TOCA EL DINERO. El pedido es válido
 *
 * La tercera es la contraintuitiva y la que hay que defender: una
 * impresora sin papel no puede convertirse en un reembolso. El pedido
 * está pagado, el restaurante lo ve en su app de Orders, y lo que falta
 * es un aviso al local — no una devolución.
 */
export type Reaccion =
  | { readonly kind: 'reintentable'; readonly estado: Estado }
  | { readonly kind: 'compensar'; readonly estado: Estado }
  | { readonly kind: 'seguir-adelante'; readonly estado: Estado };

export function reaccionAlFallo(paso: Paso): Reaccion {
  switch (paso.kind) {
    // Nadie pagó y no hay nada creado: el cliente reintenta con la misma
    // clave y el intento empieza donde estaba.
    case 'totales':
      return { kind: 'reintentable', estado: 'started' };
    case 'crear-orden':
      return { kind: 'reintentable', estado: 'totals_ok' };

    // LA COMPENSACIÓN. Queda una orden sin pagar en el POS y hay que
    // anularla. `voiding` lo deja escrito por si esto también falla.
    case 'cobrar':
      return { kind: 'compensar', estado: 'voiding' };

    // El pedido está pagado y es válido. Un fallo de impresión es
    // operativo, no financiero: se marca y se avisa, no se reembolsa.
    case 'imprimir':
      return { kind: 'seguir-adelante', estado: 'printed' };

    // Falló la anulación. No hay una segunda compensación que inventar:
    // se deja en `voiding` para que el reintento vuelva a por ella, y
    // mientras tanto sale en la vista de guardia de la 0018.
    case 'anular-orden':
      return { kind: 'reintentable', estado: 'voiding' };

    case 'nada':
      return { kind: 'reintentable', estado: 'failed' };
  }
}

/**
 * ¿El dinero del cliente está comprometido a partir de este estado?
 *
 * Se usa para decidir si un fallo puede contestarse con "vuelve a
 * intentarlo" —que invita a pulsar otra vez— o si hay que decir otra
 * cosa. Decirle "reintenta" a alguien que ya pagó es pedirle que pague
 * dos veces.
 */
export function yaSeCobro(estado: Estado): boolean {
  return estado === 'paid' || estado === 'printed' || estado === 'done';
}

/**
 * La máquina no anda hacia atrás.
 *
 * Un intento en `paid` no vuelve a `order_created` ni aunque llegue una
 * petición que lo pida: sería repetir un cobro. Lo comprueba el adaptador
 * antes de escribir, y hay un `check` en la 0018 detrás.
 */
export function avanza(desde: Estado, hasta: Estado): boolean {
  // `voiding` y `failed` son la rama mala: se puede entrar en ella desde
  // cualquier punto del progreso, pero no se sale hacia el progreso.
  if (hasta === 'voiding' || hasta === 'failed') return desde !== 'failed';
  if (desde === 'voiding' || desde === 'failed') return false;
  return ORDEN.indexOf(hasta) > ORDEN.indexOf(desde);
}

const ORDEN: readonly Estado[] = [
  'started',
  'totals_ok',
  'order_created',
  'paid',
  'printed',
  'done',
];
