/**
 * La secuencia, con su compensación.
 *
 * Recorre la máquina de `maquina.ts` paso a paso hasta que no queda nada
 * que hacer. No decide el orden —eso es la máquina— ni habla con nadie
 * —eso son los puertos—: lo que hace es lo que no cabe en ninguno de los
 * dos, que es CUÁNDO SE ESCRIBE respecto a cuándo se llama.
 *
 * ─────────────────────────────────────────────────────────────────────
 * SE ESCRIBE ANTES DE LLAMAR, NO DESPUÉS
 * ─────────────────────────────────────────────────────────────────────
 *
 * Antes de cada llamada que puede dejar algo en el POS del merchant, el
 * estado del intento ya lo dice. Si el proceso muere entre el `update` y
 * la respuesta, el reintento se encuentra el estado "estaba cobrando" y
 * NO repite el cobro: comprueba.
 *
 * Al revés —llamar y luego escribir— el reintento vería "iba a cobrar",
 * volvería a llamar, y la única defensa sería la clave de idempotencia de
 * Clover. Que está y funciona; pero apoyar un cobro en una sola red es
 * apoyarlo en que esa red no falle nunca.
 *
 * ─────────────────────────────────────────────────────────────────────
 * LO QUE ESTE MÓDULO NO HACE
 * ─────────────────────────────────────────────────────────────────────
 *
 * No valida el carrito. Eso ya pasó: el intento llega con las líneas
 * releídas de nuestra base por `app.open_checkout_attempt` (0018), y aquí
 * no se puede colar un precio del teléfono porque no hay por dónde.
 *
 * No calcula dinero. Los totales son los de `checkouts` y el importe
 * cobrado es el que Clover diga. Ver `ports.ts`, `cobrar`.
 *
 * No reembolsa nunca. La única marcha atrás es anular una orden SIN
 * PAGAR; a partir de que hay un cobro, deshacer es una decisión con
 * dinero de por medio y no la toma un bucle.
 */

import {
  estadoAntesDe,
  estadoTrasExito,
  reaccionAlFallo,
  siguientePaso,
  yaSeCobro,
  type Estado,
  type Paso,
} from './maquina.ts';
import {
  SILENT_CHECKOUT_LOG,
  type CheckoutApi,
  type CheckoutLog,
  type CheckoutStore,
  type Cobro,
  type Intento,
} from './ports.ts';

export interface FlujoDeps {
  readonly api: CheckoutApi;
  readonly store: CheckoutStore;
  readonly log?: CheckoutLog;
}

export interface FlujoInput {
  readonly intento: Intento;
  /** El token `clv_...` de un solo uso. No es una tarjeta. */
  readonly source: string;
  readonly tipCents: number;
}

/**
 * Lo que sale de un intento completo.
 *
 * `ResultadoCheckout` y no `Resultado` a secas porque el barrido de
 * catalogo ya exporta un `Resultado` —el de una fila: creada,
 * actualizada, sin cambios— y los dos salen por `@juicebar/workers`. Dos
 * tipos distintos con el mismo nombre es una ambigüedad para el
 * compilador y una confusion para quien lee.
 */
export interface ResultadoCheckout {
  readonly estado: Estado;
  readonly cloverOrderId: string | null;
  readonly cobrado: boolean;
  readonly impreso: boolean;
  /** La orden quedó viva en el POS y no se pudo anular. Hay que mirarla. */
  readonly ordenHuerfana: boolean;
  readonly error: string | null;
}

/** Tope de pasos. La máquina siempre avanza, pero un bucle infinito en el
 *  camino del dinero no es algo que se deje a la confianza. */
const MAX_PASOS = 12;

export async function ejecutarCheckout(deps: FlujoDeps, input: FlujoInput): Promise<ResultadoCheckout> {
  const log = deps.log ?? SILENT_CHECKOUT_LOG;
  const { intento } = input;
  const traza = { intento: intento.id, pedido: intento.orderId, store: intento.storeId };

  let estado = intento.estado;
  let cloverOrderId = intento.cloverOrderId;
  let cobrado = yaSeCobro(estado);
  let impreso = estado === 'printed' || estado === 'done';
  let ordenHuerfana = false;
  let error: string | null = null;

  for (let n = 0; n < MAX_PASOS; n += 1) {
    const paso = siguientePaso(estado);
    if (paso.kind === 'nada') break;

    // 1. Se anuncia la intención ANTES de llamar. Ver la cabecera.
    const anuncio = estadoAntesDe(paso);
    if (anuncio !== null && anuncio !== estado) {
      await deps.store.avanzar(intento.id, estado, anuncio);
      estado = anuncio;
    }

    try {
      cloverOrderId = await ejecutarPaso(deps, input, paso, cloverOrderId);
    } catch (err) {
      error = mensajeSeguro(err);
      const reaccion = reaccionAlFallo(paso);
      log.error('paso_fallido', { ...traza, paso: paso.kind, estado, error });

      if (reaccion.kind === 'seguir-adelante') {
        // Impresión. El pedido está pagado y es válido: se marca y se
        // sigue. Convertir esto en un reembolso sería tratar una
        // impresora sin papel como un problema de dinero.
        await deps.store.marcarImpreso(intento.orderId, false);
        await avanzarA(deps, intento.id, estado, reaccion.estado);
        estado = reaccion.estado;
        log.warn('impresion_fallida', { ...traza, accion: 'avisar al local, NO reembolsar' });
        continue;
      }

      if (reaccion.kind === 'compensar') {
        // El cobro falló. Queda una orden sin pagar en el POS.
        await deps.store.marcarCobroFallido(intento.orderId, error);
        await avanzarA(deps, intento.id, estado, reaccion.estado);
        estado = reaccion.estado;
        ordenHuerfana = !(await anular(deps, log, intento, cloverOrderId, error));
        estado = ordenHuerfana ? 'voiding' : 'failed';
        break;
      }

      // Reintentable: no se toca nada más. El estado que queda escrito es
      // desde donde retomará el reintento con la misma clave.
      break;
    }

    // 2. Y solo entonces se apunta el éxito.
    const siguiente = estadoTrasExito(paso);
    await avanzarA(deps, intento.id, estado, siguiente);
    estado = siguiente;
    if (paso.kind === 'cobrar') cobrado = true;
    if (paso.kind === 'imprimir') {
      impreso = true;
      await deps.store.marcarImpreso(intento.orderId, true);
    }
  }

  if (estado === 'printed') {
    await deps.store.terminar(intento.id, { order_id: intento.orderId });
    estado = 'done';
  }

  log.info('checkout_terminado', { ...traza, estado, cobrado, impreso, ordenHuerfana });
  return { estado, cloverOrderId, cobrado, impreso, ordenHuerfana, error };
}

// ---------------------------------------------------------------------

async function ejecutarPaso(
  deps: FlujoDeps,
  input: FlujoInput,
  paso: Paso,
  cloverOrderId: string | null,
): Promise<string | null> {
  const { intento } = input;

  switch (paso.kind) {
    case 'totales': {
      const totales = await deps.api.totales(intento.lineas, intento);
      // El ÚNICO origen del total del pedido. Calcularlo nosotros sería
      // inventarnos los impuestos del merchant.
      await deps.store.guardarTotales(intento.orderId, {
        subtotalCents: entero(totales.subtotal),
        taxCents: entero(totales.tax),
        totalCents: entero(totales.total),
      });
      return cloverOrderId;
    }

    case 'crear-orden': {
      const orden = await deps.api.crearOrden(intento.lineas, intento);
      if (typeof orden.id !== 'string' || orden.id === '') {
        // Sin id no se puede cobrar ni anular: es un fallo, no un éxito a
        // medias. Dejarlo pasar llevaría a cobrar una orden sin nombre.
        throw new Error('Clover creó la orden sin devolver id');
      }
      await deps.store.guardarOrdenClover(intento.orderId, orden.id);
      return orden.id;
    }

    case 'cobrar': {
      if (cloverOrderId === null) {
        throw new Error('no hay orden en Clover que cobrar');
      }
      const pago = await deps.api.cobrar({
        cloverOrderId,
        source: input.source,
        // LA MISMA CLAVE que la creación de la orden. Es lo que hace que
        // un reintento no cobre dos veces.
        idempotencyKey: intento.idempotencyKey,
        tipCents: input.tipCents,
      });
      await deps.store.guardarCobro(intento.orderId, leerCobro(pago));
      return cloverOrderId;
    }

    case 'imprimir': {
      if (cloverOrderId === null) throw new Error('no hay orden en Clover que imprimir');
      await deps.api.imprimir(cloverOrderId, intento.idempotencyKey);
      return cloverOrderId;
    }

    case 'anular-orden': {
      if (cloverOrderId === null) return cloverOrderId;
      await deps.api.anularOrden(cloverOrderId);
      return cloverOrderId;
    }

    case 'nada':
      return cloverOrderId;
  }
}

/**
 * La compensación: anular la orden que quedó sin pagar.
 *
 * Devuelve si se consiguió. Que falle NO propaga: el cobro ya falló y el
 * cliente ya tiene su error; lo que queda es basura en el POS del
 * merchant, y eso se arregla con una vista de guardia y no tirando otra
 * excepción encima de la primera.
 */
async function anular(
  deps: FlujoDeps,
  log: CheckoutLog,
  intento: Intento,
  cloverOrderId: string | null,
  errorDelCobro: string,
): Promise<boolean> {
  if (cloverOrderId === null) return true; // No llegó a existir: nada que anular.
  try {
    await deps.api.anularOrden(cloverOrderId);
    await deps.store.avanzar(intento.id, 'voiding', 'failed');
    log.info('orden_anulada', { intento: intento.id, cloverOrderId });
    return true;
  } catch (err) {
    await deps.store.marcarAnulacionPendiente(
      intento.id,
      `cobro: ${errorDelCobro} | anulacion: ${mensajeSeguro(err)}`,
    );
    log.error('orden_huerfana_en_clover', {
      intento: intento.id,
      cloverOrderId,
      accion: 'anularla a mano en el POS; sale en public.checkouts_atascados',
    });
    return false;
  }
}

async function avanzarA(
  deps: FlujoDeps,
  intentoId: string,
  desde: Estado,
  hasta: Estado,
): Promise<void> {
  if (desde === hasta) return;
  await deps.store.avanzar(intentoId, desde, hasta);
}

/**
 * Lo que Clover dijo que cobró, separado en sus dos mitades.
 *
 * `amount` es el total de la orden. EL RECARGO POR TARJETA NO ESTÁ AHÍ:
 * va en `additionalCharges`, y el importe que el cliente ve en su extracto
 * es la suma de los dos. Ver docs/PEDIDOS-COBRO.md, parte 1.
 *
 * `null` en `surchargeCents` no es `0`: es "no venía el campo". Escribir
 * cero diría que no hubo recargo, y eso no lo sabemos.
 */
export function leerCobro(pago: {
  readonly id: string;
  readonly amount?: number | undefined;
  readonly tipAmount?: number | undefined;
  readonly additionalCharges?:
    { readonly elements?: readonly { readonly amount?: number }[] } | undefined;
  readonly card?: { readonly brand?: string; readonly last4?: string } | undefined;
}): Cobro {
  const cargos = pago.additionalCharges?.elements;
  return {
    providerPaymentId: pago.id,
    amountCents: entero(pago.amount),
    tipCents: entero(pago.tipAmount),
    surchargeCents:
      cargos === undefined ? null : cargos.reduce((suma, c) => suma + entero(c.amount), 0),
    cardBrand: pago.card?.brand ?? null,
    cardLast4: pago.card?.last4 ?? null,
  };
}

function entero(valor: number | undefined): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.trunc(valor) : 0;
}

function mensajeSeguro(err: unknown, maxChars = 500): string {
  const texto = err instanceof Error ? err.message : String(err);
  return texto.length > maxChars ? `${texto.slice(0, maxChars)}…` : texto;
}
