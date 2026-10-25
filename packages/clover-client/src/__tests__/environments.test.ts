/**
 * Los cuatro hosts. Equivocarse de uno no da un 404 claro: da un 401.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CloverConfigError, resolveHosts } from '../environments.ts';

test('sandbox resuelve las cuatro APIs a dominios distintos', () => {
  const h = resolveHosts('sandbox');
  assert.equal(h.platform, 'https://apisandbox.dev.clover.com');
  assert.equal(h.oauth, 'https://sandbox.dev.clover.com');
  assert.equal(h.ecommerce, 'https://scl-sandbox.dev.clover.com');
  assert.equal(h.token, 'https://token-sandbox.dev.clover.com');

  // Que sean cuatro valores distintos es la mitad del sentido del modulo.
  assert.equal(new Set(Object.values(h)).size, 4);
});

test('produccion resuelve las cuatro APIs a dominios distintos', () => {
  // El de tokenizacion estuvo sin confirmar y hacia fallar el arranque.
  // Ya esta verificado contra la tabla de urls de sandbox y produccion de
  // "Ecommerce API tutorials", asi que produccion arranca sola.
  const h = resolveHosts('na-production');
  assert.equal(h.platform, 'https://api.clover.com');
  assert.equal(h.oauth, 'https://www.clover.com');
  assert.equal(h.ecommerce, 'https://scl.clover.com');
  assert.equal(h.token, 'https://token.clover.com');

  assert.equal(new Set(Object.values(h)).size, 4);
});

test('el host de oauth es SOLO para authorize, no para token ni refresh', () => {
  // La contradiccion que quedo abierta en la PR 1. La tabla de la
  // documentacion, identica en las tres paginas del flujo v2/OAuth, pone
  // /oauth/v2/token y /oauth/v2/refresh en el host de PLATAFORMA. Este
  // test lo fija: si alguien "corrige" oauth.ts para mandar el canje al
  // host de oauth, el sintoma real seria un 401 sin explicacion.
  for (const env of ['sandbox', 'na-production'] as const) {
    const h = resolveHosts(env);
    assert.notEqual(h.oauth, h.platform);
  }
});

test('una sobrescritura vacia no pasa por defecto silenciosamente', () => {
  // El unico camino que queda hasta el error de host ausente, ahora que
  // los ocho estan puestos. Vale la pena que siga cerrado.
  assert.throws(() => resolveHosts('na-production', { token: '' }), (e: unknown) => {
    assert.ok(e instanceof CloverConfigError);
    assert.match(e.message, /token/);
    return true;
  });
});

test('rechaza http y normaliza la barra final', () => {
  assert.throws(
    () => resolveHosts('sandbox', { platform: 'http://apisandbox.dev.clover.com' }),
    /https:/,
  );
  // Sin esto, las rutas concatenadas dan '...com//v3/...'.
  const h = resolveHosts('sandbox', { platform: 'https://apisandbox.dev.clover.com/' });
  assert.equal(h.platform, 'https://apisandbox.dev.clover.com');
});

test('una url invalida se descubre al arrancar, no en la primera peticion', () => {
  assert.throws(() => resolveHosts('sandbox', { ecommerce: 'no-es-una-url' }), CloverConfigError);
});
