# Refresco de tokens de Clover

Qué hace el worker de `workers/src/token-refresh`, por qué está hecho así,
y qué mirar cuando una sucursal aparece en `DEGRADED`.

Fuentes de todo lo que se afirma aquí: `docs/CLOVER-ENDPOINTS.md`,
`supabase/migrations/0012_recovery_token.sql` y
`supabase/migrations/0013_refresh_lease.sql`.

## El problema, en tres líneas

La documentación de Clover dice que el access token dura **30 minutos**;
medido en sandbox duró **~24 horas** (ver *La vida real del token,
medida*). El refresh token es de **un solo uso**: al canjearlo, muere. Y no hay nada en Clover que avise de que
una conexión se quedó sin tokens: se descubre cuando un cliente intenta
pagar.

## Lo que hace el worker

Cada 5 minutos (pg_cron) reclama las conexiones cuyo access token caduca
dentro de los próximos 10 minutos y rota su par. Los números viven en
`policy.ts` y no son arbitrarios:

| | | por qué |
|---|---|---|
| vida del access token | 30 min | lo que documenta Clover; medido ~24 h en sandbox, y la constante no se cambia — ver abajo |
| margen | 10 min | para que quepan **dos** intentos antes de caducar |
| periodo | 5 min | dos vueltas dentro del margen |
| lote | 50, en trozos de 5 | el techo de 50 req/s es de la app y lo comparte con gente pagando |
| arriendo | 2 min | ver *Exclusión mutua* |
| backoff | 1, 2, 4… 30 min | se escribe en el propio arriendo |

Si alguien toca esos números hasta que en el margen quepa un solo intento,
una única ejecución fallida —un despliegue, un 500 de Clover— deja la
sucursal sin token. Hay una prueba que lo impide en silencio:
`policy.test.ts`, *"EN EL MARGEN CABE MAS DE UN INTENTO"*.

### La vida real del token, medida

El 2026-09-05 se completó el primer OAuth real contra el Test Merchant de
sandbox (`RGW5JAVFT8MB1`). El canje **sí devolvió**
`access_token_expiration`, y la caducidad guardada quedó a **~24 horas**,
no a los 30 minutos que documenta Clover.

**Eso no mueve el margen, y la constante se queda en 30 minutos.** El
motivo es que `ACCESS_TOKEN_TTL_MS` no decide cuándo se refresca: lo que
se guarda es la caducidad que manda Clover, y el claim de la 0013 compara
contra esa fecha (`access_token_expires_at <= now + margen`). Los 30
minutos solo se usan como **valor de reserva**, para cuando
`access_token_expiration` no viene.

Y a un valor de reserva le conviene quedarse corto, porque los dos errores
no cuestan lo mismo:

    asumir 30 min y que duren 24 h  ->  refrescamos a los 20 minutos:
                                        gasto de rotaciones, sin riesgo
    asumir 24 h y que duren 30 min  ->  el refresco se programa casi un día
                                        tarde, el token muere y la sucursal
                                        se cae

Además la medición es de **sandbox**, y no está confirmado que producción
se comporte igual. Ojo con una cosa si algún día se plantea subirla: el
aserto de `policy.test.ts` no avisaría, porque subir el TTL hace
`REFRESH_MARGIN_MS < ACCESS_TOKEN_TTL_MS / 2` *más* cierto, no menos.

Lo que sí cambia en la práctica: con 24 horas de vida las rotaciones bajan
de ~48 al día a ~1. Menos rotaciones es menos exposición a la carrera del
refresh de un solo uso, así que el efecto es a favor.

### Si hace falta más holgura: se baja el periodo, no se sube el margen

`WORKER_PERIOD_MS` es el punto de ajuste. Los dos números dan más
intentos, pero no cuestan lo mismo:

| cambio | qué da | qué cuesta |
|---|---|---|
| periodo 5 → 2 min | 5 intentos en el mismo margen | consultas de claim contra un índice parcial, casi todas con cero filas |
| margen 10 → 15 min | 1 intento más | cada token se usa la mitad de su vida: **el doble** de rotaciones, de secretos en Vault y de llamadas a `/refresh` |

Y hay un motivo más para no tocar el margen: cada rotación es una
oportunidad de perder un par entre que Clover lo emite y lo guardamos.
Rotar el doble de veces duplica esa exposición para ganar un intento
contra un fallo que se arregla solo en la vuelta siguiente.

**Por qué se queda en 5 minutos de momento.** Porque quedarse sin margen
**no mata la conexión**: el access token caducado no invalida el refresh
—la cadena de recuperación es de dos semanas—, así que el coste de llegar
tarde es que esa sucursal no pueda hablar con Clover durante como mucho
una vuelta, y se arregla sola en la siguiente. El margen protege
*disponibilidad*, no *recuperabilidad*. Con el piloto de una sola sucursal
y sin tráfico real ese coste es aceptable, y afinar antes sería afinar a
ciegas: se ajusta con datos —cuántas vueltas se saltaron de verdad, cuánto
tarda Clover en el peor percentil— cuando el piloto lleve semanas
operando.

## Cómo se dispara

La lógica de arriba no se ejecuta sola. La cadena entera, de punta a
punta:

```
pg_cron  ──cada 5 min──▶  app.run_token_refresh_worker()      (migración 0015)
                                  │ net.http_post  (pg_net)
                                  ▼
                         POST /functions/v1/token-refresh     (Edge Function)
                                  │
                                  ▼
                         runTokenRefresh(...)                 (workers/src)
                                  │
                                  ▼
                         app.claim_clover_connections_for_refresh()  (0013)
```

**Por qué una llamada HTTP y no SQL a secas.** Lo que hay que ejecutar
habla con Clover: dos llamadas con timeout, limitador de 50 req/s y
breakers. Eso no cabe en una función de Postgres, y meterlo ahí sería
reescribir en PL/pgSQL una lógica que ya está probada sin red y sin base.
`pg_cron` dispara, `pg_net` llama, y la vuelta la da la Edge Function.

### Lo que hace falta una vez

| | Dónde | Qué |
|---|---|---|
| extensiones | Dashboard → Database → Extensions | `pg_cron` y `pg_net` |
| secreto | `supabase secrets set` | `WORKER_CRON_SECRET` |
| el mismo secreto | editor de SQL | `app.configure_token_refresh_worker(...)` |

```bash
# 1. El secreto. Es lo único que protege el endpoint (ver más abajo).
openssl rand -base64 32

# 2. Al lado de la función. CLOVER_APP_ID y CLOVER_APP_SECRET ya están
#    puestos desde el OAuth: los secretos son del proyecto, no de cada
#    función.
supabase secrets set WORKER_CRON_SECRET='<el de arriba>'

# 3. La función.
supabase functions deploy token-refresh
```

```sql
-- 4. El otro extremo del mismo cable. Guarda en Vault la URL y el
--    secreto, y deja el pg_cron programado. Es idempotente.
select app.configure_token_refresh_worker(
  'https://<project-ref>.supabase.co',   -- solo el origen, sin ruta ni barra
  '<el mismo secreto>'
);
```

La migración **ya deja el trabajo programado** aunque no se haya
ejecutado el paso 4. Es a propósito: así lo que falta se ve como un fallo
cada cinco minutos en `cron.job_run_details`, con el mensaje que dice qué
ejecutar. Al revés —programarlo solo al configurar— un despliegue donde se
olvide el paso manual se vería exactamente igual que uno correcto: en
silencio, que es el modo de fallo que este cableado existe para evitar.

### Comprobar que corre

```sql
select * from app.token_refresh_worker_status();
```

Una fila con las cuatro cosas que pueden estar mal por separado:

| columna | qué mirar |
|---|---|
| `configurado` | `f` = falta el paso 4 |
| `cron_programado` / `cron_activo` | `f` = falta `pg_cron`, o alguien lo desprogramó |
| `ultima_peticion` | más de 5 minutos atrás = el cron no está disparando |
| `ultimo_codigo` | `200` bien; `401` los dos secretos no coinciden; `500` la vuelta reventó |
| `ultima_respuesta` | el recuento de la última vuelta, tal cual |

`cron.job_run_details` **no basta**: solo dice si el `select` salió bien, o
sea si la petición se *encoló*. Una Edge Function que contesta 500 cada
cinco minutos se ve ahí exactamente igual que una que va bien. Por eso la
0015 apunta el id de cada petición en `app.token_refresh_runs` y `status()`
lo cruza con `net._http_response`.

Y sin tocar ninguna conexión, para verificar el despliegue y el secreto:

```bash
curl -sS -H "Authorization: Bearer $WORKER_CRON_SECRET" \
  https://<project-ref>.supabase.co/functions/v1/token-refresh
# {"ok":true,"cronEsperado":"*/5 * * * *","periodoMs":300000,"intentosDentroDelMargen":2}
```

Es un `GET`. El `POST` es el que da una vuelta de verdad.

### Quién puede disparar el worker

La función se despliega con `verify_jwt = false`, igual que `oauth`, **y
por un motivo distinto**. En `oauth` es un requisito: Clover redirige un
navegador y no puede mandar la cabecera. Aquí quien llama es `pg_net`,
desde nuestra propia base, y podría mandar lo que le dijéramos. La razón
es otra:

> la comprobación del gateway la pasa **cualquier** clave del proyecto, y
> la anónima es pública — viaja dentro del APK.

O sea que `verify_jwt = true` no autorizaría nada: dejaría entrar a
cualquiera con la app instalada, y encima obligaría a guardar una segunda
credencial en la base para que el cron la mandase. Así que la puerta es
nuestra, y es `WORKER_CRON_SECRET`: un secreto que existe solo para esto.

**Qué pasa si ese secreto se filtra.** Poco, y decirlo explica por qué no
hace falta más: quien lo tenga puede pedir vueltas del worker antes de
tiempo. No lee nada —la respuesta es un recuento, sin tokens, sin ids de
Vault y sin ids de conexión— y no rota nada que no tocara: el claim de la
0013 solo devuelve conexiones cuyo access token caduca dentro del margen,
así que una vuelta de más no encuentra trabajo. Comparado con mandar la
clave `service_role` en cada tic, que es la receta habitual, esto es una
credencial de un solo uso y sin poder.

### El periodo está escrito en dos idiomas

`WORKER_PERIOD_MS` en `policy.ts` y la expresión de cron en la 0015. Los
dos tienen que decir lo mismo y nada lo obliga, así que hay una prueba que
**abre la migración y la lee**
(`supabase/functions/token-refresh/__tests__/schedule.test.ts`).

No es celo. `policy.ts` razona sobre cuántos intentos caben dentro del
margen, y hay un aserto que lo protege — pero es un aserto sobre la
constante, no sobre lo que dispara. Bajar el periodo en TypeScript y dejar
el cron en cinco minutos deja `policy.test.ts` verde y la invariante sin
proteger nada, en silencio.

## Exclusión mutua: por qué hay un arriendo

Dos refrescos en paralelo sobre la misma conexión no se estorban, se
matan: el primero canjea A y recibe B; el segundo llega con A ya gastado y
se lleva un 401. Basta con que una ejecución de pg_cron tarde más que su
periodo, o con que haya dos instancias durante un despliegue.

`clover_connections.refresh_lease_until` (0013) lo impide, y la reserva va
en el **mismo statement** que la selección
(`app.claim_clover_connections_for_refresh`): si fueran dos, entre uno y
otro cabe la otra ejecución.

No se usa `pg_advisory_lock` porque es de sesión y el pooler de Supabase en
modo transacción recicla la sesión entre transacciones. Un arriendo con
fecha en la fila no depende de la sesión, se ve desde SQL, y caduca solo si
el worker muere a media faena.

## La red de seguridad

### El accidente que cubre

```
la fila dice   vigente = A,  recuperación = Z
mandamos A a /oauth/v2/refresh
Clover emite B  →  y en ese instante A queda como recuperación de B, y Z muere
nos caemos ANTES de guardar B
la fila sigue diciendo   vigente = A,  recuperación = Z
```

Sin red, ahí la conexión está muerta y hay que llamar al restaurante para
que vuelva a autorizar la app. Con red, se canjea el refresh **anterior**
en `POST {platform}/oauth/v2/recovery` y sale un par nuevo sin tocar al
merchant. La ventana son dos semanas.

### Con qué token se recupera: lo menos obvio de todo esto

`/oauth/v2/recovery` quiere "el refresh token anterior". Lo natural es
mandar `recovery_token_secret_id`, y en el ejemplo de la documentación es
lo correcto. **Pero en el accidente de arriba no lo es**: para Clover el
par actual es B, y su token de recuperación es A — o sea, justo lo que
nosotros tenemos apuntado como **vigente**. Z, que es lo que tenemos
apuntado como de recuperación, lo mató el refresco que sí funcionó.

Un worker que en el 401 mandase solo el token apuntado fallaría en el único
escenario para el que se construyó la red. Por eso se prueban los dos, y el
vigente primero:

1. **el vigente**, que cubre el accidente de arriba;
2. **el apuntado**, que cubre el otro caso: que el par nuevo se guardara
   bien y sea el secreto del vigente lo que se perdió o no se puede leer.

Mandar un token que no toca cuesta una llamada y un 401. No intentarlo
cuesta la tienda.

### Y cuál pasa a ser el de recuperación

**Son dos reglas, una por endpoint, y las implementa una sola línea.**

| endpoint | se manda | se recibe | recuperación queda | ventana |
|---|---|---|---|---|
| `/oauth/v2/refresh` | A | B | **el que se acaba de consumir: A** | ahora + 2 semanas |
| `/oauth/v2/recovery` | A | C | **el Token A original** (B muere) | ahora + 2 semanas |

La formulación tentadora —*«el de recuperación es el que acabo de
sustituir»*— es correcta por casualidad en la primera fila y **falsa** en
la segunda: ahí lo que se sustituye es B, que ya no vale para nada.
Escribirla deja la conexión sin red justo después del susto en el que se
usó.

### La ventana sí se reancla, y el puntero no. Son dos reglas

Es la línea de la tabla que más gente lee mal, porque las dos reglas viven
en las mismas dos columnas y hacen cosas distintas:

- el **puntero** (`recovery_token_secret_id`) es el token que se mandó, y
  al recuperar **no se mueve**: A → C deja la recuperación en A;
- la **ventana** (`recovery_token_expires_at`) cuelga del **par actual**, y
  al recuperar **se estrena entera**: el par C acaba de nacer.

**Esto era al revés hasta la 0016.** La documentación pública admite las
dos lecturas —"dos semanas desde que se generó el par **actual**" frente a
"the chain continues until a refresh token is successfully used"— y no se
podía medir sin perder un refresh a propósito y esperar dos semanas, así
que se tomó la pesimista y la 0012 la impuso con un trigger. Developer
Relations de Clover confirmó que la ventana se ancla a la hora de creación
de cada par nuevo: `0016_recovery_window_reanclada.sql` quita el trigger y
`chain.ts` calcula `ahora + 2 semanas` por los dos caminos.

Lo que costaba la lectura vieja: una conexión que sobrevive a base de
recuperaciones encadenadas arrastraba una fecha cada vez más vieja, el SaaS
la enseñaba vencida, y el operador llamaba al restaurante a rehacer un
OAuth que no hacía falta.

Ya no hay ningún trigger detrás. Lo único que queda entre un plan mal
calculado y la fila es `chainViolation()`, que para las dos formas de
romper la cadena: apuntar la recuperación al par recién emitido —el fallo
de la familia de `applyInitialTokens`— y borrar de Vault el secreto que en
ese mismo instante ha pasado a ser la red.

### Clover aclaró: eran dos rutas, no una contradicción

**Resuelto el 2026-09-16.** Durante unos días este documento decía que
Clover se había contradicho. No se había contradicho: las dos respuestas
hablaban de **endpoints distintos**, y leerlas como una sola regla fue el
error.

> *"Persist the most recently consumed refresh token during standard daily
> refreshes. Only retain Token A as the recovery token when a recovery
> flow is specifically triggered."*

- [docs.clover.com/dev/docs/refresh-access-tokens#reauthenticate-with-a-recovery-token](https://docs.clover.com/dev/docs/refresh-access-tokens#reauthenticate-with-a-recovery-token)
- [docs.clover.com/dev/docs/high-trust-app-auth-flow](https://docs.clover.com/dev/docs/high-trust-app-auth-flow)

Y donde se creyó ver el conflicto —encadenar recuperaciones— las dos
decían lo mismo, porque allí siempre se manda A.

#### Por qué una sola línea basta para las dos reglas

`planChain` escribe *«recuperación := el token que se mandó»* sin mirar la
ruta, y eso satisface las dos. No por casualidad:

- **en `/refresh`** se manda el vigente, y una llamada que triunfa
  **consume** lo que mandó. «El que se mandó» y «el más recientemente
  consumido» son el mismo token;
- **en `/recovery`** el endpoint **solo acepta el Token A**. Cualquier otro
  candidato se lleva un 401 y no llega a escribirse nada. Así que un
  `/recovery` que triunfa demuestra que lo que se mandó era A.

La segunda es la que hay que tener presente antes de tocar `chain.ts`: la
línea única no es una simplificación que dé la casualidad de valer, es que
en la ruta de recuperación **no existe** un token distinto de A que pueda
llegar hasta ese punto.

No hizo falta cambiar el código: ya se comportaba así en las dos rutas. Lo
que cambió es que ahora hay **una prueba por ruta**, con las palabras de la
aclaración, en vez de una sola que las mezclaba.

#### El seguro sigue puesto, y el motivo cambió

`CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO` se puso el 2026-09-12 porque no
se sabía si borrar el token desplazado era correcto. **Ahora se sabe que
sí lo es**, y aun así el seguro se queda.

El motivo es otro desde el 16: **`/oauth/v2/recovery` no se ha ejercido
nunca de verdad**. Todo lo que sabemos de esa ruta viene de leer
documentación y de pruebas con un Clover de mentira. Cuando se recorra una
recuperación real contra el sandbox, se decide con datos.

**Quien venga a quitarlo:** no basta con «Clover ya contestó». Hace falta
haber recorrido una recuperación real. Y al quitarlo hará falta un barrido
de huérfanos — ver *Barrer los secretos huérfanos de Vault*.

### La cabecera manda sobre nuestra fecha

Cuando un refresco falla con 401 y queda red, Clover lo dice:

```
X-Clover-Recovery-Available: true
```

`recovery_token_expires_at` es una estimación **nuestra**, con nuestro
reloj, sobre una fecha que Clover no devuelve. Así que:

- **nunca** decide no intentar la recuperación. Se intenta siempre, y que
  conteste Clover;
- sirve para **avisar** (el SaaS la enseña como `recovery_available_until`)
  y para **limpiar**;
- y sus tres estados son tres, no dos: que la cabecera **no venga** no es
  que diga `false`. Solo se borran las columnas de recuperación cuando
  Clover dice que no queda red con esas palabras. Si algún día deja de
  mandar la cabecera en algún 401, colapsarlas tiraría la red de una
  conexión sana.

## El orden de escritura, y por qué importa

```
1. el refresh NUEVO va a un secreto NUEVO de Vault
   (el del vigente no se toca: es el token de recuperación desde que se mandó)
2. el access se sobrescribe en sitio, que no tiene red que conservar
3. UN SOLO update mueve todos los punteros a la vez
4. y solo entonces se borra lo que dejó de referenciarse
```

Si algo se rompe entre el 1 y el 3, la fila se queda como estaba y el
refresh anterior sigue entero en Vault — que es exactamente el token con el
que la vuelta siguiente recupera. El precio es un secreto huérfano en
Vault: basura a cambio de que no haya un solo instante en el que la
conexión no tenga con qué volver.

Qué se borra no es una lista de casos, es una resta: *lo que la fila
referenciaba antes* menos *lo que referencia después*. De ahí sale solo que
en un refresco A→B se borra el de recuperación viejo y **no** se borra A, y
que en una recuperación A→C se borra B y **no** se borra A.

## Runbook

### "¿Está corriendo?"

`select * from app.token_refresh_worker_status();` y de ahí a la tabla:

| lo que se ve | qué pasó | qué hacer |
|---|---|---|
| `configurado = f` | falta el paso manual | `app.configure_token_refresh_worker(...)` |
| `cron_programado = f` | `pg_cron` no está activo, o alguien desprogramó el trabajo | activarlo en el dashboard y volver a `configure` |
| `cron_activo = f` | el trabajo existe pero está pausado | `select cron.alter_job((select jobid from cron.job where jobname='token-refresh'), active := true);` |
| `ultima_peticion` vieja | el cron no dispara | mirar `cron.job_run_details`, ahí sale el error del `select` |
| `ultimo_codigo = 401` | los dos secretos no coinciden | volver a poner el mismo en `supabase secrets set` **y** en `configure` |
| `ultimo_codigo = 500` | la vuelta reventó entera | logs de la Edge Function: `vuelta_no_completada` |
| `ultimo_error = 'timeout'` | la vuelta tardó más de 2 minutos | mirar latencia de Clover; no es pérdida de datos, se retoma sola |
| todo bien y aun así nada rota | no había trabajo | es lo normal: solo se reclama lo que caduca dentro del margen |

**Un access token caducado NO mata la conexión.** Si el worker estuvo
parado y alguna sucursal se quedó sin access token vigente, no hay que
rehacer el OAuth: el refresh token sigue vivo, la cadena de recuperación
es de dos semanas, y la primera vuelta del worker la recupera sola. Lo que
se pierde mientras tanto es *disponibilidad* —esa sucursal no puede hablar
con Clover— no *recuperabilidad*. Lo único que obliga a rehacer el OAuth
es `red_de_recuperacion_perdida`, abajo.

### "¿Se ha caído el worker sin que nadie lo note?"

`app.token_refresh_worker_status()` mira el **disparador**. Esta consulta
mira el **resultado**, que no es lo mismo: un worker que corre, contesta
`200` y no consigue rotar ni una conexión se ve idéntico a uno sano.

```sql
select * from public.clover_refresh_stale;
```

**Cero filas = no hay nada que hacer.** Una fila por instalación cuyo
último refresco con éxito tiene más de `app.refresh_staleness_threshold()`
(7 días), ordenadas por la más abandonada primero:

| columna | para qué |
|---|---|
| `dias_sin_refrescar` | cuánto margen queda. `infinity` = nunca se ha rotado |
| `last_refresh_success_at` | la última vez que Clover emitió un par para esta conexión |
| `recovery_available_until` | cuándo se cierra la red, si nadie la toca |
| `last_error` / `last_error_at` | si además está fallando, por qué |

Lo mismo, como bandera por conexión, está en `clover_connection_status`:

```sql
select store_id, refresh_stale, last_refresh_success_at
  from public.clover_connection_status;
```

#### Por qué 7 días, y por qué se calcula en vez de guardarse

Siete días es la mitad de la ventana de recuperación de Clover: el punto
en el que todavía queda margen de sobra para arreglarlo sin llamar al
restaurante. Con el worker rotando cada 5 minutos, una conexión sana no se
acerca ni de lejos — para llegar ahí tienen que fallar unas 2.000 vueltas
seguidas.

`last_refresh_success_at` la escriben **las tres rutas que generan un par**,
y ninguna más:

| ruta | dónde |
|---|---|
| canje inicial de OAuth | `applyInitialTokens`, `supabase/functions/oauth/postgres.ts` |
| refresco estándar | `applyRotation`, `workers/src/token-refresh/postgres.ts` |
| recuperación | la misma `applyRotation`: un par recuperado es un par bueno |

El canje de OAuth cuenta porque **es** la generación de un par: el primero,
pero un par. Sin él, una sucursal recién conectada sale `refresh_stale` desde
el minuto cero —la regla es "null cuenta como obsoleta", y con razón, porque
en una conexión vieja null significa que el worker no la ha tocado nunca—.
El worker lo corregiría en cinco minutos, pero una detección que enseña en
rojo cada sucursal recién conectada es una detección que el operador aprende
a ignorar, y entonces deja de detectar también lo que importa.

Un **fallo** no deja marca por ninguna de las tres rutas. Si la dejara, una
conexión que falla cada cinco minutos se vería eternamente fresca.

Y `refresh_stale` **no se guarda en ninguna columna**: se deriva en cada
consulta a partir de `last_refresh_success_at`, que solo se escribe cuando
algo va **bien**. Es deliberado. El modo de fallo que esto vigila es "dejó
de ejecutarse algo" —Supabase pausado, `pg_net` roto, el secreto del cron
rotado a medias—, y un detector que también tuviera que ejecutarse para
marcar compartiría el punto de fallo con lo que vigila: nadie marcaría
nada, y la ausencia de alertas se leería como salud. Aquí una instalación
aparece obsoleta **justamente porque no se ejecutó nada**, y la consulta
sigue siendo cierta aunque la base lleve meses parada.

#### Qué hacer cuando aparece una fila

1. `select * from app.token_refresh_worker_status();` — casi siempre el
   disparador está parado, y arriba está la tabla de qué hacer con cada
   síntoma;
2. si el disparador está bien, mirar los logs de la Edge Function de esa
   conexión: `refresco_401`, `recuperacion_401`, `conexion_degradada`;
3. **no** rehacer el OAuth por ver una fila aquí. Mientras
   `recovery_available_until` esté en el futuro, la primera vuelta buena
   del worker la recupera sola. Rehacer el OAuth es la salida de
   `red_de_recuperacion_perdida`, y solo de esa.

### `refresco_401` — y lo primero que hay que saber

**`/oauth/v2/refresh` NO manda el App Secret.** Manda `client_id` y
`refresh_token`, y nada más (`endpoints/oauth.ts`, y `auth: { kind:
'none' }`). El App Secret solo entra en `/oauth/v2/recovery` y en
`exchangeCode` del callback.

De ahí sale la conclusión que ahorra la tarde:

> **Rotar el App Secret no puede arreglar un `refresco_401`, porque ese
> secreto no participa en esa llamada.** Un `refresco_401` dice que
> Clover rechazó el **refresh token**, no las credenciales de la app.

Así que ante un `refresco_401`, en este orden:

1. **¿Se rotó el App Secret hace poco? Entonces ya está diagnosticado.**
   No es una hipótesis: está **medido el 2026-09-06**. Rotar el App
   Secret **desinstala la app del merchant** — desaparece de su menú
   lateral y vuelve a salir en el App Market con botón *Connect*— y sus
   refresh tokens dejan de servir, no por caducados sino porque la app ya
   no está autorizada.

   La única salida es **rehacer el flujo OAuth**: emitir un
   `connect_token` nuevo y que el merchant vuelva a autorizar. Ningún
   redespliegue lo arregla, y volver a rotar el secreto tampoco. El peso
   que esto tiene en producción —y el procedimiento si hay que rotar de
   verdad— está en `docs/OAUTH-CONEXION.md`, *ROTAR EL APP SECRET
   DESCONECTA A TODOS LOS MERCHANTS*.
2. **¿Qué dijo Clover exactamente?** El log `refresco_401` lleva `cuerpo`
   y `requestId`. El cuerpo distingue un "token expirado" de un
   "client_id desconocido", que no se arreglan igual. El `requestId` es
   `X-Clover-Request-Id`: **es lo que hay que darle a soporte de Clover**
   para que miren esa petición en vez de pedir que se reproduzca.
3. **¿Llegó a intentarse la recuperación?** El log `recuperacion_401`
   dice con qué token se probó (`el vigente` / `el apuntado`) y qué
   contestó `X-Clover-Recovery-Available`. Sin ese evento en los logs, la
   recuperación ni se intentó.

### Comprobar QUÉ App Secret está leyendo el despliegue

Sin enseñarlo, y sin ir probando. En el arranque de cada función sale:

```json
{"nivel":"info","fn":"token-refresh","event":"arranque","appId":"...","secreto":"a1b2c3d4e5f6"}
```

`secreto` es un sha256 truncado — ni el valor, ni un prefijo, ni la
longitud (§14). Para comparar con lo que se pegó:

```bash
printf '%s' "$CLOVER_APP_SECRET" | sha256sum | cut -c1-12
```

**`printf` y no `echo`**: `echo` añade el salto de línea que precisamente
estamos intentando cazar. Esa familia de fallos —un `\n` final, un espacio,
las comillas metidas dentro del valor, un pegado truncado— es invisible a
ojo y cambia la huella por completo.

Si las dos cadenas coinciden, el despliegue lee exactamente lo que se
pegó. Y **ojo**: que coincidan no descarta un `refresco_401`, por lo de
arriba — donde esa huella sí es concluyente es en un fallo de
`/oauth/v2/recovery` o del callback del OAuth.

La huella cambia cuando la función se reinicia con el secreto nuevo, así
que también sirve para confirmar que un `supabase secrets set` ya llegó al
despliegue.

### `recovery_token_secret_id` poblado tras reconectar: ¿normal o fallo?

**Normal, si lo pobló el worker.** Un primer par nace sin red, y el
callback lo deja a nulo (`applyInitialTokens` lo anula explícitamente,
también en una reconexión). Pero en cuanto el worker hace su **primera
rotación con éxito**, apunta la recuperación al refresh token inicial —
que a partir de ese momento sí es un token previo de verdad. Como el
worker corre cada 5 minutos, la ventana en la que se ve a nulo es corta.

Para distinguirlo **sin meter ninguna fecha a mano**, el ancla es el
secreto del ACCESS token. El worker lo reescribe en sitio
(`vault.update_secret` sobre el mismo id, ver `postgres.ts`), así que su
`created_at` **no cambia al rotar**: sigue siendo el instante de la
reconexión. Comparado con él, el veredicto sale solo.

```sql
select st.slug,
       c.status,
       c.consecutive_failures,
       acc.created_at as reconectada_en,
       ref.name       as refresh_actual,
       rec.name       as recuperacion,
       rec.created_at as recuperacion_creada,
       case
         when c.recovery_token_secret_id is null
           then 'SIN RED TODAVIA: el worker aun no ha rotado. Normal recien conectada.'
         when rec.created_at >= acc.created_at
           then 'NORMAL: lo puso el worker en su primera rotacion.'
         else 'PUNTERO VIEJO: es de la autorizacion anterior. Hay que limpiarlo.'
       end as veredicto
  from public.clover_connections c
  join public.stores st  on st.id  = c.store_id
  left join vault.secrets acc on acc.id = c.access_token_secret_id
  left join vault.secrets ref on ref.id = c.refresh_token_secret_id
  left join vault.secrets rec on rec.id = c.recovery_token_secret_id
 where st.slug = '<slug>';
```

Los nombres llevan además la hora dentro (`clover/<store_id>/<tipo>/<epoch_ms>`),
que sirve para confirmarlo a ojo.

### Limpiar un puntero de recuperación viejo

Solo si el veredicto de arriba dice `PUNTERO VIEJO`. **El orden importa**:
primero se suelta el puntero, después se borra el secreto. Al revés deja
un instante en el que la fila apunta a un secreto que ya no existe, que es
justo lo que el worker no sabe manejar.

```sql
begin;

-- 1. Soltar el puntero. LAS DOS COLUMNAS: el check de la 0012 las exige
--    nulas o no nulas juntas, y ese check sigue en pie (el trigger de la
--    ventana que habia al lado ya no: lo quito la 0016).
update public.clover_connections
   set recovery_token_secret_id  = null,
       recovery_token_expires_at = null
 where store_id = (select id from public.stores where slug = '<slug>')
   and recovery_token_secret_id = '<uuid del secreto viejo>';

-- 2. Y ahora el huérfano. Es lo mismo que hace `destroy` en el worker.
delete from vault.secrets where id = '<uuid del secreto viejo>';

commit;
```

En una transacción, y con el `and` de la primera sentencia puesto a
propósito: si el worker rotó entre que se miró y se limpió, el `update` no
toca nada y la transacción no borra un puntero que ya no era ese.

No hay prisa: un puntero viejo cuesta **una llamada desperdiciada** en el
próximo 401, no una conexión. Y la próxima rotación con éxito lo
sobrescribe sola.

**Que no haga falta nunca más**: `applyInitialTokens` ya anula las dos
columnas al reconectar. Si esto aparece en una conexión reconectada
después de ese cambio, hay algo más que mirar.

### Barrer los secretos huérfanos de Vault

Hace falta **cuando se quite el seguro** `CONSERVAR_TOKEN_RECUPERACION_DESPLAZADO`
(ver *Por eso hay un seguro puesto*), y también de vez en cuando: el flujo
de OAuth y el worker dejan huérfanos por diseño cuando algo se corta a
mitad, porque la alternativa —borrar antes de confirmar— es dejar la fila
apuntando a un secreto que ya no existe.

Un huérfano es un secreto `clover/<store>/…` que **ninguna** de las tres
columnas de `clover_connections` referencia. Las tres, no dos: olvidar
`recovery_token_secret_id` en el `where` borra justo la red.

```sql
-- MIRAR PRIMERO. Esto no borra nada.
select s.id, s.name, s.created_at
  from vault.secrets s
 where s.name like 'clover/%'
   and not exists (
     select 1 from public.clover_connections c
      where s.id in (c.access_token_secret_id,
                     c.refresh_token_secret_id,
                     c.recovery_token_secret_id)
   )
   -- Margen de seguridad: un secreto recién creado puede estar en el
   -- instante entre `vault.create_secret` y el `update` de la fila. Sin
   -- esto, el barrido puede borrar el token de una rotación en curso.
   and s.created_at < now() - interval '1 hour'
 order by s.created_at;
```

Revisar la lista, y solo entonces cambiar el `select` por un `delete` con
el mismo `where`. **Nunca al revés**, y nunca sin el margen de una hora: un
barrido que se equivoca borra tokens vivos, que es exactamente lo que el
seguro existe para evitar.

No se automatiza con un `pg_cron` a la ligera. Un trabajo que borra
credenciales sin que nadie mire la lista es una escopeta cargada apuntando
a la disponibilidad de todas las sucursales a la vez.

### Una sucursal aparece en `DEGRADED`

Buscar en los logs del worker por `conexion`:

| evento | qué pasó | qué hacer |
|---|---|---|
| `refresco_fallido` | red o 5xx; aún no es grave | nada: reintenta con backoff |
| `refresco_401` | el token vigente ya no sirve | nada: va a intentar recuperar |
| `recuperacion_usada` | **se usó la red y funcionó** | mirar por qué se perdió un par; la conexión está sana |
| `vault_vigente_ilegible` | el secreto del vigente no se puede leer | incidente de Vault, no de Clover |
| `red_de_recuperacion_perdida` | Clover confirma que no queda recuperación | **rehacer el flujo OAuth con el merchant**: no hay atajo |
| `rotacion_no_persistida` | Clover emitió el par y no se pudo guardar | mirar la base; la conexión se salva sola en la vuelta siguiente |
| `lote_cortado_por_arriendo` | la vuelta tardó demasiado | mirar latencia de Clover; no es pérdida de datos |

**`recovery_available_until` en el pasado** (vista
`clover_connection_status`) no significa que no haya red: significa que
nosotros no podemos justificar que la haya. Quien lo sabe es Clover, y solo
lo dice cuando falla un refresco.

**Nunca**: borrar a mano `recovery_token_secret_id` "para limpiar", ni
mover `recovery_token_expires_at` a mano en ninguna dirección. Lo primero
tira la red. Lo segundo ya no lo rechaza ningún trigger —la 0016 lo
quitó—, así que ahora es una escritura que pasa sin protestar y deja la
fila mintiendo sobre una ventana que nadie ha medido. La fecha la escribe
el worker cuando Clover emite un par, y nadie más.

## Lo que queda por confirmar

- la vida del access token **en producción**. En sandbox se midió ~24 h
  (ver *La vida real del token, medida*); que producción se comporte igual
  no está confirmado, y por eso la constante sigue en 30 minutos;
- la vida del **refresh** token, que sigue sin medir;
- ~~la aclaración de la contradicción~~ → **resuelta el 2026-09-16: eran
  dos rutas, no una contradicción.** Ver *Clover aclaró*. Lo que sigue
  abierto no es una pregunta para Clover sino una prueba nuestra:
  `/oauth/v2/recovery` no se ha ejercido nunca contra el sandbox, y de eso
  depende quitar el seguro del borrado;
- la forma exacta del cuerpo de `/oauth/v2/recovery`. Se manda
  `client_id` + `client_secret` + `refresh_token`, que es lo que documenta
  el flujo; queda por ver contra el sandbox.
