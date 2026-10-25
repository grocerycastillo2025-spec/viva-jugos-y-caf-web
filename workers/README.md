# @juicebar/workers

Los trabajos que no caben en una Edge Function porque necesitan
durabilidad, backoff y exclusión mutua (§6 de la arquitectura). Los
dispara `pg_cron`; aquí vive la lógica, no el cableado.

```
src/token-refresh/
  worker.ts     la orquestación, y el porqué de todo lo demás. Empezar aquí.
  chain.ts      la cadena de recuperación: qué se escribe y qué NO. Puro.
  policy.ts     márgenes, lote, arriendo, backoff. Puro.
  ports.ts      Vault, la fila y las dos llamadas de Clover, como interfaces.
  postgres.ts   los puertos contra Postgres y Supabase Vault. SQL explícito.
  clover.ts     ata el App Secret una vez, fuera del bucle.
```

## Por qué la lógica no habla con nada

El worker depende de las interfaces de `ports.ts`, no del cliente de Clover
ni de un driver de Postgres. El motivo es que el escenario que justifica
todo el diseño —Clover emite el par nuevo y el proceso se cae antes de
guardarlo— es imposible de provocar contra el sandbox: exige romper el
proceso en un instante concreto. Con los puertos falsos se provoca en tres
líneas, y hay una prueba que comprueba lo único que importa de ese
momento: que el token anterior sigue entero en Vault.

## Ejecutar las pruebas

```sh
pnpm --filter @juicebar/workers test
```

Ninguna toca la red ni la base.

## Cablearlo — ya está cableado

Lo dispara `pg_cron` cada cinco minutos, a través de una Edge Function:

```
pg_cron  ──▶  app.run_token_refresh_worker()   supabase/migrations/0015
                     │ net.http_post
                     ▼
             POST /functions/v1/token-refresh  supabase/functions/token-refresh
                     │
                     ▼
             runTokenRefresh(...)              esto
```

Queda **un** paso manual, y es a propósito: la URL del proyecto y el
secreto compartido no se pueden versionar, así que los pone
`app.configure_token_refresh_worker`. Todo eso —qué hace falta, cómo se
comprueba que corre, y qué mirar cuando no— está en
`docs/REFRESCO-TOKENS.md`, sección *Cómo se dispara*.

Si algún día lo dispara otra cosa, `runTokenRefresh` recibe lo que
necesita y el que lo dispara construye las piezas:

```ts
const store = postgresConnectionStore(sql);   // sql: ejecuta con $1, $2… (service_role)
const vault = vaultTokenStore(sql);
const clover = new CloverClient({ environment, appId });
const api = bindCloverTokenApi(clover.oauth, { appId, appSecret });

await runTokenRefresh({ store, vault, cloverFor: () => api, now: () => new Date(), log });
```

Un `CloverClient` **por proceso**, no uno por conexión: el rate limiter y
los circuit breakers viven dentro, y dos instancias son dos limitadores
convencidos de tener 50 req/s cada uno.

El `sql` corre con `service_role`. `clover_connections` tiene RLS sin
ninguna policy (0004), así que con cualquier otra clave esto no falla a
medias: no lee ni una fila.

`WORKER_PERIOD_MS` tiene que decir lo mismo que el cron de la 0015. Hay
una prueba que abre la migración y lo comprueba
(`supabase/functions/token-refresh/__tests__/schedule.test.ts`): si se
cambia uno sin el otro, el aserto de `policy.ts` sobre cuántos intentos
caben en el margen deja de proteger nada, y en silencio.

## Antes de tocar nada aquí

Leer `docs/REFRESCO-TOKENS.md`. Las tres reglas que más caro cuestan
equivocarse están ahí y en `chain.ts`, y ninguna es evidente:

1. el token de recuperación es **el que se acaba de mandar**, no "el que
   acabo de sustituir". Al recuperar `A → C`, la recuperación **sigue
   siendo A**;
2. pero la ventana de dos semanas **sí se reancla** con cada par nuevo,
   también al recuperar. Son dos reglas sobre las mismas dos columnas y
   solo una se queda quieta. Hasta la 0016 se asumía lo contrario y había
   un trigger que lo imponía; Clover confirmó que era falso;
3. `X-Clover-Recovery-Available` manda sobre nuestra fecha estimada, y
   sirve para avisar y limpiar, **nunca** para decidir no intentarlo.

Y una cuarta que no es de la cadena sino de operación: toda rotación con
éxito escribe `last_refresh_success_at`. De ahí sale `refresh_stale`
(0016), que es lo único que distingue un worker caído en silencio de uno
que no tenía trabajo. Si algún día se rota sin escribir esa marca, la
detección deja de detectar y nadie se entera.
