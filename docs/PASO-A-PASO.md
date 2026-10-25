# Paso a paso: configurar las herramientas

Tiempo total: **unos 90 minutos**, en un solo día. Sin instalar nada en tu PC.

Cada paso termina con una **verificación**: algo concreto que debes ver en pantalla antes de pasar al siguiente. Si no lo ves, para ahí y revisa; seguir adelante con un paso a medias es lo que hace que después nada funcione y no se sepa por qué.

> **Nota sobre los nombres de botones:** estas plataformas cambian su interfaz con frecuencia. Si un botón no se llama exactamente como aquí, busca el equivalente más cercano; el flujo de fondo es el mismo. Lo que no cambia son las verificaciones.

---

## Antes de empezar

Ten a mano:

- Un correo electrónico
- Tu teléfono Android
- Un gestor de contraseñas o un lugar seguro donde guardar credenciales (vas a generar varias)
- Los archivos del proyecto descargados de esta conversación

---

# PASO 1 — GitHub (15 min)

## 1.1 Crear la cuenta

1. Entra a **github.com** → **Sign up**
2. Correo, contraseña, nombre de usuario
3. Verifica el correo

## 1.2 Activar 2FA

En **Settings → Password and authentication → Two-factor authentication**. Usa una app de autenticación (Google Authenticator, Authy, 1Password).

**Guarda los códigos de recuperación.** Si pierdes el teléfono sin ellos, pierdes la cuenta y el código del proyecto con ella.

## 1.3 Crear el repositorio

1. Botón **+** arriba a la derecha → **New repository**
2. Rellena:
   - **Owner:** tu usuario personal ⚠️ **no una organización**
   - **Repository name:** `juicebar`
   - **Visibility:** **Private**
   - ✅ **Add a README file**
3. **Create repository**

> ⚠️ **Por qué en cuenta personal:** la cuota gratuita de Codespaces solo aplica a cuentas personales. En una organización se cobra desde la primera hora. Cuando el proyecto crezca se puede transferir el repo.

### ✅ Verificación
Ves tu repositorio con un archivo `README.md` y la etiqueta **Private** junto al nombre.

---

# PASO 2 — El Codespace (10 min)

## 2.1 Crearlo

1. En tu repo, botón verde **Code**
2. Pestaña **Codespaces** → **Create codespace on main**
3. Espera 2–3 minutos

Se abre VS Code dentro del navegador. Esa es tu máquina de desarrollo.

## 2.2 Subir los archivos del proyecto

Esta es la parte que la gente hace mal. **No los subas por la web de GitHub**, que pierde la estructura de carpetas. Hazlo desde el Codespace:

1. En el panel izquierdo (**Explorer**), verás solo `README.md`
2. **Arrastra las carpetas y archivos del proyecto** desde tu escritorio directamente al panel del Explorer
3. Confirma cuando pregunte si quieres copiar los archivos

Debe quedar así:

```
juicebar/
├── .devcontainer/
├── .github/
├── docs/
├── packages/
├── supabase/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
├── .env.example
├── .gitignore
├── .nvmrc
└── .prettierrc
```

⚠️ Los archivos que empiezan con punto (`.devcontainer`, `.github`, `.gitignore`) a veces están ocultos en tu explorador de archivos. En Windows: pestaña Vista → marcar "Elementos ocultos". En Mac: `Cmd + Shift + .`

## 2.3 Guardar los cambios en GitHub

1. Icono de **Source Control** en la barra izquierda (el de las ramas)
2. Verás la lista de archivos nuevos
3. Escribe en el mensaje: `chore: estructura inicial del proyecto`
4. **Commit** → **Sync Changes** (o Publish Branch)

## 2.4 Reconstruir el entorno

Como el `.devcontainer` llegó después de crear el Codespace, hay que aplicarlo:

1. `F1` (o `Ctrl+Shift+P`) → escribe **Rebuild Container** → Enter
2. Espera 2–3 minutos

## 2.5 Instalar dependencias

En la terminal del Codespace (menú **Terminal → New Terminal**):

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
```

### ✅ Verificación

```bash
node --version    # debe decir v22.x
pnpm --version    # debe decir 9.12.0
pnpm test
```

El último comando debe terminar con **9 tests, 9 pass, 0 fail**. Si ves eso, el entorno está bien montado.

---

# PASO 3 — Supabase (20 min)

## 3.1 Crear cuenta y proyecto

1. **supabase.com** → **Start your project** → entra con GitHub (más simple)
2. **New project**
3. Rellena:
   - **Name:** `juicebar-dev`
   - **Database Password:** genera una fuerte con el botón y **guárdala inmediatamente**
   - **Region:** `East US (North Virginia)` — cerca de los restaurantes en EE. UU.
   - **Plan:** Free
4. **Create new project** y espera unos 2 minutos

> 🔑 **La contraseña de la base de datos no se vuelve a mostrar.** Si la pierdes hay que resetearla. Guárdala antes de continuar.

## 3.2 Anotar las credenciales

En **Project Settings → API** (o **Data API**), copia y guarda:

| Dato | Dónde se usa |
|---|---|
| **Project URL** | app y SaaS |
| **anon / public key** | app y SaaS — es pública, puede ir en el cliente |
| **service_role key** | ⚠️ **solo backend**. Si aparece en la app, es un incidente de seguridad |
| **Reference ID** | para enlazar el CLI (está también en la URL del dashboard) |

## 3.3 Aplicar las migraciones

De vuelta en la terminal del Codespace:

```bash
pnpm supabase login
```

Te muestra un enlace. Lo abres, autorizas, copias el token que te da y lo pegas en la terminal.

```bash
pnpm supabase link
```

Te lista tus proyectos, eliges `juicebar-dev` y te pide la contraseña de base de datos del paso 3.1.

```bash
pnpm db:push
```

Te muestra las 15 migraciones que va a aplicar y pide confirmación.

> ⚠️ **En `juicebar-dev` esto no aplica: esa base ya las tiene.** Se
> construyó a mano por el SQL Editor, antes de que existiera el enlace con
> el CLI. Ve a 3.4 antes de tocar `db:push` ahí.

## 3.4 El historial de migraciones (solo para `juicebar-dev`)

El CLI anota lo que ya ejecutó en una tabla, `supabase_migrations.schema_migrations`.
La crea `db push` la primera vez que corre. En `juicebar-dev` nunca corrió
—las 15 migraciones entraron a mano por el SQL Editor— así que esa tabla no
existe, y sin ella `db push` cree que la base está vacía: intenta reaplicar
desde la 0001 y revienta con "already exists". De ahí que cada migración
nueva acabara en otro script manual.

Se arregla una sola vez, sembrando el historial. **Antes**, comprobar que la
base de verdad está donde creemos —sembrar sin mirar es darle por aplicada
al CLI una migración que podría faltar, y en silencio—. En **SQL Editor**:

```sql
with fn as (
  select n.nspname as esquema, p.proname as nombre, p.prosrc as cuerpo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
)
select 'historial de migraciones' as comprueba,
       to_regclass('supabase_migrations.schema_migrations') is not null as ok
union all select '0012 view clover_connection_status', to_regclass('public.clover_connection_status') is not null
union all select '0013 index idx_clover_conn_refresh_due', to_regclass('public.idx_clover_conn_refresh_due') is not null
union all select '0013 fn claim_clover_connections_for_refresh', exists(select 1 from fn where esquema='app' and nombre='claim_clover_connections_for_refresh')
union all select '0014 fn issue_clover_connect_token', exists(select 1 from fn where esquema='app' and nombre='issue_clover_connect_token')
union all select '0014 fn purge_expired_clover_connect_tokens', exists(select 1 from fn where esquema='app' and nombre='purge_expired_clover_connect_tokens')
union all select '0015 tabla app.token_refresh_runs', to_regclass('app.token_refresh_runs') is not null
union all select '0015 fn run_token_refresh_worker', exists(select 1 from fn where esquema='app' and nombre='run_token_refresh_worker')
union all select '0015 fn token_refresh_worker_status', exists(select 1 from fn where esquema='app' and nombre='token_refresh_worker_status')
union all select '0015 EL FIX del guard de pg_net (c2434a0)',
       exists(select 1 from fn where esquema='app' and nombre='configure_token_refresh_worker' and cuerpo like '%proargnames%');
```

Salvo la primera fila, **todas tienen que decir `true`**. Si alguna dice
`false`, esa migración no está entera: no siembres, avísame con el nombre
de la fila.

Con eso comprobado, ejecuta en el SQL Editor el contenido de
[`scripts/sql/sembrar-historial-migraciones.sql`](../scripts/sql/sembrar-historial-migraciones.sql).
Devuelve 15 filas, de la 0001 a la 0015. No modifica ningún objeto de la
base: solo escribe el registro.

A partir de ahí `pnpm db:push` funciona normal, de la 0016 en adelante.
Los nombres cortos (`0001_core.sql`) los acepta el CLI sin problema; no hay
que renombrarlos a timestamps, y si algún día usas `supabase migration new`
—que genera `20260905...`— convive con los cortos y respeta el orden.

### Si `db:push` no conecta desde el Codespace

Hay un segundo obstáculo, independiente del historial, y conviene no
confundirlos: el que arregla 3.4 hace que `db push` sepa **qué** aplicar;
este es que **pueda llegar** a la base.

`supabase link` apunta a `db.<ref>.supabase.co`, que hoy solo resuelve por
IPv6. Los Codespaces no tienen IPv6, así que la conexión ni se intenta.
Para comprobarlo, en la terminal del Codespace:

```bash
curl -s6 https://ifconfig.co || echo "sin IPv6"
```

Si dice "sin IPv6", la salida es el **Session pooler**, que sí va por IPv4.
En el dashboard: **Connect** (arriba) → **Session pooler** → copia la cadena.
Ojo con cuál copias: el *Transaction pooler* (puerto 6543) **no sirve** para
migraciones —no mantiene los locks que `db push` necesita—; tiene que ser el
de sesión, puerto 5432. Guárdala en `.env.local`, que no se sube a git,
porque lleva la contraseña dentro:

```bash
SUPABASE_DB_URL="postgresql://postgres.trqfelkgovygcbqtofrs:TU_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
```

El host y la región salen de la cadena que copiaste del dashboard; el
`aws-0-us-east-1` de arriba es solo un ejemplo, no lo des por bueno. Y si la
contraseña lleva `@`, `#`, `/` o `:`, hay que percent-encodearla dentro de la
URL o la cadena se parte por la mitad; lo más rápido suele ser resetearla en
Settings → Database por una alfanumérica.

Hecho eso, `pnpm db:push` funciona sin más:

```bash
pnpm db:push
pnpm db:push --dry-run     # los argumentos extra se reenvían al CLI
```

Ese comando pasa por `scripts/db-push.sh`, que lee la cadena de `.env.local`
y se la da al CLI. Hace falta el envoltorio porque el CLI **no** lee
`SUPABASE_DB_URL` del entorno por su cuenta —sin `--db-url` responde
`Cannot find project ref`— y escribir el flag a mano en cada migración se
olvida justo el día que importa. Si falta `.env.local` o la variable, el
script te dice cuál de las dos cosas es y cómo arreglarla.


## 3.5 Generar los tipos TypeScript

```bash
pnpm db:types
```

Crea `packages/shared-types/src/database.ts` con los tipos de todas las tablas.

Este comando va por un camino distinto al de `db:push`, y conviene saber por
qué. El `--linked` de la receta original no vale desde el Codespace: necesita
la conexión directa, que es solo IPv6. Pero pasarle `--db-url`, que es lo que
arregla `db:push`, tampoco sirve — con una url arbitraria el CLI se conecta a
la base y luego **levanta un contenedor** para leer el esquema, así que exige
Docker, y el devcontainer de este repo no lo trae.

Lo que sí funciona es `--project-id`, que va por la API de gestión sobre
HTTPS: ni base de datos, ni IPv6, ni Docker. El ref lo saca `scripts/db-types.sh`
de `NEXT_PUBLIC_SUPABASE_URL` (o `EXPO_PUBLIC_SUPABASE_URL`), que ya tienes en
`.env.local` con la forma `https://<ref>.supabase.co`; se puede fijar a mano con
`SUPABASE_PROJECT_ID` si hiciera falta. Lo único que pide es haber hecho
`pnpm supabase login`, que también es HTTPS.

Si la generación falla, `database.ts` **no se toca**: el script escribe a un
temporal y solo lo mueve al final. Un `> archivo` directo lo dejaría en cero
bytes antes siquiera de intentarlo, y entonces el `typecheck` reventaría por
un motivo que no tiene nada que ver con la causa real.

## 3.6 Activar autenticación por correo

En el dashboard: **Authentication → Sign In / Providers → Email** → activado.

Para desarrollo, desactiva **Confirm email** para no tener que verificar cada usuario de prueba. **Vuélvelo a activar antes de producción.**

### ✅ Verificación

En **Table Editor** del dashboard debes ver las tablas: `restaurants`, `stores`, `orders`, `catalog_items`, `clover_connections`, `loyalty_accounts`, entre otras.

Prueba además que la seguridad quedó activa. En **SQL Editor**, pega esto:

```sql
select t.tablename,
       case when c.relrowsecurity then 'RLS activo' else '⚠️ SIN RLS' end as seguridad
from pg_tables t
join pg_class c on c.relname = t.tablename
where t.schemaname = 'public'
order by 2, 1;
```

**Todas las filas deben decir "RLS activo".** Si alguna dice "SIN RLS", avísame antes de seguir.

---

# PASO 4 — Variables de entorno (5 min)

En el Codespace, terminal:

```bash
cp .env.example .env.local
```

Abre `.env.local` en el editor y rellena con lo que anotaste en el paso 3.2:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Lo de Clover se deja vacío por ahora; se rellena en la fase 7.

### ✅ Verificación

```bash
git status
```

**`.env.local` NO debe aparecer en la lista.** Si aparece, el `.gitignore` no se subió bien: revísalo antes de hacer cualquier commit. Ese archivo con la `service_role` key dentro no puede llegar nunca a GitHub.

---

# PASO 5 — Expo y tu teléfono (10 min)

## 5.1 Cuenta

1. **expo.dev** → **Sign Up**
2. Guarda usuario y contraseña

## 5.2 App en el teléfono

Instala **Expo Go** desde Google Play e inicia sesión con la misma cuenta.

### ✅ Verificación

Expo Go abierto en tu teléfono, con tu cuenta iniciada. Todavía no hay app que cargar; eso llega en la fase 3.

---

# PASO 6 — Clover developer (20 min + espera)

Este es el que tiene tiempos externos. Aunque no lo uses hasta la fase 7, **empiézalo hoy**.

## 6.1 Cuenta de developer

1. Entra al portal de developers de Clover y regístrate como developer global
2. **Activa MFA** — es obligatorio para poder generar tokens de API
3. Completa el perfil de developer

## 6.2 Crear la app

En el Developer Dashboard, crea una app nueva. Nombre sugerido: `Mobile Ordering Platform`.

## 6.3 Declarar los permisos ⚠️ decisión importante

En la sección de permisos de la app, marca:

| Permiso | Lectura | Escritura |
|---|---|---|
| Inventory | ✅ | ✅ |
| Orders | ✅ | ✅ |
| Merchant | ✅ | ✅ |
| Customers | ✅ | ✅ |
| Payments | ✅ | — |

Y activa los pagos de ecommerce en la configuración de la app.

> ⚠️ **Esto no se cambia después sin costo.** Si añades un permiso cuando ya haya merchants con la app instalada, esos merchants no lo reciben hasta desinstalar y reinstalar. Por eso pedimos de más ahora, incluidos permisos de escritura que quizá nunca usemos.

## 6.4 Crear merchant de prueba

En la sección de sandbox, crea un merchant de prueba. Elige un giro de restaurante o cafetería, que es lo más parecido a nuestros clientes reales.

## 6.5 Solicitar el Dev Kit

Busca la opción de solicitar un dispositivo de desarrollo. Tarda en llegar y es la única forma de verificar de verdad la impresión de tickets, que es nuestro riesgo técnico más probable.

## 6.6 Guardar credenciales

Del dashboard de la app, guarda: **App ID**, **App Secret** y el **código de autenticación de webhooks**.

**No los pongas todavía en `.env.local`** ni en ningún archivo del repo. Guárdalos en tu gestor de contraseñas hasta la fase 7.

### ✅ Verificación

Tienes app creada, permisos declarados, merchant de prueba visible en el sandbox y Dev Kit solicitado.

---

# PASO 7 — Rutina diaria

```
1. github.com → tu repo → Code → Codespaces → abrir el existente
2. Trabajar
3. Source Control → Commit → Sync
4. Menú Codespaces → Stop current codespace   ← ahorra cuota
```

## Cuidar la cuota

El plan gratuito son 120 core-hours al mes, unas 60 horas reales en máquina de 2 núcleos.

- Detén el Codespace al terminar. Se apaga solo a los 30 min de inactividad, pero un proceso corriendo lo mantiene despierto.
- Borra Codespaces que no uses: consumen almacenamiento aunque estén detenidos.
- Consulta el consumo en **Settings → Billing → Codespaces**.

---

# Checklist final

- [ ] GitHub con 2FA y códigos de recuperación guardados
- [ ] Repo `juicebar` privado, en cuenta personal
- [ ] Codespace arranca y `pnpm test` da 9/9
- [ ] Proyecto Supabase creado, contraseña guardada
- [ ] `pnpm db:push` aplicó las 5 migraciones
- [ ] Todas las tablas con RLS activo
- [ ] `pnpm db:types` generó `database.ts`
- [ ] Auth por email activado
- [ ] `.env.local` con credenciales y **fuera** de git
- [ ] Cuenta Expo y Expo Go instalado
- [ ] Clover: app creada, permisos congelados, merchant de prueba, Dev Kit pedido

Con esto, la fase 3 arranca sin fricción.

---

# Si algo falla

| Síntoma | Causa habitual | Solución |
|---|---|---|
| `pnpm: command not found` | falta activar corepack | `corepack enable` |
| `pnpm test` no da 9/9 | dependencias sin instalar | `pnpm install` de nuevo |
| El Codespace no toma el devcontainer | llegó después de crearlo | `F1` → Rebuild Container |
| `supabase link` rechaza la contraseña | es la de la base, no la de tu cuenta | resetéala en Settings → Database |
| `db:push` dice que no hay migraciones | falta la carpeta o mal ubicada | debe ser `supabase/migrations/` en la raíz |
| `db:push` intenta aplicar la 0001 en una base que ya la tiene | falta el historial de migraciones | paso 3.4 |
| `db:push` no conecta desde el Codespace | la conexión directa es solo IPv6 y el Codespace no lo tiene | usa el Session pooler: paso 3.4 |
| Alguna tabla sin RLS | una migración falló a medias | avísame con el nombre de la tabla |
| `.env.local` aparece en git | `.gitignore` no se subió | verifica que existe en la raíz del repo |

Si te atoras en algún punto, dime el número del paso y el mensaje exacto que ves.
