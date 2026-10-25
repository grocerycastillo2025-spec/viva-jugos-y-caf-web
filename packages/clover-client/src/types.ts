/**
 * Los objetos de Clover, declarados por lo que USAMOS.
 *
 * DELIBERADAMENTE INCOMPLETOS
 * Clover devuelve bastante más de lo que aparece aquí. Declarar el objeto
 * entero de memoria sería inventar, que es justo lo que no se hace en esta
 * fase; y declararlo "por si acaso" invita a que alguien lea un campo que
 * nadie verificó. Aquí está lo que la plataforma consume, y §12 de la
 * arquitectura ya dice qué guardamos y qué no.
 *
 * CASI TODO ES OPCIONAL, Y ES CORRECTO
 * La API omite los campos vacíos en vez de mandarlos a null, y lo que
 * viene depende de los `expand` que pidas. Un campo no opcional sería una
 * promesa que la respuesta no hace. Con `strict` activado, esto obliga a
 * comprobar antes de usar, que es exactamente lo que queremos cuando el
 * dato viene de fuera.
 *
 * EL DINERO ES SIEMPRE ENTERO EN CENTAVOS
 * Igual que en nuestro esquema. Ningún float toca un precio.
 */

export interface CloverRef {
  readonly id: string;
}

export interface CloverMerchant {
  readonly id: string;
  readonly name?: string;
  /** IANA, p.ej. "America/Chicago". Lo usa el escalonado de barridos. */
  readonly timezone?: string;
  readonly currency?: string;
}

/**
 * La cuenta de pasarela del merchant.
 *
 * `rate` es la tasa de RECARGO por tarjeta de credito, como fraccion
 * (0.035 = 3,5 %), no en milesimas como `CloverTaxRate.rate`. Dos campos
 * que se llaman igual y no se miden igual: mezclarlos da un total con dos
 * ordenes de magnitud de error.
 *
 * `supportsMultiPayToken` es para tokens de varios usos (tarjeta
 * guardada). Nosotros usamos tokens de un solo uso, asi que se anota pero
 * no bloquea nada.
 */
export interface CloverGateway {
  readonly accountName?: string;
  readonly supportsMultiPayToken?: boolean;
  readonly rate?: number;
}

/**
 * Que funciones de pago tiene habilitadas el merchant.
 *
 * `surcharging.supported` es el que importa: si esta activo, al cliente se
 * le cobra mas de lo que le ensenamos, y eso hay que resolverlo antes de
 * abrir la sucursal, no despues de la primera queja.
 */
export interface CloverEcommPaymentConfigs {
  readonly surcharging?: {
    readonly supported?: boolean;
    /** Fraccion: 0.035 = 3,5 %. */
    readonly rate?: number;
  };
  readonly purchase_card?: {
    readonly supported?: boolean;
  };
}

export interface CloverCategory {
  readonly id: string;
  readonly name?: string;
  readonly sortOrder?: number;
  readonly modifiedTime?: number;
}

export interface CloverTaxRate {
  readonly id: string;
  readonly name?: string;
  /** Milésimas de porcentaje: 8250 = 8.25 %. */
  readonly rate?: number;
  readonly isDefault?: boolean;
  readonly modifiedTime?: number;
}

export interface CloverItemStock {
  readonly item?: CloverRef;
  readonly stockCount?: number;
  readonly quantity?: number;
}

export interface CloverItem {
  readonly id: string;
  readonly name?: string;
  readonly code?: string;
  readonly sku?: string;
  /**
   * Nombre alternativo del POS. NO es una descripción: suele ser una
   * abreviatura de ticket (`GRN JCE 16`). Ojo al enseñarlo en la app —
   * ver docs/SINCRONIZACION-CATALOGO.md.
   */
  readonly alternateName?: string;
  /** Centavos. Solo significa algo con `priceType: 'FIXED'`. */
  readonly price?: number;
  /** `FIXED` | `VARIABLE` | `PER_UNIT`. Los dos últimos no se pueden pedir. */
  readonly priceType?: string;
  readonly hidden?: boolean;
  /** Clover marca así lo agotado; §8.3. */
  readonly available?: boolean;
  /** El ítem usa las tasas por defecto del merchant en vez de unas propias. */
  readonly defaultTaxRates?: boolean;
  readonly modifiedTime?: number;
  readonly categories?: { readonly elements?: readonly CloverCategory[] };
  readonly modifierGroups?: { readonly elements?: readonly CloverModifierGroup[] };
  /**
   * Solo llega con `expand=taxRates`. AUSENTE NO ES VACÍO: ausente es que
   * no lo sabemos, vacío es que no tiene tasas propias. Confundirlos
   * declara exento un producto que quizá paga impuesto.
   */
  readonly taxRates?: { readonly elements?: readonly CloverTaxRate[] };
  readonly itemStock?: CloverItemStock;
}

export interface CloverModifier {
  readonly id: string;
  readonly name?: string;
  /** Centavos; puede ser 0 o negativo. */
  readonly price?: number;
  readonly available?: boolean;
  readonly modifiedTime?: number;
  readonly modifierGroup?: CloverRef;
}

export interface CloverModifierGroup {
  readonly id: string;
  readonly name?: string;
  /** `minRequired` > 0 es lo que hace que el "+" rápido lleve a elegir. */
  readonly minRequired?: number;
  readonly maxAllowed?: number;
  readonly sortOrder?: number;
  readonly showByDefault?: boolean;
  readonly modifiedTime?: number;
  readonly modifiers?: { readonly elements?: readonly CloverModifier[] };
}

export interface CloverOrderType {
  readonly id: string;
  readonly label?: string;
  readonly taxable?: boolean;
  readonly isDefault?: boolean;
  readonly filterCategories?: boolean;
}

export interface CloverLineItem {
  readonly id?: string;
  readonly item?: CloverRef;
  readonly name?: string;
  readonly price?: number;
  readonly unitQty?: number;
  readonly note?: string;
  readonly modifications?: { readonly elements?: readonly CloverModification[] };
  /**
   * Clover lo pone a `true` cuando la linea llego a su destino de ordenes
   * —el KDS, en el caso de Viva—. Es la confirmacion de que la COCINA lo
   * recibio, no solo de que aceptamos la peticion de impresion. Llega como
   * webhook de tipo `O`. Ver el addendum de KDS.
   */
  readonly printed?: boolean;
}

export interface CloverModification {
  readonly id?: string;
  readonly modifier?: CloverRef;
  readonly name?: string;
  readonly amount?: number;
}

export interface CloverOrder {
  readonly id: string;
  readonly state?: string;
  /** Centavos, ya con impuestos. */
  readonly total?: number;
  readonly currency?: string;
  readonly title?: string;
  readonly note?: string;
  readonly paymentState?: string;
  readonly createdTime?: number;
  readonly modifiedTime?: number;
  readonly orderType?: CloverOrderType;
  readonly lineItems?: { readonly elements?: readonly CloverLineItem[] };
}

/** Lo que devuelve `atomic_order/checkouts`: totales sin crear nada. */
export interface CloverCheckout {
  readonly total?: number;
  readonly subtotal?: number;
  readonly tax?: number;
  readonly lineItems?: { readonly elements?: readonly CloverLineItem[] };
}

export interface CloverPrintEvent {
  readonly id?: string;
  readonly orderRef?: CloverRef;
  /** CREATED | PRINTING | FAILED, según la documentación. */
  readonly state?: string;
  readonly createdTime?: number;
}

/** Token de un solo uso de la API de tokenización. Empieza por `clv_`. */
export interface CloverCardToken {
  readonly id: string;
  readonly card?: {
    readonly first6?: string;
    readonly last4?: string;
    readonly exp_month?: string;
    readonly exp_year?: string;
    readonly brand?: string;
  };
}

/** La clave pública de ecommerce que devuelve PAKMS. */
export interface CloverApiAccessKey {
  readonly apiAccessKey: string;
}

/**
 * Un cargo que Clover añade POR ENCIMA de `amount`.
 *
 * El recargo por tarjeta de crédito llega aquí, con `type`
 * `CREDIT_SURCHARGE`. NO está dentro del total de la orden ni de
 * `payment.amount`: lo que el cliente ve en su extracto es la suma.
 * Documentado con ejemplo: sobre $35,00 y un 3,5 %, *"the customer was
 * charged $36.22"*, y ese $1,22 es esto.
 */
export interface CloverAdditionalCharge {
  readonly id?: string;
  /** `CREDIT_SURCHARGE` es el recargo por tarjeta. */
  readonly type?: string;
  /** Centavos. */
  readonly amount?: number;
}

export interface CloverPayment {
  readonly id: string;
  /**
   * El total de la ORDEN, en centavos. Ojo: NO es lo que se le cobró al
   * cliente si hubo recargo por tarjeta — ver `additionalCharges`.
   */
  readonly amount?: number;
  readonly tipAmount?: number;
  readonly currency?: string;
  readonly status?: string;
  readonly created?: number;
  readonly order?: CloverRef | string;
  /** Solo llega con `?expand=additionalCharges`. Ausente ≠ vacío. */
  readonly additionalCharges?: { readonly elements?: readonly CloverAdditionalCharge[] };
  /** Lo único de la tarjeta que se guarda: marca y últimos cuatro. */
  readonly card?: {
    readonly brand?: string;
    readonly last4?: string;
  };
}

/** El par de tokens del flujo v2/OAuth. Los `*_expiration` son unix en segundos. */
export interface CloverTokenPair {
  readonly access_token: string;
  readonly access_token_expiration?: number;
  readonly refresh_token?: string;
  readonly refresh_token_expiration?: number;
}
