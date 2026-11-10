import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { ConfigError } from '../config/config.js';
import { deriveKey, loadMasterKey } from './master-key.js';

const silent = { warn: () => {} };
const tempDir = () => mkdtempSync(join(tmpdir(), 'fossflow-key-'));

describe('loadMasterKey', () => {
  it('generates a 32-byte key once, stores it owner-only, and reuses it', () => {
    const dataDir = tempDir();
    const warnings: string[] = [];
    const first = loadMasterKey({ dataDir }, { warn: (m) => warnings.push(m) });
    assert.equal(first.length, 32);
    assert.match(warnings.join(' '), /back it up/i);

    const file = join(dataDir, 'config', 'encryption-key');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(loadMasterKey({ dataDir }, silent), first);
  });

  it('prefers FOSSFLOW_ENCRYPTION_KEY and writes nothing', () => {
    const dataDir = tempDir();
    const key = randomBytes(32);
    const loaded = loadMasterKey({ dataDir, envKey: key.toString('base64') }, silent);
    assert.deepEqual(loaded, key);
    assert.throws(() => statSync(join(dataDir, 'config', 'encryption-key')));
  });

  it('rejects a wrong-length key without echoing it', () => {
    const secret = randomBytes(16).toString('base64');
    assert.throws(
      () => loadMasterKey({ dataDir: tempDir(), envKey: secret }, silent),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /32 bytes/);
        assert.ok(!error.message.includes(secret));
        return true;
      }
    );
  });

  it('refuses a damaged key file instead of silently replacing it', () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'config'), { recursive: true });
    writeFileSync(join(dataDir, 'config', 'encryption-key'), 'not a key\n');
    assert.throws(() => loadMasterKey({ dataDir }, silent), /encryption-key/);
    assert.equal(
      readFileSync(join(dataDir, 'config', 'encryption-key'), 'utf8'),
      'not a key\n'
    );
  });
});

describe('deriveKey', () => {
  it('is deterministic per purpose and differs between purposes', () => {
    const master = randomBytes(32);
    assert.deepEqual(deriveKey(master, 'auth'), deriveKey(master, 'auth'));
    assert.notDeepEqual(deriveKey(master, 'auth'), deriveKey(master, 'credentials-v1'));
    assert.equal(deriveKey(master, 'auth').length, 32);
  });
});
