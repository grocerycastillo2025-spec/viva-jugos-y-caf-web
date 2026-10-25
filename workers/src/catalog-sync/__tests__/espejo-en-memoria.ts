/**
 * Un espejo en memoria con las MISMAS reglas que el adaptador de Postgres.
 *
 * POR QUE EXISTE, Y QUE NO ES
 * No es una simulacion de Postgres. Es un `CatalogStore` que responde
 * 'creada' | 'actualizada' | 'sin-cambios' comparando VALORES, que es
 * exactamente lo que hace el CTE `antes` de `postgres.ts`. Sirve para
 * ejercitar el barrido entero —paginacion, idempotencia, reporte,
 * determinismo— sin levantar una base.
 *
 * Lo que NO cubre es que el SQL generado haga eso de verdad. De eso se
 * encarga `postgres.test.ts`, que afirma sobre el texto del `update`, y
 * la comprobacion contra un Postgres 16 de verdad que se hizo al
 * escribirlo.
 *
 * `synced_at` no aparece por ningun lado a proposito: si estuviera y se
 * comparase, todo barrido pareceria haber cambiado todo, que es justo el
 * fallo que el adaptador evita.
 */
import type { FilaCategoria, FilaGrupo, FilaItem, FilaModificador, FilaTasa } from '../mapping.ts';
import type { CatalogStore, EnlaceGrupo, EntradaReporte, Guardado } from '../ports.ts';

interface Fila {
  readonly id: string;
  valores: Record<string, unknown>;
}

export class EspejoEnMemoria implements CatalogStore {
  private readonly tablas = new Map<string, Map<string, Fila>>();
  private readonly enlacesGrupo = new Map<string, Map<string, number>>();
  private readonly enlacesTasa = new Map<string, Set<string>>();
  private readonly impuestoResuelto = new Map<string, boolean | null>();
  private siguienteId = 0;

  readonly reportes: EntradaReporte[] = [];
  /** Nombres de items que el espejo ya tenia antes del barrido. */
  readonly preexistentes = new Map<string, string>();

  private guardar(tabla: string, clave: string, valores: Record<string, unknown>): Guardado {
    let filas = this.tablas.get(tabla);
    if (filas === undefined) {
      filas = new Map();
      this.tablas.set(tabla, filas);
    }
    const previa = filas.get(clave);
    if (previa === undefined) {
      const fila = { id: `uuid-${++this.siguienteId}`, valores };
      filas.set(clave, fila);
      return { id: fila.id, resultado: 'creada' };
    }
    const cambiada = JSON.stringify(previa.valores) !== JSON.stringify(valores);
    previa.valores = valores;
    return { id: previa.id, resultado: cambiada ? 'actualizada' : 'sin-cambios' };
  }

  async guardarCategoria(storeId: string, fila: FilaCategoria): Promise<Guardado> {
    return this.guardar('categorias', `${storeId}|${fila.cloverId}`, { ...fila });
  }

  async guardarTasa(storeId: string, fila: FilaTasa): Promise<Guardado> {
    return this.guardar('tasas', `${storeId}|${fila.cloverId}`, { ...fila });
  }

  async guardarGrupo(storeId: string, fila: FilaGrupo): Promise<Guardado> {
    return this.guardar('grupos', `${storeId}|${fila.cloverId}`, { ...fila });
  }

  async guardarModificador(
    storeId: string,
    grupoId: string,
    fila: FilaModificador,
  ): Promise<Guardado> {
    return this.guardar('modificadores', `${storeId}|${fila.cloverId}`, { ...fila, grupoId });
  }

  async guardarItem(
    storeId: string,
    fila: FilaItem,
    categoriaId: string | null,
  ): Promise<Guardado> {
    return this.guardar('items', `${storeId}|${fila.cloverId}`, { ...fila, categoriaId });
  }

  /** Diferencia de conjuntos, igual que el adaptador: si el conjunto
   *  deseado es el que ya hay, no se movio nada. */
  async enlazarGrupos(itemId: string, grupos: readonly EnlaceGrupo[]): Promise<number> {
    const previos = this.enlacesGrupo.get(itemId) ?? new Map<string, number>();
    const deseados = new Map(grupos.map((g) => [g.modifierGroupId, g.sortOrder]));
    let movidos = 0;
    for (const id of previos.keys()) if (!deseados.has(id)) movidos += 1;
    for (const [id, orden] of deseados) if (previos.get(id) !== orden) movidos += 1;
    this.enlacesGrupo.set(itemId, deseados);
    return movidos;
  }

  async enlazarTasas(itemId: string, tasaIds: readonly string[] | null): Promise<number> {
    // `null` = no tocar. Es la orden que distingue "no sabemos" de "exento".
    if (tasaIds === null) return 0;
    const previos = this.enlacesTasa.get(itemId) ?? new Set<string>();
    const deseados = new Set(tasaIds);
    let movidos = 0;
    for (const id of previos) if (!deseados.has(id)) movidos += 1;
    for (const id of deseados) if (!previos.has(id)) movidos += 1;
    this.enlacesTasa.set(itemId, deseados);
    return movidos;
  }

  async marcarImpuestoResuelto(itemId: string, defaultTaxRates: boolean | null): Promise<boolean> {
    // Una fila recien creada trae `default_tax_rates` a null, igual que en
    // la base. `is distinct from` en SQL, `!==` con null aqui: un item
    // nuevo cuyo `defaultTaxRates` es null NO cuenta como cambio.
    const previo = this.impuestoResuelto.get(itemId) ?? null;
    this.impuestoResuelto.set(itemId, defaultTaxRates);
    return previo !== defaultTaxRates;
  }

  async itemsConocidos(): Promise<ReadonlyMap<string, string>> {
    const vivos = new Map(this.preexistentes);
    for (const [clave, fila] of this.tablas.get('items') ?? []) {
      vivos.set(String(clave.split('|')[1]), String(fila.valores['name']));
    }
    return vivos;
  }

  async guardarReporte(entrada: EntradaReporte): Promise<void> {
    this.reportes.push(entrada);
  }

  /** Para afirmar sobre el estado final sin exponer las estructuras. */
  fila(tabla: string, clave: string): Record<string, unknown> | undefined {
    return this.tablas.get(tabla)?.get(clave)?.valores;
  }

  tasasDe(itemId: string): readonly string[] {
    return [...(this.enlacesTasa.get(itemId) ?? [])].sort();
  }
}
