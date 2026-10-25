/**
 * Flujo v2/OAuth: el merchant autoriza, nosotros canjeamos.
 *
 * QUIÉN AUTORIZA
 * El merchant, nunca el super admin (§0.3 de la arquitectura). El super
 * admin no tiene credenciales de Clover del merchant y no puede
 * conseguirlas: lo único que puede hacer es mandarle el enlace.
 *
 * QUÉ DURA CUÁNTO
 *   access_token   30 minutos
 *   refresh_token   de un solo uso: al usarlo, el anterior muere
 *
 * Que el refresh sea de un solo uso tiene una consecuencia que se paga
 * cara si se descubre tarde: DOS refrescos en paralelo para el mismo
 * merchant se pisan y dejan la conexión muerta. La exclusión mutua es cosa
 * del worker de la PR 2, pero se avisa aquí porque es donde se mira.
 *
 * DÓNDE VIVEN ESTOS ENDPOINTS — RESUELTO
 * Esto estuvo marcado como contradicción de la documentación. No lo era:
 * eran dos páginas casi homónimas, una del flujo de plataforma y otra del
 * de ecommerce, que dicen lo mismo. La tabla "Sandbox and production
 * environment URLs" aparece idéntica en las tres páginas del flujo
 * v2/OAuth y reparte así:
 *
 *   /oauth/v2/authorize   sandbox.dev.clover.com      www.clover.com
 *   /oauth/v2/token       apisandbox.dev.clover.com   api.clover.com
 *   /oauth/v2/refresh     apisandbox.dev.clover.com   api.clover.com
 *
 * Es decir: `authorize` en el host web, canje y refresco en el de
 * plataforma. Que es lo que este fichero ya hacía.
 *
 * De dónde salió el `www.clover.com/oauth/v2/token` que parecía
 * contradecirlo: de la página del flujo LEGACY, y ahí el ejemplo es de
 * `/oauth/v2/authorize`, no de `/oauth/v2/token`. Se leyó mal el path. En
 * producción `www.clover.com` sirve `authorize` y nada más.
 *
 * RECUPERACIÓN — `/oauth/v2/recovery`
 * El cuarto endpoint, que no estaba en el inventario original. Si se
 * pierde el `refresh_token` actual, una app de alta confianza puede
 * canjear el refresh INMEDIATAMENTE ANTERIOR por un par nuevo. Al usar el
 * token A para obtener el B, A queda como token de recuperación de B.
 *
 * Importa porque cambia el peor caso del refresco: si el par nuevo se
 * pierde entre que Clover lo emite y nosotros lo persistimos, la conexión
 * del merchant NO está muerta. Hay ventana, y son dos semanas desde que se
 * generó el refresh actual; pasadas, solo queda rehacer el OAuth entero.
 * Requiere `client_secret` y vive en el host de plataforma. Lo usa el
 * worker de refresco (`workers/src/token-refresh`), que es quien sabe
 * QUÉ token mandar; aquí solo se manda.
 *
 * Fuentes verificadas: docs/CLOVER-ENDPOINTS.md
 */

import type { CloverHttp } from '../http.ts';
import type { CloverTokenPair } from '../types.ts';

export interface AuthorizeUrlParams {
  /** App Id del Developer Dashboard. */
  readonly appId: string;
  /**
   * Tiene que coincidir EXACTAMENTE con la url registrada en el
   * dashboard. Clover no perdona una barra final de más.
   */
  readonly redirectUri: string;
  /** Anti-CSRF. Sin esto, cualquiera puede completar el flujo por ti. */
  readonly state: string;
}

export class CloverOAuth {
  /**
   * `app` porque estas llamadas todavía no tienen merchant: el merchant
   * es justo lo que se está averiguando. Comparten cubo de limitador.
   */
  private static readonly RATE_KEY = 'app:oauth';

  private readonly http: CloverHttp;

  constructor(http: CloverHttp) {
    this.http = http;
  }

  /**
   * La url a la que se manda al merchant. No hace ninguna petición: es
   * una url que se construye y se abre en su navegador.
   */
  authorizeUrl(params: AuthorizeUrlParams): string {
    const u = new URL(`${this.http.hosts.oauth}/oauth/v2/authorize`);
    u.searchParams.set('client_id', params.appId);
    u.searchParams.set('redirect_uri', params.redirectUri);
    u.searchParams.set('state', params.state);
    return u.toString();
  }

  /**
   * Canjea el código de autorización por el primer par de tokens.
   *
   * El `appSecret` entra por parámetro y no se guarda en ningún sitio de
   * este paquete: viene de una variable de entorno del backend y muere al
   * salir de la función.
   */
  async exchangeCode(input: {
    readonly appId: string;
    readonly appSecret: string;
    readonly code: string;
  }): Promise<CloverTokenPair> {
    return this.http.request<CloverTokenPair>({
      api: 'platform',
      method: 'POST',
      path: '/oauth/v2/token',
      auth: { kind: 'none' },
      priority: 'transactional',
      rateKey: CloverOAuth.RATE_KEY,
      body: {
        client_id: input.appId,
        client_secret: input.appSecret,
        code: input.code,
      },
    });
  }

  /**
   * Renueva el par de tokens.
   *
   * SIN reintento a propósito: el refresh es de un solo uso, así que un
   * segundo intento con el mismo token fallaría siempre y, peor, podría
   * invalidar el par que el primer intento sí llegó a crear. Si esto
   * falla, se vuelve a intentar desde cero con el token que haya guardado,
   * no reintentando esta petición.
   */
  async refresh(input: {
    readonly appId: string;
    readonly refreshToken: string;
  }): Promise<CloverTokenPair> {
    return this.http.request<CloverTokenPair>({
      api: 'platform',
      method: 'POST',
      path: '/oauth/v2/refresh',
      auth: { kind: 'none' },
      priority: 'transactional',
      rateKey: CloverOAuth.RATE_KEY,
      body: {
        client_id: input.appId,
        refresh_token: input.refreshToken,
      },
    });
  }

  /**
   * La red de seguridad: canjea un refresh token YA GASTADO por un par
   * nuevo.
   *
   * CUÁNDO SIRVE
   * Cuando el par que Clover emitió se perdió antes de que lo
   * guardásemos. El token que se manda aquí es el que se usó para
   * generarlo, que Clover mantiene vivo como token de recuperación hasta
   * que un refresh se use con éxito.
   *
   * QUÉ TOKEN MANDAR NO SE DECIDE AQUÍ
   * Es la parte difícil y depende del estado guardado, no de la API: lo
   * resuelve `workers/src/token-refresh/chain.ts`. Este método solo pone
   * el token en el cuerpo y lo manda al host de plataforma.
   *
   * LLEVA EL APP SECRET, A DIFERENCIA DEL REFRESCO
   * Es lo que hace que solo las apps de alta confianza puedan recuperar.
   * Igual que en `exchangeCode`, entra por parámetro, viene de una
   * variable de entorno del backend y no se guarda en este paquete.
   *
   * SIN REINTENTO, por lo mismo que `refresh`: si Clover llegó a emitir un
   * par y perdimos la respuesta, un segundo intento con el mismo token
   * mataría el par recién creado. El `POST` sin `idempotencyKey` no se
   * reintenta (ver `http.ts`), y eso aquí es la garantía.
   */
  async recovery(input: {
    readonly appId: string;
    readonly appSecret: string;
    readonly refreshToken: string;
  }): Promise<CloverTokenPair> {
    return this.http.request<CloverTokenPair>({
      api: 'platform',
      method: 'POST',
      path: '/oauth/v2/recovery',
      auth: { kind: 'none' },
      priority: 'transactional',
      rateKey: CloverOAuth.RATE_KEY,
      body: {
        client_id: input.appId,
        client_secret: input.appSecret,
        refresh_token: input.refreshToken,
      },
    });
  }
}
