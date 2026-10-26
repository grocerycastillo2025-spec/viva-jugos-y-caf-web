import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { leerNuevaCuenta } from '../validar.ts';

const OK = {
  restaurant_id: '11111111-1111-4111-8111-111111111111',
  email: ' Cajero@Correo.MX ',
  password: 'temporal123',
  name: 'Pepe',
  role: 'staff',
};

describe('crear cuenta del equipo', () => {
  it('acepta y normaliza', () => {
    const r = leerNuevaCuenta(OK);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.cuenta.email, 'cajero@correo.mx');
  });
  it('rechaza lo inválido', () => {
    assert.deepEqual(leerNuevaCuenta({ ...OK, email: 'nope' }), { ok: false, error: 'correo_invalido' });
    assert.deepEqual(leerNuevaCuenta({ ...OK, password: 'corta' }), { ok: false, error: 'contrasena_corta' });
    assert.deepEqual(leerNuevaCuenta({ ...OK, role: 'admin' }), { ok: false, error: 'rol_invalido' });
    assert.deepEqual(leerNuevaCuenta({ ...OK, name: '  ' }), { ok: false, error: 'nombre_invalido' });
    assert.deepEqual(leerNuevaCuenta({ ...OK, restaurant_id: 'x' }), { ok: false, error: 'restaurante_invalido' });
    assert.deepEqual(leerNuevaCuenta(null), { ok: false, error: 'restaurante_invalido' });
  });
});
