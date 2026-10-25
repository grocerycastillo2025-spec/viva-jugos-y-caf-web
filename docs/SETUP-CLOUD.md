# Setup 100% en la nube

Sin Node, sin Docker, sin Android Studio, sin nada instalado en tu PC. Solo necesitas **un navegador** y **tu teléfono Android**.

> Este documento reemplaza los bloques 2 y 3 de `SETUP.md`. Lo del bloque 0 (cuenta de developer de Clover, Dev Kit) sigue igual y sigue siendo lo primero por tiempos externos.

---

## Cómo queda el montaje

```
   TU NAVEGADOR                      TU TELÉFONO
        │                                 │
        │ VS Code en el navegador         │ app Expo Go
        ▼                                 │
┌───────────────────────┐                 │
│  GITHUB CODESPACES    │  ── túnel ──────┘
│  Tu máquina de        │      (QR)
│  desarrollo, en la    │
│  nube                 │
└───────┬───────────────┘
        │
        ├──────────► SUPABASE (base de datos en la nube)
        │
        └──────────► VERCEL (SaaS admin publicado, cuando toque)
```

**Tu PC no ejecuta nada.** El código corre en un servidor de GitHub, la base de datos en Supabase, y la app se ve en tu teléfono a través de un túnel.

---

## Las cuatro cuentas (todas gratis)

| Cuenta | Para qué | Costo |
|---|---|---|
| **GitHub** | el código, el CI y **Codespaces** (tu entorno de desarrollo) | 0 |
| **Supabase** | base de datos, auth y storage | 0 |
| **Expo** | ver la app en tu teléfono | 0 |
| **Vercel** | publicar el SaaS admin (no urge todavía) | 0 mientras no sea comercial |

---

## Paso 1 — GitHub y el Codespace

1. Crear cuenta en github.com.
2. Crear un repositorio privado, por ejemplo `juicebar`.
3. Subir el contenido de este proyecto (se puede arrastrar los archivos en la web de GitHub, sin usar git localmente).
4. Botón verde **Code → Codespaces → Create codespace on main**.

En 2–3 minutos tienes VS Code completo en el navegador, con Node 22, pnpm y las dependencias ya instaladas. Eso lo hace el archivo `.devcontainer/devcontainer.json` que ya está en el repo.

### Lo que hay que saber del plan gratuito

<!-- Verificado en agosto de 2026; conviene reconfirmarlo, las cuotas cambian. -->

Una cuenta personal gratuita de GitHub incluye **120 core-hours al mes**, que en una máquina de 2 núcleos equivalen a unas **60 horas reales** de uso, más 15 GB de almacenamiento. Es aproximadamente 3 horas al día en días laborables.

Dos cosas importantes:

- **Apaga el Codespace cuando termines.** Se detiene solo a los 30 minutos de inactividad, pero si dejas un proceso corriendo (el servidor de Expo, por ejemplo) sigue consumiendo. Menú de Codespaces → Stop.
- **El almacenamiento se consume aunque esté detenido.** Borra los Codespaces que no uses.

Si se te queda corto, GitHub Pro cuesta 4 USD al mes y sube la cuota. Ese sería tu único gasto real durante meses.

**La cuota gratuita es solo para cuentas personales, no para organizaciones.** Si creas el repo dentro de una organización, los Codespaces se cobran desde la primera hora. Crea el repositorio en tu cuenta personal por ahora.

---

## Paso 2 — Supabase en la nube (sin Docker)

1. Crear cuenta en supabase.com y un proyecto: `juicebar-dev`, región **East US** (cerca de tus restaurantes en EE. UU.).
2. Guardar la contraseña de la base de datos que te muestra. No la vuelve a mostrar.
3. En el Codespace, en la terminal:

```bash
npx supabase login                       # abre un enlace, pegas el token
npx supabase link --project-ref TU_REF   # el ref está en la URL del proyecto
pnpm db:push                             # aplica las 5 migraciones de la Fase 2
pnpm db:types                            # genera los tipos TypeScript
```

Sin `supabase start`, sin Docker. Las migraciones van directas al proyecto en la nube.

4. Verificar en el dashboard de Supabase → Table Editor que aparecen las tablas, y en Authentication → Providers activar Email.

Cuando llegue producción se crea un segundo proyecto, `juicebar-prod`. Por ahora uno basta.

---

## Paso 3 — Ver la app en tu teléfono

Este es el paso que sustituye al emulador de Android. **En Codespaces no hay emulador**, así que tu teléfono es el dispositivo de pruebas. Es mejor así: ves la app en una pantalla real, con el rendimiento real.

1. Instalar **Expo Go** desde Google Play en tu teléfono.
2. Crear cuenta gratis en expo.dev.
3. En el Codespace:

```bash
pnpm mobile        # arranca Expo en modo túnel
```

4. Aparece un código QR en la terminal. Lo escaneas con Expo Go y la app se abre en tu teléfono.

El modo túnel es obligatorio aquí: el Codespace no está en tu red wifi, así que la conexión directa no funciona. Ya está configurado en el script `pnpm mobile`.

**Lo bueno:** cambias una línea de código en el navegador y el teléfono se actualiza solo en un par de segundos. No hay que compilar ni instalar nada.

**El límite:** Expo Go no soporta código nativo personalizado. Para nosotros no es problema hasta la fase de pagos, donde el iframe de Clover va dentro de un WebView. Ahí se pasa a un *development build* generado en la nube con EAS, que se instala una vez en tu teléfono y funciona igual de cómodo.

---

## Paso 4 — Vercel (cuando quieras ver el SaaS)

Mientras trabajas, el SaaS se abre desde el propio Codespace: `pnpm admin` y VS Code te ofrece abrir el puerto 3000 en una pestaña.

Publicarlo en internet solo hace falta cuando quieras enseñárselo a otra persona. **El callback de OAuth de Clover no cuenta**: vive en una Edge Function de Supabase (`supabase/functions/oauth`), que ya tiene URL pública desde el primer despliegue y no depende de esto. Ver `docs/OAUTH-CONEXION.md`. Cuando quieras publicar el SaaS:

1. Cuenta en vercel.com, entrando con GitHub.
2. Import Project → eliges el repo → Root Directory `apps/admin`.
3. Cargas las variables de entorno.

A partir de ahí, cada push a `main` se despliega solo y cada pull request genera una URL de vista previa.

**Ojo con la licencia:** el plan gratuito de Vercel es para uso no comercial. Cuando el SaaS sea un producto que vendes, toca el plan Pro. Revisa sus términos antes de comprometerte, porque no es el único hosting posible para Next.js.

---

## Resumen: tu día a día

```
1. Abrir github.com → tu repo → Code → Codespaces → arrancar
2. Terminal: pnpm mobile
3. Escanear el QR con Expo Go
4. Programar en el navegador, ver los cambios en el teléfono
5. Al terminar: Stop del Codespace  ← importante, ahorra cuota
```

Cero instalaciones. Funciona igual desde otra computadora, porque el entorno vive en la nube y no en tu máquina.

---

## Checklist

**Hoy (~30 min)**
- [ ] Cuenta de GitHub y repositorio privado **en cuenta personal**, no en organización
- [ ] Subir el proyecto
- [ ] Crear el Codespace y ver que arranca
- [ ] Cuenta de Supabase + proyecto dev
- [ ] `pnpm db:push` y confirmar las tablas en el dashboard
- [ ] Cuenta de Expo + Expo Go instalado en el teléfono

**En paralelo, sin prisa hoy pero sí esta semana**
- [ ] Cuenta de developer de Clover + MFA
- [ ] Permisos de la app declarados y congelados
- [ ] Dev Kit solicitado

**Cuando se conecte la primera sucursal con Clover**
- [ ] Activar `pg_cron` y `pg_net` en Dashboard → Database → Extensions
- [ ] `WORKER_CRON_SECRET` y `app.configure_token_refresh_worker(...)`

Los dos dejan corriendo el worker que rota los tokens de Clover. Sin eso
la conexión se queda sin access token vigente y la sucursal no puede
hablar con Clover. El paso a paso está en `docs/REFRESCO-TOKENS.md`,
sección *Cómo se dispara*.

**Cuando haga falta**
- [ ] Vercel (fase 7)
- [ ] EAS development build (fase de pagos)
- [ ] Google Play (fase 15)

---

## Alternativas, por si Codespaces no te convence

| Opción | A favor | En contra |
|---|---|---|
| **GitHub Codespaces** ← recomendado | VS Code real, integrado con el repo, config ya lista | cuota de 60 h/mes en el plan gratis |
| **Gitpod** | similar, 50 h/mes gratis | otra cuenta más que administrar |
| **Replit** | el más simple de arrancar | menos control, peor encaje con monorepos |
| **Firebase Studio** | gratis y generoso | orientado a stack de Google |

Recomiendo Codespaces porque GitHub ya lo necesitas para el repositorio y el CI, y porque el `devcontainer.json` del proyecto hace que arranque configurado sin que toques nada.
