import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const DATABASE_URL = 'postgres://fossflow:s3cret-pass@db:5432/fossflow';

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig({ DATABASE_URL });
    assert.equal(config.databaseUrl, DATABASE_URL);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3001);
    assert.equal(config.live.ok, false);
  });

  it('reads host and port', () => {
    const config = loadConfig({
      DATABASE_URL,
      BACKEND_HOST: '0.0.0.0',
      BACKEND_PORT: '4000'
    });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 4000);
  });

  it('requires DATABASE_URL', () => {
    assert.throws(() => loadConfig({}), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /DATABASE_URL is required/);
      return true;
    });
  });

  it('never echoes a bad DATABASE_URL, which may hold a password', () => {
    const leaky = 'mysql://root:hunter2@db/fossflow';
    assert.throws(() => loadConfig({ DATABASE_URL: leaky }), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /DATABASE_URL must be a postgres/);
      assert.ok(!error.message.includes('hunter2'));
      return true;
    });
  });

  it('rejects an out-of-range port', () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL, BACKEND_PORT: '70000' }),
      /BACKEND_PORT/
    );
  });
});
