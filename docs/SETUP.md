# Preparación de herramientas — antes de la Fase 3

Este documento tiene un orden deliberado: **arriba lo que tarda por causas ajenas a nosotros.** Empezar por lo rápido es la forma habitual de descubrir en octubre que algo requería tres semanas de trámite.

---

## Bloque 0 — Empezar hoy (tiempos externos)

Estas cuatro cosas dependen de terceros y no se aceleran con esfuerzo.

### 0.1 Cuenta de developer de Clover ⏱️ días a semanas

1. Crear cuenta de developer global en el portal de Clover.
2. Activar MFA (es obligatorio para poder generar tokens).
3. Crear la app en el Developer Dashboard.
4. **Declarar el set completo de permisos y congelarlo.** Este es el punto crítico: si se cambian los permisos después de que un merchant instaló la app, ese merchant no los recibe hasta desinstalar y reinstalar. Set propuesto:
   - Inventory: read + write
   - Orders: read + write
   - Merchant: read + write
   - Customers: read + write
   - Payments: read
   - Ecommerce: pagos online habilitados
5. Configurar la URL de webhook y verificarla con el código que Clover envía por POST.
6. Suscribirse a los tipos de evento: `O`, `P`, `I`, `IC`, `IG`, `IM`, `M`, `A`.
7. Crear merchant de prueba en sandbox.
8. **Solicitar un Dev Kit físico.** El envío tarda. La impresión y la visualización real en las apps del POS no se validan en emulador, y ese es justo el punto que más riesgo tiene (R8).

> Bloquea: Fase 7 completa. Sin esto no hay integración que probar.

### 0.2 Merchant real de Clover para verificación ⏱️ depende de tu red comercial

Necesitamos **un** restaurante real dispuesto a conectarse, aunque sea en modo prueba, para verificar antes de invertir:

- que su cuenta está habilitada para pagos online (riesgo R2);
- que tiene impresora de órdenes configurada;
- que no opera con Clover Dining (las órdenes por API no aparecen ahí).

Si el primer cliente firmado no cumple, el proyecto se detiene en la Fase 8. Vale la pena confirmarlo ahora.

### 0.3 Cuenta de Google Play Developer ⏱️ 1–3 días + verificación de identidad

Pago único de 25 USD. La verificación de identidad puede tardar. Android va primero, así que esto sí bloquea el lanzamiento.

### 0.4 Apple Developer Program ⏱️ 1–7 días (más si es cuenta de organización)

99 USD al año. Aunque iOS sea la Fase 16, conviene abrirla ya por dos razones: la verificación de organización con número D-U-N-S tarda, y necesitas la cuenta para resolver la pregunta de las apps white-label (riesgo R11) antes de vender el modelo comercial.

---

## Bloque 1 — Infraestructura (una tarde)

| Herramienta | Para qué | Plan sugerido |
|---|---|---|
| **GitHub** | repositorio, CI, protección de rama `main` | Team |
| **Supabase** | dos proyectos: `juicebar-dev` y `juicebar-prod` | Pro en prod (los backups diarios no son opcionales cuando hay dinero de por medio) |
| **Vercel** | hosting del SaaS admin | Pro |
| **Expo / EAS** | builds de la app, OTA updates | Production |
| **Firebase (FCM)** | push notifications | Spark basta al principio |
| **Sentry** | errores en app, SaaS y Edge Functions | Team |

**Dos proyectos de Supabase, no uno con dos esquemas.** El día que alguien apunte a la base equivocada mientras prueba pagos, la separación física es lo único que salva.

**Correspondencia de entornos:**

| Entorno | Supabase | Clover | App |
|---|---|---|---|
| local | `supabase start` | sandbox | Expo Go |
| dev | `juicebar-dev` | sandbox | EAS `development` |
| prod | `juicebar-prod` | producción | EAS `production` |

Regla: **nunca** apuntar la app de producción al sandbox de Clover, ni al revés. El entorno **no es del despliegue, es de cada conexión**: la columna `environment` de `clover_connections` decide contra qué hosts se habla, y los cuatro de cada entorno los resuelve `packages/clover-client` (`environments.ts`). Así la misma Edge Function puede atender una sucursal en sandbox y otra en producción, que durante un alta conviven. Ya no hay ninguna variable de entorno que lo fije.

---

## Bloque 2 — Local del desarrollador (30 minutos)

```bash
# Node 22 (usa el .nvmrc del repo)
nvm install && nvm use

# Gestor de paquetes
corepack enable && corepack prepare pnpm@9.12.0 --activate

# CLIs
npm i -g supabase eas-cli

# Docker Desktop -> necesario para supabase start

# Arrancar
pnpm install
supabase start
supabase db reset          # aplica las 5 migraciones de la Fase 2
pnpm db:types              # genera packages/shared-types/src/database.ts
pnpm test
```

Requisitos: Node ≥ 22, Docker, Android Studio (solo para el emulador), Git.

---

## Bloque 3 — Convenciones del repositorio

**Ramas:** `main` (protegida, siempre desplegable) ← `develop` ← `feature/*`. Pull request obligatorio con CI en verde y una revisión.

**Commits:** convencionales (`feat:`, `fix:`, `chore:`) para poder generar changelog automático.

**CI (`.github/workflows/ci.yml`), tres jobs:**

1. `quality` — lint, typecheck y tests.
2. `database` — aplica las migraciones en una base limpia y **falla si alguna tabla pública quedó sin RLS**. Esta comprobación es la que evita el error de seguridad más caro y más fácil de cometer.
3. `secret-scan` — falla si alguien versiona el **valor** de un `CLOVER_APP_SECRET` o una `service_role` key. Busca una asignación con valor, no una mención del nombre: el backend tiene que nombrar la variable para leerla (la Edge Function de OAuth lo hace), y eso nunca fue un secreto.

**Secretos:** en GitHub Actions y en el dashboard de cada servicio. Jamás en el repositorio. `.env.example` documenta la forma, nunca los valores.

---

## Bloque 4 — Qué ya está listo en este repo

```
juicebar/
├── package.json            workspaces + scripts
├── pnpm-workspace.yaml
├── turbo.json              pipeline de build/test/lint
├── tsconfig.base.json      TypeScript estricto de verdad
├── .env.example            todas las variables documentadas
├── .gitignore              bloquea .env, keystores, service accounts
├── .github/workflows/ci.yml
├── supabase/migrations/    5 migraciones (Fase 2, ya validadas)
├── packages/
│   ├── shared-types/       tipos compartidos + database.ts generado
│   ├── clover-client/      rate limiter + backoff + circuit breaker ✅ 9 tests
│   └── config/             presets compartidos
├── apps/                   (vacío: mobile y admin llegan en Fase 3)
├── workers/                (vacío: sync y reconciliación, Fase 7)
└── docs/
```

### Sobre `packages/clover-client`

Lo único implementado con lógica real, y a propósito: es la pieza de la que depende todo lo demás y la que refleja el riesgo R5. Contiene:

- **Token buckets** con relleno continuo, para el límite de app (50/s) y el de token (16/s).
- **Cuotas por prioridad**: 60% transaccional, 25% catálogo, 15% reconciliación. El tráfico transaccional puede robar del presupuesto global; el catálogo no.
- **Backoff exponencial con jitter**, tope de 30 s, y `retry-after` siempre por encima del cálculo propio, porque pedir antes de tiempo alarga la espera.
- **Clasificación de los cuatro tipos de 429** por el header `X-RateLimit-*`, para saber si hay que frenar a un merchant o a toda la app.
- **Circuit breaker por merchant**, que aísla una sucursal con problemas del presupuesto compartido.

Tests ejecutados: **9/9 en verde**. El más interesante es el que comprueba que 10 merchants pidiendo a la vez no superan las 50 req/s de la app, y que aun así un pedido en curso consigue pasar cuando el catálogo está saturado.

Los endpoints de Clover **no** están implementados. Eso es Fase 7, contra sandbox real y verificando la documentación oficial antes de escribir cada llamada.

---

## Bloque 5 — Checklist de arranque

**Hoy**
- [ ] Cuenta de developer de Clover + MFA
- [ ] App creada y **permisos congelados**
- [ ] Dev Kit solicitado
- [ ] Cuenta de Google Play iniciada
- [ ] Apple Developer iniciada
- [ ] Identificar el merchant real de verificación

**Esta semana**
- [ ] Organización de GitHub y repo con protección de ramas
- [ ] Proyectos `juicebar-dev` y `juicebar-prod` en Supabase
- [ ] Migraciones aplicadas en `juicebar-dev`
- [ ] Proveedores de Auth configurados (email + Google + Apple)
- [ ] Proyecto de Vercel enlazado
- [ ] Cuenta de Expo y proyecto de EAS
- [ ] Proyecto de Firebase con FCM
- [ ] Sentry con tres proyectos
- [ ] Secretos cargados en GitHub Actions
- [ ] CI en verde en un PR de prueba

**Antes de la Fase 3**
- [ ] `pnpm db:types` genera tipos sin error
- [ ] Seed de desarrollo: una marca, dos sucursales, ~20 productos
- [ ] Emulador de Android arrancando la app base

---

## Costo mensual estimado del stack

| Servicio | Aprox. |
|---|---|
| Supabase Pro (prod) | 25 |
| Vercel Pro | 20 |
| Expo EAS Production | 99 |
| Sentry Team | 26 |
| GitHub Team | 4/usuario |
| Firebase FCM | 0 |
| Apple Developer | 8 (99/año) |
| Google Play | ~0 (25 único) |
| **Total** | **≈ 185–210 USD/mes** |

Clover no cobra por ser developer; cobra comisión por transacción al merchant, y toma un porcentaje si monetizas la app a través del App Market. Ese modelo hay que revisarlo antes de fijar tu precio de venta.

---

## Lo que sigue

Con el Bloque 1 y el 2 hechos, la **Fase 3** (UI Android con datos mock) arranca sin fricción. Lo del Bloque 0 corre en paralelo y no bloquea nada hasta la Fase 7.
