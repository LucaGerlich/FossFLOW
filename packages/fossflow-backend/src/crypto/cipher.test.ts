import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'vitest';
import { createCipher, DecryptionError } from './cipher.js';

describe('credential cipher', () => {
  const master = randomBytes(32);
  const cipher = createCipher(master);

  it('round-trips data and never stores plaintext', () => {
    const sealed = cipher.encrypt({ url: 'https://beszel.example', password: 'hunter2' });
    assert.match(sealed, /^v1:/);
    assert.ok(!sealed.includes('hunter2'));
    assert.ok(!Buffer.from(sealed.slice(3), 'base64').toString('latin1').includes('hunter2'));
    assert.deepEqual(cipher.decrypt(sealed), { url: 'https://beszel.example', password: 'hunter2' });
  });

  it('uses a fresh nonce every time', () => {
    assert.notEqual(cipher.encrypt({ a: 1 }), cipher.encrypt({ a: 1 }));
  });

  it('detects tampering', () => {
    const sealed = cipher.encrypt({ password: 'hunter2' });
    const bytes = Buffer.from(sealed.slice(3), 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0x01;
    assert.throws(() => cipher.decrypt(`v1:${bytes.toString('base64')}`), DecryptionError);
  });

  it('refuses data sealed with another key, without leaking it', () => {
    const other = createCipher(randomBytes(32)).encrypt({ password: 'hunter2' });
    assert.throws(
      () => cipher.decrypt(other),
      (error: unknown) => {
        assert.ok(error instanceof DecryptionError);
        assert.ok(!String(error).includes('hunter2'));
        return true;
      }
    );
  });

  it('refuses unknown formats', () => {
    assert.throws(() => cipher.decrypt('v9:abc'), DecryptionError);
    assert.throws(() => cipher.decrypt('plain'), DecryptionError);
  });
});
