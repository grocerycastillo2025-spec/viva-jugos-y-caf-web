/**
 * El recargo por tarjeta: qué se le enseña al cliente y qué se decide.
 *
 * QUÉ ES
 * Clover permite que un merchant aplique un recargo por tarjeta de
 * crédito. Se lee en `ecomm_payment_configs`. Si está activo, al cliente
 * se le cobra MÁS de lo que le enseñó la app — y eso no es un ajuste de
 * configuración, es una diferencia entre el precio anunciado y el cobrado.
 *
 * DOS POLÍTICAS, POR SUCURSAL, EN LA BASE
 * `stores.surcharge_policy` (migración 0011, reducida por la 0019). No es
 * una constante en el código porque la respuesta correcta depende del
 * restaurante y puede cambiar sin que nosotros toquemos nada:
 *
 *   show   mostrarlo antes de pagar        POR DEFECTO
 *   block  esa sucursal no se activa
 *
 * `show` es el defecto porque es lo más seguro legalmente: el cliente ve
 * que va a pagar un recargo antes de pagarlo.
 *
 * LO QUE NINGUNA POLÍTICA APAGA
 * El aviso al super admin. Sale con las dos, siempre, y por eso no hay
 * ningún valor que se pueda poner para silenciarlo: es información para
 * decidir antes de firmar, no una alerta molesta.
 *
 * ─────────────────────────────────────────────────────────────────────
 * HABÍA UNA TERCERA, `absorb`, Y SE QUITÓ EN LA 0019
 * ─────────────────────────────────────────────────────────────────────
 *
 * Prometía que el recargo lo asumía el restaurante. No podía cumplirlo, y
 * el hallazgo que lo cierra es concreto: **el endpoint de cobro no tiene
 * campo para renunciar al recargo**. `POST /v1/orders/{id}/pay` manda
 * `source`, `amount`, `tip_amount` y `currency`, y nada más; el recargo lo
 * aplica Clover según la configuración del merchant y el BIN de la
 * tarjeta, y llega en `additionalCharges` del pago.
 *
 * Así que con `absorb` puesta el restaurante no absorbía nada: el cliente
 * pagaba el recargo igual, y encima **en silencio**, porque esa política
 * suprimía el aviso. Dos fallos a la vez, y el segundo es el caro:
 *
 *   1. faltaba un aviso obligatorio — y en Nueva Jersey eso es la
 *      infracción, no un detalle de copia;
 *   2. el restaurante se equivocaba sobre su propia economía, y en la
 *      dirección que le hacía creer que estaba siendo generoso.
 *
 * Una política que promete absorber y no absorbe es peor que no tenerla.
 * La única forma real de absorber es que el restaurante APAGUE el recargo
 * en su cuenta de Clover, y entonces `surcharge_rate` llega a 0 y no hace
 * falta ninguna política.
 *
 * El detalle, en `docs/RECARGO-TARJETA.md` y `docs/PEDIDOS-COBRO.md`.
 *
 * LO QUE ESTE MÓDULO NO HACE, Y AHORA SE SABE POR QUÉ
 * NO suma dinero al cobro, y no es una cautela: el recargo NO está dentro
 * del total de `atomic_order/checkouts`. Va aparte, en
 * `additionalCharges` del pago, y lo aplica Clover. Sumarlo nosotros
 * sería cobrarlo dos veces. `estimated` es para ENSEÑAR, no para cobrar:
 * el importe que se cobra sale siempre de Clover.
 *
 * Puro: no llama a nada.
 */

/** Los dos valores de `app.surcharge_policy`. Eran tres; ver la cabecera. */
export type SurchargePolicy = 'show' | 'block';

export const SURCHARGE_POLICIES: readonly SurchargePolicy[] = ['show', 'block'];

export const DEFAULT_SURCHARGE_POLICY: SurchargePolicy = 'show';

/**
 * Valida lo que venga de la base o de una API.
 *
 * Un valor desconocido cae en `show` y no revienta: si
 * algún día entra un valor nuevo, el peor comportamiento posible es
 * quedarse callado y cobrar de más. Enseñarlo de sobra no hace daño.
 */
export function toSurchargePolicy(value: unknown): SurchargePolicy {
  return SURCHARGE_POLICIES.includes(value as SurchargePolicy)
    ? (value as SurchargePolicy)
    : DEFAULT_SURCHARGE_POLICY;
}

export interface SurchargeInput {
  readonly policy: SurchargePolicy;
  /** Fracción, como la da Clover: 0.035 = 3,5 %. `null` = sin consultar. */
  readonly rate: number | null;
  /** Centavos sobre los que estimar. Solo para enseñar. */
  readonly subtotalCents?: number;
}

export interface SurchargeOutcome {
  readonly policy: SurchargePolicy;
  readonly rate: number | null;
  /** ¿Hay recargo activo del que hablar? */
  readonly active: boolean;
  /** Centavos ESTIMADOS, para enseñar. `null` si no se sabe la tasa. */
  readonly estimatedCents: number | null;
  /** ¿Se le enseña al cliente antes de pagar? */
  readonly disclose: boolean;
  /** ¿Impide activar esta sucursal? */
  readonly blocksActivation: boolean;
  /** Para el super admin. SIEMPRE que haya recargo, con cualquier política. */
  readonly adminNotice: string | null;
}

/** `0.035` -> `"3,5 %"`. Sin decimales de más: nadie dice "3,50 %". */
export function formatSurchargeRate(rate: number): string {
  const porcentaje = rate * 100;
  const texto = Number.isInteger(porcentaje) ? String(porcentaje) : porcentaje.toFixed(2).replace(/0$/, '');
  return `${texto.replace('.', ',')} %`;
}

export function surchargeOutcome(input: SurchargeInput): SurchargeOutcome {
  const rate = typeof input.rate === 'number' && input.rate > 0 ? input.rate : null;
  const active = rate !== null;

  // Se redondea al centavo más cercano. Es una estimación para enseñar,
  // así que el redondeo no tiene que cuadrar con el de Clover: el importe
  // que se cobra sale de Clover, no de aquí.
  const estimatedCents =
    rate === null || input.subtotalCents === undefined
      ? null
      : Math.round(input.subtotalCents * rate);

  return {
    policy: input.policy,
    rate,
    active,
    estimatedCents,
    // Solo `show` se lo enseña al cliente; con `block` no hay pedido que
    // enseñar. Ya no hay una tercera que calle mientras se cobra.
    disclose: active && input.policy === 'show',
    blocksActivation: active && input.policy === 'block',
    adminNotice: active
      ? `Esta sucursal aplica un recargo del ${formatSurchargeRate(rate)} por tarjeta de crédito. ` +
        `Política actual: ${describePolicy(input.policy)}.`
      : null,
  };
}

function describePolicy(policy: SurchargePolicy): string {
  switch (policy) {
    case 'show':
      return 'se le muestra al cliente antes de pagar';
    case 'block':
      return 'la sucursal NO se activa mientras tenga recargo';
  }
}
