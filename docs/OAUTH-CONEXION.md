# Conectar una sucursal con Clover

Dónde vive el callback de OAuth, **cuál es la URL exacta que hay que
registrar en el Developer Dashboard de Clover**, y qué mirar cuando una
conexión no completa.

El código está en `supabase/functions/oauth/`. El refresco posterior de los
tokens es otra cosa y está en `docs/REFRESCO-TOKENS.md`.

> **DÓNDE ESTÁ ESTO DENTRO DE LA FASE 7.** El OAuth está hecho y probado
> contra sandbox. **La Fase 7 no está cerrada**: es *Sandbox: OAuth,
> catálogo, órdenes, `print_event`, webhooks*, y de esos cinco solo el
> primero está. La Fase 8 —producción con Viva real— no empieza hasta
> terminar la 7 entera.
>
> Se dice aquí porque este documento se lee como una integración
> terminada, y no lo es: es **una quinta parte** de ella. La lista de lo
> que falta verificar está en `ARQUITECTURA-FASE-1.md` §23.

## La URL, que es lo primero

```
https://<project-ref>.supabase.co/functions/v1/oauth/callback
```

Eso es lo que se pega en **Settings → App Settings → Web Configuration →
Site URL / Default OAuth Response URL** del Developer Dashboard.

**Sin barra final.** Clover compara la cadena que le mandamos con la
registrada byte a byte: no normaliza, no perdona una barra, no acepta
`http`. Si no coinciden, el flujo muere en una pantalla de Clover, del lado
del merchant, **y en nuestros logs no aparece nada** — porque la petición
nunca llega a la función.

Para no teclearla desde este documento, la función la sirve:

```bash
curl https://<project-ref>.supabase.co/functions/v1/oauth/redirect-uri
```

Devuelve en texto plano exactamente la misma cadena que se manda en
`redirect_uri`, porque sale de la misma función (`redirect-uri.ts`).
Cópiala de ahí y pégala.

### Y una segunda, en el mismo dashboard: el Alternate Launch Path

```
https://<project-ref>.supabase.co/functions/v1/oauth/launch
```

Va en **Settings → App Settings → Web Configuration → Alternate Launch
Path**. Hoy ese campo apunta a la raíz del proyecto, y un merchant que
instale desde el App Market ve un `{"error":"requested path is invalid"}`
que parece un producto roto.

**No confundirla con el callback.** Son dos campos distintos y hacen
cosas distintas:

| | Callback (`/callback`) | Launch Path (`/launch`) |
|---|---|---|
| Cuándo lo abre Clover | al terminar el OAuth | al instalar la app o pulsar su icono |
| Qué trae | `code`, `state`, `merchant_id` | `merchant_id`, `employee_id`, `client_id` |
| Qué hace | canjea y conecta | explica, y nada más |
| ¿Comparación byte a byte? | **sí** | no |

Registrar una en el sitio de la otra es el error fácil de cometer y
difícil de ver. Las dos salen de `redirect-uri.ts` y las dos tienen una
prueba que fija su cadena.

### Qué la cambia

| Si cambia… | Pasa que… |
|---|---|
| el nombre del directorio `supabase/functions/oauth/` | cambia la URL: **hay que volver al dashboard** |
| el proyecto de Supabase (`SUPABASE_URL`) | cambia la URL: **hay que volver al dashboard** |
| se pone un dominio propio delante | se cambia `SUPABASE_URL`, nunca solo `CLOVER_REDIRECT_URL` |
| `ROUTES.callback` en `redirect-uri.ts` | cambia la URL: **hay que volver al dashboard** |
| `ROUTES.launch` en `redirect-uri.ts` | cambia el Alternate Launch Path: **hay que volver al dashboard** |

Las tres primeras filas tienen una prueba que las fija en
`__tests__/redirect-uri.test.ts`. No están para pasar: están para que
romperlas obligue a acordarse del dashboard.

## Por qué una Edge Function y no `apps/admin`

`.env.example` arrastraba `https://admin.tudominio.com/api/clover/callback`
desde el commit de andamiaje, y `SETUP-CLOUD.md` mandaba desplegar el SaaS
en Vercel "cuando llegue el callback de OAuth". Las dos cosas eran de antes
de que existiera nada de esto. La decisión, ahora:

1. **El `client_secret` ya vive en el backend de Supabase.** Es lo que
   pide `/oauth/v2/token` y lo que distingue a una app de alta confianza en
   `/oauth/v2/recovery`. Ponerlo también en Vercel es un secreto más en un
   sitio más.
2. **`apps/admin` no existe.** El diagrama de contexto lo dibuja y el
   `pnpm admin` del `package.json` lo invoca, pero el directorio no está.
   El callback no puede depender de un despliegue que aún no hay.
3. **El worker de refresco ya escribe en esa misma fila y en ese mismo
   Vault** (`workers/src/token-refresh`). Emitir el primer par en un sitio
   y rotarlo en otro parte el ciclo de vida del token entre dos
   despliegues, dos juegos de variables y dos sitios donde puede caerse a
   medias.

El diagrama de §1.2 de `ARQUITECTURA-FASE-1.md` ya listaba `/oauth` entre
las Edge Functions. Esto lo cumple. (El árbol de §16 decía
`oauth-clover/`; se corrigió a `oauth/`, porque ese nombre **es** la URL.)

## Las cuatro rutas

| Ruta | Quién la abre | Qué hace |
|---|---|---|
| `GET /functions/v1/oauth/start?t=<token>` | el merchant, desde el enlace | redirige a `authorize` de Clover con nuestro `redirect_uri` |
| `GET /functions/v1/oauth/callback` | **Clover** | canjea el `code` por el primer par y deja la sucursal `connected` |
| `GET /functions/v1/oauth/launch` | **Clover**, tras instalar del App Market | una página que explica cómo completar la conexión. **En inglés** (ver abajo). No toca la base |
| `GET /functions/v1/oauth/redirect-uri` | el operador, una vez | escupe la cadena para pegar en el dashboard |

### Las páginas van en TEXTO PLANO, y no es una elección de estilo

**Supabase no sirve HTML desde una Edge Function en el dominio por
defecto.** De sus límites: *"Serving of HTML content is only supported
with custom domains (Otherwise GET requests that return `text/html` will
be rewritten to `text/plain`)"*.

No avisa: reescribe.

| Lo que mandamos | Lo que llega al navegador |
|---|---|
| `content-type: text/html; charset=utf-8` | `content-type: text/plain` |
| — | `content-security-policy: default-src 'none'; sandbox` |

Y de ahí salen **dos destrozos que parecen dos fallos y son uno**:

1. el navegador enseña el **código fuente** en vez de la página;
2. al degradar el tipo **se cae el `charset`**, el navegador deja de
   asumir UTF-8 y `envió` se lee `enviÃ³`.

Lo segundo es lo que despista: parece un problema de codificación
independiente y es el mismo. No se arregla añadiendo `<meta charset>` —
ya estaba— porque el navegador no está leyendo el documento como HTML.

**Comprobado en producción el 2026-09-06** contra el proyecto de Viva, en
los dos hostnames (`<ref>.supabase.co/functions/v1` y
`<ref>.functions.supabase.co`): idéntico en los dos.

Lo que **sí** pasa intacto es `text/plain; charset=utf-8`, con su charset
y sin CSP añadida. Es lo que lleva sirviendo `/redirect-uri` desde el
principio, y por eso a esa ruta nunca le pasó nada. Así que las cuatro
páginas se sirven en texto plano: austero, pero legible y con los acentos
bien.

El idioma de cada página viaja en la cabecera `content-language`, ya que
no hay `<html lang>` donde ponerlo.

#### Cómo se recupera el HTML

Con un **dominio propio** (plan Pro + add-on de Custom Domain). Ese día:

1. `pagina()` en `index.ts` vuelve a emitir HTML — y con él vuelve el
   escapado, que en texto plano sería incorrecto (enseñaría `&amp;`);
2. **cambiar el dominio cambia el `redirect_uri`**, así que
   **HAY QUE VOLVER AL DASHBOARD DE CLOVER**, y también al *Alternate
   Launch Path*. Lo que se toca es `SUPABASE_URL`, nunca solo
   `CLOVER_REDIRECT_URL` (ver *Qué la cambia*).

Es una decisión con coste mensual y una visita al dashboard, así que no se
toma sola: mientras no se tome, texto plano.

### La función se despliega SIN verificación de JWT

Está en `supabase/config.toml`:

```toml
[functions.oauth]
verify_jwt = false
```

No es una relajación de seguridad, es un requisito: Clover redirige el
**navegador** del merchant a nuestro callback y no manda —ni puede mandar—
la cabecera `Authorization` que Supabase exige por defecto. Con la
verificación puesta, Clover recibe un 401 y el merchant ve una pantalla
rota.

Lo que autoriza es el `connect_token` del enlace: 32 bytes aleatorios, de
un solo uso y con caducidad. Si se despliega a mano, va con
`--no-verify-jwt`.

## El ciclo completo

```
operador                merchant                 Clover              nosotros
   │
   │ 1. app.issue_clover_connect_token(store_id)
   │──────────────────────────────────────────────────────────────────▶ fila
   │    devuelve <token>
   │
   │ 2. le manda el enlace
   │  .../functions/v1/oauth/start?t=<token>
   │───────────────▶
                     │ 3. lo abre
                     │───────────────────────────────────────────────▶ /start
                     │                                    302 con redirect_uri
                     │◀──────────────────────────────────────────────
                     │ 4. autoriza en Clover
                     │──────────────────────▶
                                              │ 5. redirige con code+state
                                              │──────────────────────▶ /callback
                                                          6. canje, Vault, fila
                                                             status = connected
                                                                       │
                     7. a partir de aquí el par lo rota el worker ─────┘
```

**El paso 1 se hace en el editor de SQL de Supabase** mientras no exista el
SaaS:

```sql
select app.issue_clover_connect_token('<store_id>'::uuid);
```

Caduca a los 7 días por defecto; el segundo argumento es un `interval`.
Emitir uno nuevo pisa el anterior.

## Lo que el callback hace y no hace

- **No reintenta el canje.** El `code` es de un solo uso: un segundo
  intento falla siempre y, si el primero llegó a emitir un par, lo deja
  vivo y sin dueño. Misma regla que el refresco.
- **No guarda un par sin `refresh_token`.** Duraría treinta minutos y
  moriría sin que nadie lo viera venir: el worker ni siquiera reclama una
  conexión sin `refresh_token_secret_id` (0013).
- **No escribe token de recuperación.** El primer par no tiene: no hubo
  ningún refresh antes que él, y la 0012 dice que `null` es el estado
  normal justo después del OAuth inicial. Aparecerá con el primer refresco.
- **No repunta una sucursal a otro merchant.** Si la fila ya tiene un `mId`
  distinto del que llega, se rechaza con 409 y **ni siquiera se canjea el
  código**: el enlace se envió a quien no era, y conectar mandaría los
  pedidos a la cocina de otro restaurante.
- **No degrada la conexión cuando alguien se equivoca de enlace.** El fallo
  se apunta en `last_error` y ya: quien está delante es alguien intentando
  conectar, no la sucursal, que puede estar vendiendo tan tranquila.
- **Escribe Vault primero y la fila después**, en un solo `update`. Al
  revés habría un instante con ids de secreto que apuntan a nada, y ahí el
  worker leería un secreto inexistente y degradaría una sucursal recién
  conectada.

### Reinstalaciones desde el App Market

Si el merchant instala la app desde el App Market de Clover en vez de
abrir nuestro enlace, el callback llega **sin `state`**. En ese caso la
conexión se busca por `merchant_id`, que solo funciona si esa sucursal ya
estuvo conectada alguna vez. Si no lo estuvo, no hay forma de saber a qué
restaurante pertenece y se le pide el enlace: adivinarlo sería peor.

## El aterrizaje del App Market (`/launch`)

> **Esto es un paso intermedio, no la solución final.** Lo definitivo está
> al final de esta sección. Si estás leyendo esto porque `apps/admin` ya
> existe, lo que toca es sustituir la página por el formulario.

Cuando un merchant instala la app desde el App Market, Clover **no** entra
por nuestro flujo: abre el *Alternate Launch Path* con `merchant_id`,
`employee_id` y `client_id`, sin `code` y **sin `state`**. Eso no es el
callback del OAuth: es donde una app normal ARRANCARÍA su OAuth.

La nuestra no puede arrancarlo ahí, y el motivo es el mismo que sostiene
todo este flujo: **el `connect_token` es la única cosa que ata un callback
a UNA sucursal.** Un aterrizaje del App Market no lo trae.

### Lo que hace la página: informar, y nada más

Agradece la instalación y explica que para completar la conexión hay que
abrir el enlace que le envió su proveedor. **Sin formulario. Sin
emparejar por `merchant_id`.** Y sin tocar la base: es la primera pantalla
que ve un merchant nuevo, así que no puede depender de que el pooler
responda.

### Las tres razones, escritas para que no se repitan

1. **No hay dónde generar códigos de invitación.** `apps/admin` no existe
   todavía. Un formulario que pida un código que nadie puede emitir es
   peor que no tener formulario.
2. **El flujo real lo inicia el operador.** El merchant no llega aquí
   buscando conectar: llega porque acaba de instalar. Quien sabe a qué
   sucursal pertenece es quien le dio de alta.
3. **El coste de equivocarse es asimétrico**, y esta es la que decide:

   | Si nos pasamos de conservadores | Si emparejamos mal |
   |---|---|
   | una página informativa confunde a alguien un momento | los tokens de un comercio acaban en la fila de otro |
   | pide un correo al operador | los pedidos de un restaurante se imprimen en la cocina de otro, y nadie lo ve hasta que pasa |

   No son comparables, así que no se elige por elegancia.

### En inglés, y las demás en español. NO UNIFICAR

`/launch` es **la única página de esta función en inglés**. Parece una
incoherencia y no lo es: es la única que funciona como **escaparate**.

| | `/start` y `/callback` | `/launch` |
|---|---|---|
| Quién las ve | alguien que **ya está en nuestro flujo** y recibió un enlace del operador | **cualquiera** que instale desde el listado público de Clover |
| Qué sabe de nosotros | le dieron de alta, hubo un correo, hay una conversación | nada: acaba de pulsar *Install* |
| Dónde está | donde el operador lo puso | Estados Unidos, y en general en inglés |

Unificar el idioma "por coherencia" es empeorar una de las dos: o el
escaparate habla en un idioma que su público no tiene por qué leer, o el
resto del flujo cambia de idioma para acompañar a una página que el
merchant ya conectado no vuelve a ver.

El `lang` del HTML va con el idioma de cada página, no es un detalle
cosmético: decide cómo lo pronuncia un lector de pantalla y si el
navegador ofrece traducir. Una página en inglés marcada `lang="es"` se
lee peor que si no llevara nada. Por eso `html()` recibe el idioma en vez
de tenerlo fijo.

Las páginas de error genéricas (404, 405, 500) siguen en español, y se
queda así a propósito: un desconocido del App Market solo llega a
`/launch`, que responde 200 y no consulta nada, así que no puede caer en
ninguna de las tres. Traducirlas sería traducir por si acaso.

**Si algún día hay que unificar de verdad**, lo que toca es i18n en las
cuatro páginas, no cambiarle el idioma a esta.

### Lo que sí se apunta

Un evento `app_market_aterrizaje` con el `merchant_id`. **No empareja
nada**: es una señal para que el operador sepa que alguien instaló y
pueda mandarle el enlace, en vez de enterarse por un correo del merchant.

No se apunta el `employee_id`: identifica a una persona y no responde a
ninguna pregunta que tengamos.

Tampoco se consulta el `merchant_id` contra la base, ni siquiera para
decir *"esta sucursal ya está conectada"*. Eso le contaría a cualquiera
que probara mIds al azar cuáles están dados de alta, a cambio de nada.

### Lo definitivo, cuando exista `apps/admin`

Esta página pasa a ser un **formulario que pide un código emitido por el
operador**. El código hace el papel que hoy hace el `connect_token` del
enlace: ata el aterrizaje a una sucursal concreta, con alguien que ha
decidido cuál. Lo que no cambia nunca es la regla — **nada conecta una
sucursal sin un ancla emitida por el operador**; lo único que cambia es si
esa ancla llega por enlace o tecleada.

Hasta entonces, esta página es la diferencia entre un producto que parece
roto y uno que dice qué falta.

## ROTAR EL APP SECRET DESCONECTA A TODOS LOS MERCHANTS

**Medido el 2026-09-06, en sandbox, con la app en Draft.** No es una
hipótesis ni una precaución teórica: pasó, y así se vio.

Se rotó `CLOVER_APP_SECRET` en el Developer Dashboard. Lo que ocurrió:

1. la app **se desinstaló del merchant**. Desapareció de su menú lateral
   de apps instaladas y volvió a salir en el App Market con botón
   *Connect*;
2. los refresh tokens quedaron **inservibles**, no por caducidad sino
   porque la app ya no estaba autorizada;
3. el worker empezó a dar `refresco_401` y dejó la conexión `degraded`.

### Por qué el síntoma engaña

`refresco_401` **parece** un problema de credenciales, y no lo es:
`/oauth/v2/refresh` no manda el App Secret (solo `client_id` y
`refresh_token`). Así que rotar el secreto **causa** el 401 pero no puede
**arreglarlo**, y volver a rotarlo tampoco. El diagnóstico entero está en
`docs/REFRESCO-TOKENS.md`, *`refresco_401`*.

### Lo que esto significa en producción

> Con N sucursales conectadas, rotar el App Secret las tira **todas a la
> vez**, y la única salida es que **cada merchant vuelva a autorizar la
> app** desde su propio Clover. No hay forma de rehacerlo desde nuestro
> lado: la autorización es suya (§0.3).

Mientras hay una sucursal en el piloto, esto es un susto de veinte
minutos. Con una cartera de restaurantes es un incidente: N llamadas, N
personas que tienen que entrar a su Clover, y N sucursales sin vender
mientras tanto.

### Procedimiento si algún día hay que rotarlo

Rotar el App Secret **no es una tarea de mantenimiento**: es una
migración con corte de servicio. Si hay que hacerlo —una filtración, por
ejemplo, que es el único motivo que lo justifica de verdad—:

1. **Avisar a los merchants ANTES**, no después. Van a tener que volver a
   autorizar, y les va a llegar como "la app dejó de funcionar" si nadie
   se lo dijo.
2. **Tener los enlaces emitidos y listos** antes de tocar el secreto: uno
   por sucursal (`app.issue_clover_connect_token`), porque después del
   corte hacen falta todos a la vez.
3. **Elegir la hora**. La sucursal no vende mientras está desconectada, y
   estas son cafeterías: no se rota a las ocho de la mañana.
4. **Rotar y desplegar el secreto nuevo** (`supabase secrets set` +
   redespliegue de las dos funciones). Comprobar con la huella del log de
   arranque que el despliegue lee el valor nuevo — ver
   `docs/REFRESCO-TOKENS.md`, *Comprobar QUÉ App Secret está leyendo el
   despliegue*.
5. **Mandar los enlaces** y acompañar sucursal por sucursal.
6. Comprobar que cada una vuelve a `connected` con
   `consecutive_failures = 0`.

Y una consecuencia de diseño que ya está resuelta: al reconectar, el
callback **corta la cadena de recuperación** (`applyInitialTokens` pone a
nulo `recovery_token_secret_id` y `recovery_token_expires_at`). Ver abajo.

### Al reconectar, la cadena de recuperación se corta

`applyInitialTokens` es un `update`, no un `insert`: una reconexión cae
sobre la fila que ya existía, con su `recovery_token_secret_id` de la
autorización **anterior**.

Ese puntero hay que anularlo, y por eso el `update` lo hace. Una
autorización nueva no tiene token previo del que recuperar — un primer
par nace sin red, que es la regla de siempre (`chain.ts`). Dejar el viejo
apuntaría a un token de una autorización que ya no existe: en el
siguiente 401 el worker gastaría una llamada probándolo, y
`recovery_token_expires_at` estaría prometiendo una ventana que no hay.

El secreto viejo queda **huérfano en Vault**. Es basura barata y se
limpia a mano, igual que el resto de huérfanos de este flujo.

**Ojo con lo que esto NO significa.** Que `recovery_token_secret_id`
aparezca poblado poco después de reconectar es **normal**: lo puebla el
worker en su primera rotación con éxito, apuntando al refresh token
inicial, que a partir de ese momento sí es un token previo de verdad. Lo
que sería un fallo es que estuviera poblado **antes** de la primera
rotación. Cómo distinguirlo, en `docs/REFRESCO-TOKENS.md`.

## Variables de entorno

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | la inyecta Supabase en toda Edge Function |
| `SUPABASE_DB_URL` | la inyecta Supabase |
| `CLOVER_APP_ID` | Developer Dashboard. Identifica la app, no es secreto |
| `CLOVER_APP_SECRET` | Developer Dashboard. **Secreto**, solo backend |
| `CLOVER_REDIRECT_URL` | *opcional*, y solo para comprobar |

`CLOVER_REDIRECT_URL` ya no configura nada: la URL se calcula a partir de
`SUPABASE_URL`. Si se pone, el arranque comprueba que sea **idéntica** a la
que la función atiende y revienta si no. Es una red contra el `.env` viejo
de alguien.

**Los hosts de Clover no se configuran por variable.** Son cuatro por
entorno y los resuelve `resolveHosts` en `packages/clover-client`
(`environments.ts`) a partir del `environment` de **la fila**, no del
despliegue: la misma función atiende sucursales en sandbox y en producción,
que durante un alta conviven.

Se cargan así:

```bash
supabase secrets set CLOVER_APP_ID=... CLOVER_APP_SECRET=...
supabase functions deploy oauth
```

## Runbook

**"Se ve el código HTML en crudo", o "salen los acentos rotos".** Es el
mismo síntoma con dos caras, y significa que alguien volvió a servir
`text/html` desde la Edge Function sin dominio propio. Ver *Las páginas
van en TEXTO PLANO*. Se confirma en un segundo:

```bash
curl -sI https://<project-ref>.supabase.co/functions/v1/oauth/launch | grep -i content-type
```

Si dice `text/plain; charset=utf-8`, está bien. Si dice `text/plain` a
secas, es que se mandó HTML y Supabase lo degradó.

**"El merchant abre el enlace y Clover da error."** Casi siempre es el
`redirect_uri`. Compara lo que devuelve `.../oauth/redirect-uri` con lo
registrado en el dashboard, carácter a carácter, mirando la barra final.

**"Clover devuelve al merchant pero no pasa nada."** Mira si la función
está desplegada con `verify_jwt = false`. Un 401 en los logs de la función,
sin ningún evento nuestro, es exactamente ese síntoma.

**"Enlace no válido" o "caducado".** El enlace es de un solo uso y se
consume al conectar. Emite otro con `app.issue_clover_connect_token`.

**"Comercio distinto" (409).** La sucursal ya estaba asociada a otro `mId`.
No es un fallo técnico: o el enlace se envió a quien no era, o de verdad
hay que mover la sucursal de merchant, y eso se hace a mano y a sabiendas.

**`oauth_secretos_huerfanos` en los logs.** El canje salió bien, los
secretos se crearon y el `update` de la fila falló. Los ids están en el
log. **No se borran solos a propósito**: si lo que falló fue solo la
confirmación y el `update` sí entró, borrarlos deja la fila apuntando a
secretos que ya no existen, o sea la sucursal muerta el día que estrena.
Mira primero si la conexión quedó `connected`; si no, borra esos dos
secretos de Vault y que el merchant vuelva a abrir un enlace nuevo.

## Confirmado contra el sandbox (2026-09-05)

Primer OAuth real completado contra el Test Merchant `RGW5JAVFT8MB1`. La
conexión quedó en `connected`. Lo que se aprendió, que hasta ahora eran
suposiciones leídas de la documentación:

- **`access_token_expiration` sí viene** en la respuesta del canje. O sea
  que la caducidad que se guarda es la real de Clover, no el valor de
  reserva de `accessTokenExpiryFrom`.
- **El access token duró ~24 h**, no los 30 minutos documentados. No
  afecta al margen del worker y la constante no se cambia; el porqué está
  en `docs/REFRESCO-TOKENS.md`, *La vida real del token, medida*.
- **El callback trae un parámetro más de los previstos: `employee_id`**,
  que dice qué empleado de Clover autorizó. No rompe nada: aquí se leen
  `code`, `merchant_id`, `state` y `error` con `searchParams.get`, y lo
  que no está en esa lista se ignora sin más. No se guarda en ningún
  sitio. Si algún día hace falta saber quién autorizó, ahí está.
- **`granted_permissions` quedó vacío**, como estaba previsto: Clover no
  los devuelve en el canje.

## Lo que queda pendiente

- **El formulario del aterrizaje del App Market.** La parte de "que no
  parezca roto" ya está: `/launch` sirve una página informativa, y arriba
  está el porqué (*El aterrizaje del App Market*). Lo que falta es lo
  definitivo, y **depende de `apps/admin`**: un formulario que pida un
  código emitido por el operador, que haga el papel que hoy hace el
  `connect_token` del enlace.

  Mientras tanto, para el piloto de una sucursal no estorba: el operador
  manda el enlace y `/start` funciona con la app ya instalada.

  **Queda sin registrar en el dashboard hasta que alguien lo pegue.** El
  Alternate Launch Path sigue apuntando a la raíz del proyecto hasta que
  se cambie a mano en *Settings → App Settings → Web Configuration*. Este
  código no lo cambia solo.
- **`clover_connections.api_base_url`** es anterior a `environments.ts` y
  hoy no la lee nadie: los cuatro hosts salen de `environment`. El callback
  no la escribe, para no repetir la tabla de hosts fuera de su sitio
  (§13.1). Toca quitarla en una migración.
- **Emitir el enlace desde el SaaS** en vez del editor de SQL, cuando
  `apps/admin` exista.
- **Los permisos concedidos** (`granted_permissions`) no se rellenan aquí:
  Clover no los devuelve en el canje. Salen del checklist de onboarding
  (`packages/clover-client/src/onboarding.ts`), que es otra pasada.
