import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readLiveConfig } from './config.ts';

const SECRET = 's3cret-Passw0rd';
const base = {
  BESZEL_URL: 'https://beszel.example.com/',
  BESZEL_EMAIL: 'readonly@example.com',
  BESZEL_PASSWORD: SECRET
};

describe('readLiveConfig', () => {
  it('is silently disabled when no source is configured', () => {
    assert.deepEqual(readLiveConfig({}), { ok: false, reason: null });
  });

  it('accepts a valid configuration and strips the trailing slash', () => {
    const result = readLiveConfig(base);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.config.beszel.url, 'https://beszel.example.com');
    assert.equal(result.config.pollSeconds, 30);
  });

  for (const [label, url] of [
    ['not a URL', 'beszel'],
    ['a non-http protocol', 'ftp://beszel.example.com'],
    ['embedded credentials', 'https://admin:hunter2@beszel.example.com']
  ] as const) {
    it(`rejects BESZEL_URL with ${label} without echoing it`, () => {
      const result = readLiveConfig({ ...base, BESZEL_URL: url });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.reason ?? '', /^BESZEL_URL /);
      assert.ok(!(result.reason ?? '').includes('hunter2'));
    });
  }

  it('requires an email and a password', () => {
    const noEmail = readLiveConfig({ ...base, BESZEL_EMAIL: ' ' });
    assert.deepEqual(noEmail, { ok: false, reason: 'BESZEL_EMAIL is not set' });
    const noPassword = readLiveConfig({ ...base, BESZEL_PASSWORD: undefined });
    assert.equal(noPassword.ok, false);
  });

  it('reads the password from BESZEL_PASSWORD_FILE and trims the newline', () => {
    const result = readLiveConfig(
      {
        ...base,
        BESZEL_PASSWORD: undefined,
        BESZEL_PASSWORD_FILE: '/run/secrets/beszel'
      },
      () => `${SECRET}\n`
    );
    assert.equal(result.ok && result.config.beszel.password, SECRET);
  });

  it('reports an unreadable password file', () => {
    const result = readLiveConfig(
      { ...base, BESZEL_PASSWORD: undefined, BESZEL_PASSWORD_FILE: '/missing' },
      () => {
        throw new Error('ENOENT');
      }
    );
    assert.deepEqual(result, {
      ok: false,
      reason: 'BESZEL_PASSWORD_FILE could not be read'
    });
  });

  it('validates LIVE_POLL_SECONDS', () => {
    assert.equal(readLiveConfig({ ...base, LIVE_POLL_SECONDS: '5' }).ok, false);
    assert.equal(
      readLiveConfig({ ...base, LIVE_POLL_SECONDS: 'soon' }).ok,
      false
    );
    const ok = readLiveConfig({ ...base, LIVE_POLL_SECONDS: '60' });
    assert.equal(ok.ok && ok.config.pollSeconds, 60);
  });

  it('never puts the password into a reason', () => {
    for (const env of [
      { ...base, BESZEL_URL: SECRET },
      { ...base, LIVE_POLL_SECONDS: SECRET },
      { ...base, BESZEL_EMAIL: '' }
    ]) {
      const result = readLiveConfig(env);
      assert.ok(!JSON.stringify(result).includes(SECRET));
    }
  });
});
