/**
 * El reporte del barrido.
 *
 * ESTO NO ES UN RECUENTO, es lo que alguien lee para validar el mapeo. La
 * diferencia práctica: un recuento dice "48 ítems"; esto dice qué se creó,
 * qué se actualizó, qué se ignoró **y por qué**, y nombra los casos que
 * el documento de mapeo dejó abiertos.
 *
 * LOS `avisos` NO SON ERRORES. Son las preguntas de
 * docs/SINCRONIZACION-CATALOGO.md contestadas con el catálogo del merchant
 * real. Están ahí para que el primer barrido de verdad las conteste en vez
 * de que alguien las resuelva suponiendo.
 */

import type { Resultado } from './ports.ts';

export type Entidad = 'categorias' | 'tasas' | 'grupos' | 'modificadores' | 'items';

export interface Recuento {
  creadas: number;
  actualizadas: number;
  sin_cambios: number;
}

export interface Ignorado {
  readonly tipo: string;
  readonly clover_id: string;
  readonly nombre: string;
  readonly motivo: string;
}

export interface Aviso {
  readonly clover_id: string;
  readonly nombre: string;
  readonly detalle?: string;
}

/** Las cinco preguntas abiertas del documento de mapeo, una por lista. */
export interface Avisos {
  /** ¿Los ocultos en POS son productos retirados o vendidos fuera de caja? */
  items_ocultos: Aviso[];
  /** VARIABLE y PER_UNIT: existen en el espejo y no se pueden pedir. */
  items_no_pedibles: Aviso[];
  /** Clover permite varias categorías; nosotros guardamos una. */
  items_multicategoria: Aviso[];
  /** La expansión `taxRates` no llegó: no sabemos si paga impuesto. */
  impuesto_sin_resolver: Aviso[];
  /** `defaultTaxRates` Y enlaces propios. Si esta lista viene vacía, la
   *  vista `catalog_item_tax_effective` no puede contar doble. */
  items_default_con_enlaces: Aviso[];
  /** `alternateName` hace de descripción en `menu_items`, y no lo es. */
  items_con_alternate_name: Aviso[];
  /** Está en el espejo y Clover no lo devolvió. NO se borra; ver el doc. */
  en_supabase_no_en_clover: Aviso[];
}

export interface Reporte {
  store_id: string;
  merchant_id: string | null;
  empezado: string;
  terminado: string | null;
  /** `false` = alguna página falló. Un barrido incompleto no sirve para
   *  decidir qué falta en Clover: "no vino" y "falló" se ven igual. */
  completo: boolean;
  error: string | null;
  paginas: Record<string, number>;
  entidades: Record<Entidad, Recuento>;
  ignorados: Ignorado[];
  avisos: Avisos;
}

export class Acumulador {
  readonly reporte: Reporte;

  constructor(storeId: string, merchantId: string | null, empezado: Date) {
    this.reporte = {
      store_id: storeId,
      merchant_id: merchantId,
      empezado: empezado.toISOString(),
      terminado: null,
      completo: false,
      error: null,
      paginas: {},
      entidades: {
        categorias: vacio(),
        tasas: vacio(),
        grupos: vacio(),
        modificadores: vacio(),
        items: vacio(),
      },
      ignorados: [],
      avisos: {
        items_ocultos: [],
        items_no_pedibles: [],
        items_multicategoria: [],
        impuesto_sin_resolver: [],
        items_default_con_enlaces: [],
        items_con_alternate_name: [],
        en_supabase_no_en_clover: [],
      },
    };
  }

  pagina(clave: string): void {
    this.reporte.paginas[clave] = (this.reporte.paginas[clave] ?? 0) + 1;
  }

  contar(entidad: Entidad, resultado: Resultado): void {
    const r = this.reporte.entidades[entidad];
    if (resultado === 'creada') r.creadas += 1;
    else if (resultado === 'actualizada') r.actualizadas += 1;
    else r.sin_cambios += 1;
  }

  /**
   * Un enlace que se movió cuenta como actualización del ÍTEM, no como
   * una entidad aparte. Desde fuera, "a este producto le cambiaron los
   * modificadores" es un cambio del producto; contar los enlaces por
   * separado daría un reporte donde nada cambió y aun así algo cambió.
   *
   * Y si el ítem ya se contó como creado o actualizado, no se cuenta dos
   * veces: se mueve de `sin_cambios` solo si estaba ahí.
   */
  enlaceMovido(entidad: Entidad): void {
    const r = this.reporte.entidades[entidad];
    if (r.sin_cambios > 0) {
      r.sin_cambios -= 1;
      r.actualizadas += 1;
    }
  }

  ignorar(tipo: string, cloverId: string, nombre: string, motivo: string): void {
    this.reporte.ignorados.push({ tipo, clover_id: cloverId, nombre, motivo });
  }

  avisar(lista: keyof Avisos, aviso: Aviso): void {
    this.reporte.avisos[lista].push(aviso);
  }

  cerrar(terminado: Date, completo: boolean, error: string | null): Reporte {
    this.reporte.terminado = terminado.toISOString();
    this.reporte.completo = completo;
    this.reporte.error = error;
    return this.reporte;
  }
}

/**
 * ¿Este barrido cambió algo?
 *
 * Es la pregunta de la idempotencia y hay que poder hacérsela al reporte
 * sin sumar a mano siete campos. La prueba de idempotencia es literalmente
 * `assert.equal(huboCambios(segundo), false)`.
 */
export function huboCambios(reporte: Reporte): boolean {
  return Object.values(reporte.entidades).some((r) => r.creadas > 0 || r.actualizadas > 0);
}

function vacio(): Recuento {
  return { creadas: 0, actualizadas: 0, sin_cambios: 0 };
}
