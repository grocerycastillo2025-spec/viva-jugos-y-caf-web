# App web (PWA)

La misma app de `apps/mobile` exportada para navegador con
`expo export --platform web`. Es el mismo código: lo que se cambia en la app
llega también a la web en la siguiente publicación.

## Publicar

Cada push a `main` corre **Actions → Publicar app web (GitHub Pages)**:
lint, typecheck, tests, exportación y despliegue. Queda en
`https://<cuenta>.github.io/<repo>/`.

Configuración (una sola vez):

1. **Settings → Pages → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Secrets:**
   - `EXPO_PUBLIC_SUPABASE_URL`: la del proyecto de Supabase **de Viva**.
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: la clave **publicable**. El workflow
     rechaza una `sb_secret_*`: todo lo que entra en la web lo puede leer
     cualquiera que abra la página.
   - `EXPO_PUBLIC_RESTAURANT_ID`: opcional. Si falta, se usa el de
     `app.json`.
3. **Supabase → Authentication → URL Configuration:** añadir la URL de la
   app web a *Site URL* y *Redirect URLs*. Sin eso, los enlaces de
   confirmación de correo y el login con Google vuelven a la app móvil o
   fallan.

## Dominio propio

1. En el DNS del dominio, un `CNAME` de `app` (o el subdominio que se elija)
   a `<cuenta>.github.io`.
2. Settings → Pages → Custom domain → `app.vivajuicecoffee.com`, y marcar
   *Enforce HTTPS* cuando GitHub emita el certificado.
3. Settings → Secrets and variables → Actions → **Variables** →
   `WEB_BASE_URL` = `/`, y volver a lanzar el workflow. Sin esa variable la
   app se compila para vivir bajo `/<repo>/` y con dominio propio no
   encontraría sus archivos.

## Probar en local

```bash
pnpm --filter @juicebar/mobile web          # servidor de desarrollo
pnpm --filter @juicebar/mobile build:web    # exportación, en apps/mobile/dist
```

## Qué cambia respecto al teléfono

| Pieza | En la web |
|---|---|
| Notificaciones push | No hay. `src/push/notifications.ts` devuelve `web` y el perfil explica que el pedido se sigue en la pestaña Pedidos. |
| Vibración al añadir | `expo-haptics` no hace nada en el navegador. |
| Pantalla ancha | La app se pinta en una columna centrada de 520 px (`public/index.html` y `src/hooks/use-content-width.ts`, que deben coincidir). |
| Instalación | `public/manifest.webmanifest` + `public/sw.js`: se puede "añadir a pantalla de inicio" en Android y en iPhone. |
| Rutas directas | `scripts/web-postbuild.mjs` copia `index.html` a `404.html`, así abrir o recargar `/order/<id>` funciona en Pages. |

El service worker solo guarda en caché los archivos de la propia app (con
hash en el nombre). El menú, los precios y los pedidos se leen siempre en
vivo de Supabase.
