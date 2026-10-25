/**
 * ¿Puede esta sucursal cobrar? La respuesta, sin llamar a nada.
 *
 * QUÉ PREGUNTA RESPONDE ESTE MÓDULO
 * El checklist de onboarding del addendum (variable 2) es bloqueante: si un
 * punto falla, la sucursal queda en `PENDING_SETUP` y no aparece en la app.
 * Esta es la parte de ese checklist que se puede comprobar por API.
 *
 * TRES LLAMADAS, Y SOLO UNA ES LA PUERTA
 *
 *   GET {scl}/pakms/apikey                       ← LA PRUEBA DE VERDAD
 *   GET /v3/merchants/{mId}/gateway              ← quién procesa, y el recargo
 *   GET /v3/merchants/{mId}/ecomm_payment_configs ← qué funciones tiene
 *
 * Ninguna de las tres devuelve un "ecommerce: sí/no", y buscarlo es perder
 * el tiempo. La prueba funcional es PAKMS: si el merchant no puede producir
 * una clave de ecommerce, no se le puede cobrar, y da igual lo que digan
 * las otras dos. Las otras dos no son la puerta; son lo que hay que MIRAR
 * antes de cruzarla.
 *
 * EL RECARGO ES EL HALLAZGO INCÓMODO
 * `ecomm_payment_configs` dice si el merchant tiene recargo por tarjeta de
 * crédito activo. Si lo tiene, al cliente se le cobra MÁS de lo que le
 * enseñamos en la app. Eso no es un ajuste de configuración: es una
 * diferencia entre el precio anunciado y el cobrado, y en varios sitios
 * eso tiene nombre legal. Sale como aviso, no como bloqueo, porque la
 * decisión es de producto: mostrarlo, o no abrir esa sucursal. Absorberlo
 * NO es una opción, y no por decisión nuestra: el endpoint de cobro no
 * tiene campo para renunciar al recargo. Ver `surcharge.ts`.
 *
 * PURO A PROPÓSITO
 * No hace ninguna llamada: recibe las tres respuestas y dictamina. Así el
 * criterio se puede probar entero sin red, y el orquestador —que es de
 * otra fase— decide cuándo y cada cuánto preguntar.
 */

import {
  surchargeOutcome,
  type SurchargeOutcome,
  type SurchargePolicy,
} from './surcharge.ts';
import type { CloverEcommPaymentConfigs, CloverGateway } from './types.ts';

export interface EcommerceEvidence {
  /** De `GET /pakms/apikey`. `null` si la llamada falló o no devolvió clave. */
  readonly apiAccessKey: string | null;
  /** De `GET /v3/merchants/{mId}/gateway`. `null` si falló. */
  readonly gateway: CloverGateway | null;
  /** De `GET /v3/merchants/{mId}/ecomm_payment_configs`. `null` si falló. */
  readonly paymentConfigs: CloverEcommPaymentConfigs | null;
  /**
   * `stores.surcharge_policy`. Decide si un recargo activo impide abrir la
   * sucursal — NO si se avisa de él, que es siempre.
   *
   * Por defecto `show`, que es lo que hace la base si nadie la ha tocado.
   */
  readonly surchargePolicy?: SurchargePolicy;
}

export interface EcommerceReadiness {
  /** `false` deja la sucursal en `PENDING_SETUP`. */
  readonly ready: boolean;
  /** Lo que impide abrir. Texto para el SaaS, no códigos. */
  readonly blockers: readonly string[];
  /** Lo que hay que mirar aunque no impida abrir. */
  readonly warnings: readonly string[];
  /** Para pintar en el checklist: "Sandbox Test Merchant". */
  readonly gatewayAccount: string | null;
  /** Fracción: 0.035 = 3,5 %. `null` si no hay recargo o no se pudo leer. */
  readonly surchargeRate: number | null;
  /**
   * El recargo ya resuelto contra la política de la sucursal.
   *
   * Su `adminNotice` es el aviso que sale SIEMPRE, con las tres políticas.
   * No hay ningún valor que lo apague: es información para decidir antes
   * de firmar, no una alerta que se pueda silenciar.
   */
  readonly surcharge: SurchargeOutcome;
}

export function evaluateEcommerceReadiness(evidence: EcommerceEvidence): EcommerceReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. La puerta. Sin clave de ecommerce no hay cobro posible, y ninguna
  //    de las otras dos comprobaciones cambia eso.
  if (evidence.apiAccessKey === null || evidence.apiAccessKey.trim() === '') {
    blockers.push(
      'El merchant no devuelve clave de ecommerce (PAKMS). Sin ella no se le puede ' +
        'cobrar: revisa que tenga ecommerce habilitado en su cuenta de Clover.',
    );
  }

  // 2. La pasarela. Que no se pueda leer no es lo mismo que no tenerla,
  //    pero abrir una sucursal sin saber quién procesa sus cobros no.
  if (evidence.gateway === null) {
    blockers.push(
      'No se pudo leer la pasarela del merchant (/gateway). No abrimos una sucursal ' +
        'sin saber quién procesa sus cobros.',
    );
  } else if (evidence.gateway.supportsMultiPayToken === false) {
    // Informativo de verdad: nosotros usamos tokens de un solo uso. Se
    // anota para el día que haya "tarjeta guardada", no para hoy.
    warnings.push(
      'La cuenta no admite tokens de varios usos. No afecta al pedido normal, que usa ' +
        'tokens de un solo uso; sí afectaría a guardar la tarjeta del cliente.',
    );
  }

  // 3. El recargo. Quién decide qué:
  //      el AVISO lo decide el hecho de que exista  -> siempre
  //      el BLOQUEO lo decide la política de la sucursal
  const recargo = leerRecargo(evidence);
  const surcharge = surchargeOutcome({
    policy: evidence.surchargePolicy ?? 'show',
    rate: recargo,
  });

  if (surcharge.adminNotice !== null) {
    // Va a `warnings` con `show` y a `blockers` con `block`. El texto es
    // el mismo en los dos casos, y sale en los dos: el aviso al super
    // admin no lo apaga ninguna politica.
    const destino = surcharge.blocksActivation ? blockers : warnings;
    destino.push(
      `${surcharge.adminNotice} Al cliente se le cobrará MÁS de lo que le enseña la app ` +
        'si esto no se resuelve antes del primer pedido.',
    );
  }

  if (evidence.paymentConfigs === null) {
    warnings.push(
      'No se pudo leer la configuración de pagos (/ecomm_payment_configs), así que no ' +
        'sabemos si esta sucursal aplica recargo. Conviene comprobarlo a mano.',
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    gatewayAccount: evidence.gateway?.accountName ?? null,
    surchargeRate: recargo,
    surcharge,
  };
}

/**
 * El recargo sale de dos sitios y no siempre del mismo.
 *
 * `ecomm_payment_configs` es la fuente buena: dice si está SOPORTADO y a
 * qué tasa. `/gateway` también trae un `rate`, y se usa solo como respaldo
 * cuando la primera no se pudo leer: un recargo que existe y no vemos es
 * peor que uno que vemos por el sitio secundario.
 */
function leerRecargo(evidence: EcommerceEvidence): number | null {
  const cfg = evidence.paymentConfigs?.surcharging;
  if (cfg?.supported === true && typeof cfg.rate === 'number') return cfg.rate;
  if (cfg?.supported === false) return null;

  const respaldo = evidence.gateway?.rate;
  return typeof respaldo === 'number' && respaldo > 0 ? respaldo : null;
}
