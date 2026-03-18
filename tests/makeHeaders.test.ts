import { test } from 'vitest';
import assert from 'node:assert/strict';

import { makeHeaders } from '@rt/twitter/makeHeaders';

test('build headers with cookie, csrf, and bearer', () => {
  const headers = makeHeaders({
    authToken: 'auth123',
    ct0: 'csrf123',
    bearerToken: 'bearer123',
  });

  assert.equal(headers['X-Csrf-Token'], 'csrf123');
  assert.equal(headers.Authorization, 'Bearer bearer123');
  assert.equal(headers.Cookie, 'auth_token=auth123; ct0=csrf123;');
  assert.equal(headers['X-Twitter-Auth-Type'], 'OAuth2Session');
});

test('throw when auth-token is missing', () => {
  assert.throws(() => makeHeaders({ authToken: '', ct0: 'csrf', bearerToken: 'bearer' }), { message: /--auth-token/ });
});

test('throw when ct0 is missing', () => {
  assert.throws(() => makeHeaders({ authToken: 'auth', ct0: '', bearerToken: 'bearer' }), {
    message: /--ct0/,
  });
});

test('throw when bearer token is missing', () => {
  assert.throws(() => makeHeaders({ authToken: 'auth', ct0: 'csrf', bearerToken: '' }), {
    message: /Bearer token is missing/i,
  });
});

