import { Logger } from '@nestjs/common';
import assert from 'node:assert/strict';
import { afterEach, describe, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn((_options: Record<string, unknown>) => ({ sendMail }));
vi.mock('nodemailer', () => ({
  default: { createTransport: (options: Record<string, unknown>) => createTransport(options) }
}));

const { createMailer } = await import('./mailer.js');

afterEach(() => {
  vi.restoreAllMocks();
  sendMail.mockReset();
});

describe('mailer transport', () => {
  it('gives up on a silent SMTP server after 10 seconds', () => {
    createMailer({ host: 'h', port: 25, secure: false, user: '', password: '', from: 'f@example.com' });
    const options = createTransport.mock.calls.at(-1)?.[0];
    assert.equal(options?.connectionTimeout, 10_000);
    assert.equal(options?.greetingTimeout, 10_000);
    assert.equal(options?.socketTimeout, 10_000);
  });
});

describe('mailer logging', () => {
  it('logs neither the subject nor the error message, and rethrows', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    class SmtpError extends Error {
      override name = 'SmtpError';
    }
    sendMail.mockRejectedValue(new SmtpError('550 rejected ops@example.com'));
    const mailer = createMailer({
      host: 'h', port: 25, secure: false, user: '', password: '', from: 'f@example.com'
    });
    await assert.rejects(mailer.sendAlert(['ops@example.com'], 'Failing · Secret rule · 4%', 'body'));
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    assert.match(logged, /SmtpError/);
    assert.ok(!logged.includes('Secret rule'));
    assert.ok(!logged.includes('ops@example.com'));
    assert.ok(!logged.includes('550'));
  });
});
