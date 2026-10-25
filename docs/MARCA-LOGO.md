# El logo de la cabecera

La Home ensena el logo en el bloque verde. Sale de `app_settings.logo_url`,
no de un archivo dentro de la app: la plataforma es multi-marca (§19 del
documento de arquitectura) y cambiar el logo no puede exigir una release
—ni meter el logotipo de Viva en el binario de otra marca.

Si `logo_url` esta vacio, la cabecera cae al nombre escrito, que es lo que
se veia antes. **Hasta que se suba el archivo, la app sigue ensenando el
texto**: el codigo ya esta, lo que falta es la fila en la base.

## El archivo

`assets/brand/viva-logo.png` es una composicion fotografica: el logotipo
impreso sobre papel crema, rodeado de fruta, hojas y granos. Sobre el verde
de la cabecera eso no se puede poner — se veria un recuadro de foto.

Lo que hay que subir es **`assets/brand/viva-logo-cream.png`**: el mismo
logotipo, en crema (`#F5F0E6`), sobre fondo transparente. 1036 × 630, 19 KB.
Al lado hay `viva-logo-cream-preview.png`, que es como se ve sobre el verde
de la marca; ese es solo para mirarlo, no se sube.

Se saco de la foto con `scripts/brand/logo-crema.mjs`, que separa la tinta
del papel y descarta las hojas. **Es una aproximacion, no el arte
original.** Si aparece el vectorial de la marca, ese manda: se exporta a PNG
con el logotipo en crema y fondo transparente, y se sube en su lugar.

```bash
node scripts/brand/logo-crema.mjs   # regenera el png desde la foto
```

## Subirlo

En el navegador, sin entorno local:

1. **Supabase → Storage.** Si no existe un bucket publico para la marca,
   crear uno llamado `brand` y marcarlo **Public**. Un logo no lleva nada
   privado y tiene que poder pedirlo un telefono sin sesion.
2. **Upload** de `viva-logo-cream.png` dentro de `brand/`.
3. Abrir el archivo y copiar su **Public URL**. Queda algo como
   `https://<proyecto>.supabase.co/storage/v1/object/public/brand/viva-logo-cream.png`.
4. **Supabase → SQL Editor** y ejecutar, con esa url:

```sql
update public.app_settings
   set logo_url = 'https://<proyecto>.supabase.co/storage/v1/object/public/brand/viva-logo-cream.png'
 where restaurant_id = '11111111-1111-4111-8111-111111111111';
```

5. En el telefono, tirar de la Home hacia abajo para recargar. El logo
   aparece sin reinstalar nada.

Para quitarlo y volver al texto: `set logo_url = null`.

## Por que no se toca el seed

`supabase/seed/seed_viva.sql` no escribe `logo_url` a proposito: la url
depende del proyecto de Supabase, y una url de otro proyecto en el seed
dejaria la cabecera con un hueco roto en cuanto alguien lo aplicara en el
suyo. El seed pone colores y nombre; el logo se sube una vez y se queda.

## Donde se usa

Hoy solo en la cabecera de la Home, sobre el verde primario — por eso la
version en crema. `app_settings` tiene una sola columna `logo_url`, asi
que si mas adelante hace falta el logotipo sobre fondo claro (una factura,
un correo), habra que anadir una segunda columna en vez de reutilizar
esta: el crema sobre blanco no se ve.
