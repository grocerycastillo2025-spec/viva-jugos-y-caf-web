import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { authErrorKey } from '../domain/auth-errors.ts';

describe('errores de acceso', () => {
  it('traduce los de Supabase', () => {
    assert.equal(authErrorKey('Invalid login credentials'), 'invalid_credentials');
    assert.equal(authErrorKey('Email not confirmed'), 'email_not_confirmed');
    assert.equal(authErrorKey('User already registered'), 'already_registered');
    assert.equal(authErrorKey('email rate limit exceeded'), 'rate_limit');
    assert.equal(authErrorKey('For security purposes, you can only request this after 37 seconds.'), 'rate_limit');
    assert.equal(authErrorKey('Password should be at least 6 characters.'), 'weak_password');
    assert.equal(authErrorKey('Unable to validate email address: invalid format'), 'invalid_email');
    assert.equal(authErrorKey('Failed to fetch'), 'network');
    assert.equal(authErrorKey('???'), 'other');
  });
});
