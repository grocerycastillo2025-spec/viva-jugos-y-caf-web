# iOS — lo que aplicará cuando llegue la fase 16

Notas tomadas durante el desarrollo de Android, para no redescubrirlas
más adelante. **Nada de esto bloquea el trabajo actual.**

---

## 1. Lo que se reutiliza tal cual

Prácticamente todo, que es la razón de haber elegido React Native y Expo:

- Todo el código de la app: pantallas, navegación, carrito, checkout,
  lógica de pedidos, textos, estados de error
- La base de datos completa, las políticas RLS, el catálogo
- La integración con Clover: no sabe qué sistema operativo usa el cliente
- El branding dinámico desde `app_settings`
- El logotipo, aunque el icono necesita una variante (ver punto 4)

---

## 2. Notificaciones: cambia el proveedor

Android va por **FCM** (Firebase). iOS va por **APNs**, el servicio de Apple.

Hace falta una **clave de notificaciones** generada desde la cuenta de
Apple Developer, distinta del `google-services.json` que usamos en Android.
Expo gestiona ambas, pero son dos credenciales separadas y hay que
configurar cada una por su lado.

El código de la app no cambia; solo las credenciales.

---

## 3. Firma y credenciales

| | Android | iOS |
|---|---|---|
| Firma | keystore (ya creado, en EAS) | certificados + perfiles de aprovisionamiento |
| Ligado a | la cuenta de Expo | la cuenta de Apple Developer |
| Costo | 25 USD, pago único | 99 USD al año |

Para distribución interna en iOS hay que **registrar cada iPhone por su
UDID**, con un tope de 100 dispositivos al año. Alternativa más cómoda
para repartir: TestFlight, que pasa por una revisión de Apple.

---

## 4. El icono

Apple lo quiere **sin esquinas redondeadas y sin transparencia**: el
sistema aplica la máscara. El nuestro es verde sólido con el logotipo
en crema, así que sirve; solo hay que exportar la variante sin el
redondeo que Android tolera.

---

## 5. Pagos — revisar antes de publicar ⚠️

Apple es estricta con lo que se cobra dentro de una app.

Comprar comida para recoger en un local físico **está permitido con pago
externo**: es el mismo caso que Uber Eats o Starbucks, y es exactamente
nuestro escenario con Clover.

**Pero** si algún día se venden suscripciones o bienes digitales dentro
de la app, Apple exige su sistema de pagos con comisión. Revisar las
guidelines vigentes antes de publicar, porque cambian.

---

## 6. Revisión y el riesgo del modelo white-label ⚠️

Google publica en horas. Apple revisa manualmente y puede rechazar.

Y sigue abierto el **riesgo R11** del documento de arquitectura: Apple ha
aplicado históricamente restricciones a las apps generadas desde
plantillas comercializadas, exigiendo en muchos casos que las publique el
cliente final bajo su propia cuenta de developer.

**Esto es una decisión de modelo de negocio, no técnica**, y hay que
resolverla antes de vender "una app por restaurante". Ver §19 del
documento de arquitectura.

---

## 7. Lo único que conviene adelantar

**Abrir la cuenta de Apple Developer.** No para compilar, sino porque:

- La verificación tarda, sobre todo como organización con número D-U-N-S
- Se necesita para investigar el punto 6, que afecta al precio y al
  empaquetado comercial

Lo demás puede esperar a la fase 16.
