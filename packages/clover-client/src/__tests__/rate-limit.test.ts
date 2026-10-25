import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TokenBucket,
  CloverRateLimiter,
  backoffMs,
  isRetryable,
  rateLimitKind,
  CircuitBreaker,
  CLOVER_LIMITS,
} from '../rate-limit.ts';

/** Reloj falso para no depender del tiempo real en los tests. */
function fakeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('TokenBucket se agota y se rellena de forma continua', () => {
  const c = fakeClock();
  const b = new TokenBucket(10, 10, c.now);

  for (let i = 0; i < 10; i++) assert.equal(b.tryTake(), true);
  assert.equal(b.tryTake(), false, 'el bucket debe agotarse');

  c.advance(500); // medio segundo -> 5 tokens
  assert.equal(Math.floor(b.available), 5);

  c.advance(10_000);
  assert.equal(b.available, 10, 'nunca debe superar su capacidad');
});

test('TokenBucket calcula la espera hasta el siguiente token', () => {
  const c = fakeClock();
  const b = new TokenBucket(1, 2, c.now); // 2 por segundo
  assert.equal(b.tryTake(), true);
  const wait = b.msUntilAvailable();
  assert.ok(wait > 400 && wait <= 500, `espera esperada ~500ms, fue ${wait}`);
});

test('el límite por merchant es 16/s aunque el global tenga margen', () => {
  const c = fakeClock();
  const rl = new CloverRateLimiter(c.now);

  let ok = 0;
  for (let i = 0; i < 30; i++) {
    if (rl.tryAcquire('MERCHANT_A', 'transactional')) ok++;
  }
  assert.equal(ok, CLOVER_LIMITS.tokenRequestsPerSecond,
    'un solo merchant no puede pasar de 16 req/s');
});

test('el techo global de 50/s se comparte entre merchants', () => {
  const c = fakeClock();
  const rl = new CloverRateLimiter(c.now);

  let ok = 0;
  for (let m = 0; m < 10; m++) {
    for (let i = 0; i < 16; i++) {
      if (rl.tryAcquire(`MERCHANT_${m}`, 'transactional')) ok++;
    }
  }
  assert.equal(ok, CLOVER_LIMITS.appRequestsPerSecond,
    '10 merchants pidiendo a la vez no deben superar 50 req/s de app');
});

test('el catálogo se limita a su cuota y no invade lo transaccional', () => {
  const c = fakeClock();
  const rl = new CloverRateLimiter(c.now);

  let catalog = 0;
  for (let m = 0; m < 5; m++) {
    for (let i = 0; i < 16; i++) {
      if (rl.tryAcquire(`M${m}`, 'catalog')) catalog++;
    }
  }
  // 25% de 50 = 12.5 -> capacidad inicial 12.5, se consumen 12
  assert.ok(catalog <= 13, `el catálogo consumió ${catalog}, debía respetar su cuota`);

  // Queda presupuesto global para pedidos en curso.
  assert.equal(rl.tryAcquire('URGENTE', 'transactional'), true,
    'un pedido en curso debe poder pasar aunque el catálogo esté saturado');
});

test('backoff respeta retry-after por encima del cálculo propio', () => {
  const noJitter = () => 0;
  assert.equal(backoffMs(1, 21, noJitter), 21_000, 'retry-after manda');
  assert.equal(backoffMs(0, undefined, noJitter), 1_000);
  assert.equal(backoffMs(3, undefined, noJitter), 8_000);
  assert.equal(backoffMs(10, undefined, noJitter), 30_000, 'debe topar en 30s');
});

test('clasificación de errores reintentables', () => {
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(502), true);  // frecuente en sandbox
  assert.equal(isRetryable(400), false);
  assert.equal(isRetryable(401), false); // token inválido: no reintentar, refrescar
  assert.equal(isRetryable(404), false);
});

test('identifica cuál de los cuatro límites disparó el 429', () => {
  assert.equal(rateLimitKind({ 'X-RateLimit-tokenLimit': '16' }), 'token');
  assert.equal(rateLimitKind({ 'X-RateLimit-crossTokenLimit': '50' }), 'app');
  assert.equal(rateLimitKind({ 'X-RateLimit-tokenConcurrentLimit': '5' }), 'token-concurrent');
  assert.equal(rateLimitKind({ 'X-RateLimit-crossTokenConcurrentLimit': '10' }), 'app-concurrent');
  assert.equal(rateLimitKind({}), 'unknown');
});

test('el circuit breaker aísla un merchant y se recupera solo', () => {
  const c = fakeClock();
  const cb = new CircuitBreaker(3, 60_000, c.now);

  cb.recordFailure();
  cb.recordFailure();
  assert.equal(cb.isOpen, false);

  cb.recordFailure();
  assert.equal(cb.isOpen, true, 'al tercer fallo debe abrirse');

  c.advance(59_000);
  assert.equal(cb.isOpen, true);

  c.advance(2_000);
  assert.equal(cb.isOpen, false, 'pasado el cooldown debe cerrarse');
});
