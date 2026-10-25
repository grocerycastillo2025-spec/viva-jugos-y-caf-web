/**
 * La URL que Clover compara byte a byte.
 *
 * Estas pruebas parecen triviales —comprobar una cadena— y son las que
 * impiden el fallo más caro de este flujo: un `redirect_uri` que no
 * coincide con el registrado. Ese fallo no llega a nuestros logs; ocurre en
 * una pantalla de Clover, del lado del merchant.
 *
 * Si alguna de estas se rompe porque el cambio era a propósito, HAY QUE
 * VOLVER AL DEVELOPER DASHBOARD DE CLOVER. La prueba no está para pasar,
 * está para acordarse.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRegisteredRedirectUri,
  cloverLaunchUri,
  cloverRedirectUri,
  functionsBaseUrl,
  FUNCTION_NAME,
  RedirectUriError,
  ROUTES,
} from '../redirect-uri.ts';

const PROYECTO = 'https://abcdefghijklmnop.supabase.co';

test('LA URL REGISTRADA EN CLOVER: si cambia, hay que ir al dashboard', () => {
  assert.equal(
    cloverRedirectUri(PROYECTO),
    'https://abcdefghijklmnop.supabase.co/functions/v1/oauth/callback',
  );
});

test('EL ALTERNATE LAUNCH PATH: si cambia, hay que ir al dashboard', () => {
  // La segunda cadena que se pega en el mismo dashboard. Aquí aterriza el
  // merchant que instala desde el App Market.
  assert.equal(
    cloverLaunchUri(PROYECTO),
    'https://abcdefghijklmnop.supabase.co/functions/v1/oauth/launch',
  );
});

test('el launch path NO es el callback', () => {
  // Registrar uno en el sitio del otro es el error facil de cometer y
  // dificil de ver: el callback recibiria un aterrizaje sin `code`, y el
  // aterrizaje recibiria un `code` que no sabe canjear.
  assert.notEqual(cloverLaunchUri(PROYECTO), cloverRedirectUri(PROYECTO));
});

test('el nombre de la funcion es el que decide la URL', () => {
  // Renombrar `supabase/functions/oauth/` cambia las URL registradas. Que
  // las constantes estén fijadas aquí obliga a enterarse.
  assert.equal(FUNCTION_NAME, 'oauth');
  assert.equal(ROUTES.callback, '/callback');
  assert.equal(ROUTES.launch, '/launch');
});

test('sin barra final: es la forma que espera Clover', () => {
  const uri = cloverRedirectUri(PROYECTO);
  assert.equal(uri.endsWith('/'), false);
  assert.equal(uri, new URL(uri).toString());
});

test('la base de funciones sale del origen de SUPABASE_URL', () => {
  assert.equal(
    functionsBaseUrl(PROYECTO),
    'https://abcdefghijklmnop.supabase.co/functions/v1',
  );
});

test('SUPABASE_URL con ruta se rechaza: no es un origen', () => {
  assert.throws(() => functionsBaseUrl(`${PROYECTO}/functions/v1`), RedirectUriError);
});

test('http se rechaza aunque el sandbox a veces lo tolere', () => {
  // El peor caso posible: funciona mientras se prueba y falla al publicar.
  assert.throws(() => functionsBaseUrl('http://abc.supabase.co'), RedirectUriError);
});

test('una CLOVER_REDIRECT_URL correcta pasa tal cual', () => {
  const buena = cloverRedirectUri(PROYECTO);
  assert.equal(assertRegisteredRedirectUri(buena, PROYECTO), buena);
});

test('LA BARRA FINAL DE MAS revienta el arranque, que es donde debe doler', () => {
  assert.throws(
    () => assertRegisteredRedirectUri(`${cloverRedirectUri(PROYECTO)}/`, PROYECTO),
    RedirectUriError,
  );
});

test('una CLOVER_REDIRECT_URL que apunta a otro sitio revienta el arranque', () => {
  assert.throws(
    () =>
      assertRegisteredRedirectUri(
        'https://admin.tudominio.com/api/clover/callback',
        PROYECTO,
      ),
    // Este es exactamente el valor que arrastraba `.env.example` antes de
    // decidir que el callback vive en la Edge Function. Si alguien lo
    // recupera de un `.env` viejo, el despliegue no arranca.
    RedirectUriError,
  );
});
