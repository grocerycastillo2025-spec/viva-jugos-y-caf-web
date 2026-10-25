# Compatibilidad con versiones de Android

Reglas obligatorias para `apps/mobile`. Verificado contra la política de Google Play en agosto de 2026.

---

## 1. Los dos números que hay que distinguir

Se confunden todo el tiempo y hacen cosas opuestas:

| | Qué controla | Nuestro valor |
|---|---|---|
| **`minSdkVersion`** | El teléfono **más viejo** que puede instalar la app | **24** (Android 7) |
| **`targetSdkVersion`** | Contra qué versión de Android está escrita la app | **36** (Android 16) |

Subir `targetSdk` **no** deja fuera a los teléfonos viejos. Un usuario con Android 9 sigue usando la app aunque apuntemos a Android 16. Lo que se pierde bajando `minSdk` es cobertura; lo que se pierde no subiendo `targetSdk` es el derecho a publicar.

---

## 2. El requisito vigente

Desde el **31 de agosto de 2026**, Google Play exige que toda app nueva y toda actualización apunte a **Android 16 (API 36)** o superior. Las apps ya publicadas que se queden por debajo de API 35 dejan de ser visibles para usuarios nuevos en dispositivos más recientes, aunque quien ya la tenga instalada la conserva.

Como nuestra app se publica por primera vez después de esa fecha, **nace con `targetSdk 36`**. No hay migración que hacer, solo no equivocarse al configurarla.

### Esto se repite cada año

La cadencia es fija: API 34 se exigió en agosto de 2024, API 35 en agosto de 2025, API 36 en agosto de 2026. Un ingeniero de Android ya adelantó públicamente que **API 37 será obligatorio en agosto de 2027**.

**Consecuencia operativa:** hay que presupuestar una actualización anual, entre junio y agosto de cada año, solo para compatibilidad. No es opcional y no es negociable. Ponlo en el calendario ahora.

---

## 3. Lo que de verdad cuesta trabajo

Cambiar el número en la configuración toma un minuto. Lo que cuesta son los **cambios de comportamiento** que trae cada versión. Para Android 16 en concreto:

- **En pantallas de 600dp o más, la app ya no puede bloquear la orientación ni la relación de aspecto.** Si diseñamos asumiendo solo vertical, en tablets se rompe.
- **Desapareció la posibilidad de desactivar el modo edge-to-edge.** El contenido se dibuja debajo de las barras de sistema y hay que gestionar los insets a mano.

**Reglas de diseño derivadas, obligatorias desde la fase 3:**

1. Nada de bloquear orientación. El layout se adapta.
2. Todas las pantallas usan safe area insets. Nada de padding fijo para la barra de estado.
3. Probar en tablet, no solo en teléfono, aunque el público objetivo sea móvil.

Adoptarlas ahora es gratis. Corregirlas cuando ya hay 22 pantallas escritas, no.

---

## 4. El riesgo real: las dependencias nativas

La app rara vez es el problema. El problema son las librerías de terceros con código nativo que dejan de mantenerse: cuando llega el año de subir el target, esa librería no compila, el proyecto que la mantenía está abandonado, y hay que reemplazarla a contrarreloj.

**Reglas para elegir dependencias:**

- Preferir siempre los módulos del propio ecosistema Expo, que se actualizan con cada SDK.
- Antes de añadir una librería con código nativo, revisar la fecha del último commit. Más de seis meses sin actividad es señal de alarma.
- Cada dependencia nativa nueva se justifica por escrito. Las de JavaScript puro no tienen este problema.

Esto pega directo en los pagos: cualquier SDK nativo de pago sería justo el tipo de dependencia que puede bloquear una actualización anual.

---

## 5. Por qué esto nos favorece en el cobro online

La decisión de arquitectura que ya tomamos —usar el **iframe alojado de Clover dentro de un WebView**, en vez de un SDK nativo de pagos— resulta ser también la más resistente al paso de las versiones de Android:

- El WebView de Android se actualiza **desde Play Store, independientemente de la versión del sistema operativo**. Un teléfono con Android 9 tiene un WebView moderno.
- No hay SDK de pagos nativo que mantener ni que pueda romperse al subir el target.
- El alcance PCI se mantiene mínimo.

Lo elegimos por seguridad y por no meternos en un alcance PCI grande. Que además nos quite el riesgo de compatibilidad anual es una ventaja añadida.

---

## 6. Verificaciones pendientes

- [ ] Confirmar qué versión de Expo SDK apunta a API 36 y usar esa, no una anterior
- [ ] Requisito de **páginas de 16 KB**: los dispositivos Android 15+ lo exigen para código nativo. Verificar si aplica a nuestras dependencias antes del primer build de producción
- [ ] Probar en un dispositivo real con Android 16 antes de publicar, no solo en emulador

---

## 7. Resumen para configurar

```
minSdkVersion    24     (Android 7 — cobertura prácticamente total)
targetSdkVersion 36     (Android 16 — obligatorio para publicar)
compileSdkVersion 36
```

En Expo esto se fija con `expo-build-properties` en `app.json`, no editando Gradle a mano.

**Y una fecha en el calendario: junio de 2027, subir a API 37.**
