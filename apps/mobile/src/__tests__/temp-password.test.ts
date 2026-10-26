import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tempPassword } from '../domain/temp-password.ts';

describe('contraseña temporal', () => {
  it('largo, con número y sin caracteres confusos', () => {
    for (let i = 0; i < 50; i += 1) {
      const p = tempPassword();
      assert.equal(p.length, 10);
      assert.match(p, /\d/);
      assert.doesNotMatch(p, /[0O1lI]/);
    }
  });
});
