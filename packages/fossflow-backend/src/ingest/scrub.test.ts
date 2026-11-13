import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cap, templatePath } from './scrub.js';

describe('templatePath', () => {
  it.each([
    ['/v1/customers/12345', '/v1/customers/{id}'],
    [
      '/v1/customers/9f8b2c1e-1d2a-4c3b-9a8f-0e1d2c3b4a59/contracts',
      '/v1/customers/{id}/contracts'
    ],
    ['/files/a3f5c9e2b1d4f6a8', '/files/{id}'],
    ['/users/jane.doe@example.com/settings', '/users/{id}/settings'],
    ['/users/jane%40example.com', '/users/{id}'],
    ['/sessions/eyJhbGciOiJIUzI1NiJ9abc123', '/sessions/{id}'],
    ['/orders/INV-2026-004211', '/orders/{id}'],
    ['/call/+4917612345678', '/call/{id}'],
    ['/v1/classes', '/v1/classes'],
    ['/api/v2/health', '/api/v2/health'],
    ['/blog/how-to-train', '/blog/how-to-train'],
    ['/users/jane%2540example.com', '/users/{id}'],
    ['/x;jsessionid=abc/orders', '/x/orders'],
    ['/t/abcdefghijklmnopqrstuvwxyzabcdef', '/t/{id}'],
    ['/', '/']
  ])('templates %s', (input, expected) => {
    assert.equal(templatePath(input), expected);
  });

  it('keeps a malformed escape as a literal segment', () => {
    assert.equal(templatePath('/a/%E0%A4%A'), '/a/%E0%A4%A');
  });
});

describe('cap', () => {
  it('cuts to 300 characters by default and honours a custom max', () => {
    assert.equal(cap('x'.repeat(400)).length, 300);
    assert.equal(cap('abcdef', 3), 'abc');
    assert.equal(cap('abc'), 'abc');
  });
});
