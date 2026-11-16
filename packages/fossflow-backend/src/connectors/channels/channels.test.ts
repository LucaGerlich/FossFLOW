import assert from 'node:assert/strict';
import { describe, it, vi } from 'vitest';
import type { Mailer } from '../../mail/mailer.js';
import type { PostResult } from '../outbound.js';
import { emailChannel } from './email.js';
import type { AlertMessage } from './message.js';
import { slackChannel } from './slack.js';
import { teamsChannel } from './teams.js';
import type { ChannelDeps } from './types.js';
import { webhookChannel } from './webhook.js';

const OK: PostResult = { ok: true, status: 200, retryAfterSeconds: null, error: null };
const LINK = 'https://x.io/projects/p/monitoring';
const LINE = 'Failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)';

const message: AlertMessage = {
  state: 'firing',
  kind: 'failing',
  ruleId: 'r1',
  ruleName: 'Member app → MagicLine',
  projectName: 'Team A',
  target: { type: 'arrow', from: 'service:Member app', to: 'service:MagicLine' },
  value: 4.1,
  threshold: 2,
  windowMinutes: 5,
  calls: 1260,
  sinceMinutes: null,
  startedAt: '2026-11-13T10:00:00.000Z',
  durationMinutes: null,
  url: LINK
};

function makeDeps(sendAlert = vi.fn(async () => {})) {
  const postJson = vi.fn(async () => OK);
  const mailer: Mailer = {
    enabled: true,
    sendInvitation: async () => {},
    sendPasswordReset: async () => {},
    sendAlert
  };
  return { deps: { postJson, mailer } as unknown as ChannelDeps & { postJson: typeof postJson }, postJson, sendAlert };
}

const accepts = (schema: { safeParse(v: unknown): { success: boolean } }, settings: unknown) =>
  schema.safeParse(settings).success;

describe('URL rules', () => {
  it('slack', () => {
    const ok = (url: string) => accepts(slackChannel.schema, { url });
    assert.equal(ok('https://hooks.slack.com/services/T/B/x'), true);
    assert.equal(ok('https://hooks.slack.com.evil.io/services/x'), false);
    assert.equal(ok('http://hooks.slack.com/services/x'), false);
    assert.equal(ok('https://hooks.slack.com/api/x'), false);
    assert.equal(ok('not a url'), false);
  });

  it('teams', () => {
    const ok = (url: string) => accepts(teamsChannel.schema, { url });
    assert.equal(
      ok('https://default1.westeurope.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/1/triggers/manual/paths/invoke?sig=x'),
      true
    );
    assert.equal(ok('https://prod-1.westus.logic.azure.com/workflows/1'), false);
    assert.equal(ok('https://api.powerplatform.com.evil.io/x'), false);
    assert.equal(ok('http://a.api.powerplatform.com/x'), false);
  });

  it('webhook', () => {
    const ok = (url: string) => accepts(webhookChannel.schema, { url });
    assert.equal(ok('https://hooks.internal.example:8443/in'), true);
    assert.equal(ok('https://user:pw@x.io'), false);
    assert.equal(ok('http://x.io'), false);
  });

  it('validation errors never echo the value', () => {
    const result = webhookChannel.schema.safeParse({ url: 'https://user:topsecret@x.io' });
    assert.equal(result.success, false);
    assert.ok(!JSON.stringify(result).includes('topsecret'));
  });

  it('email', () => {
    const ok = (to: string) => accepts(emailChannel.schema, { to });
    assert.equal(ok('a@x.io'), true);
    assert.equal(ok('a@x.io, b@x.io\nc@x.io'), true);
    assert.equal(ok(''), false);
    assert.equal(ok('nope'), false);
    assert.equal(ok(Array.from({ length: 21 }, (_, i) => `u${i}@x.io`).join(',')), false);
    assert.equal(ok(Array.from({ length: 20 }, (_, i) => `u${i}@x.io`).join(',')), true);
  });
});

describe('channel metadata', () => {
  it('marks only the URLs as secret', () => {
    for (const channel of [slackChannel, teamsChannel, webhookChannel]) {
      assert.deepEqual(channel.fields.map((f) => [f.name, f.secret]), [['url', true]]);
    }
    assert.deepEqual(emailChannel.fields.map((f) => [f.name, f.secret]), [['to', false]]);
    assert.deepEqual(
      [slackChannel.id, teamsChannel.id, webhookChannel.id, emailChannel.id],
      ['slack', 'teams', 'webhook', 'email']
    );
  });
});

describe('send', () => {
  it('slack posts text and refuses private targets', async () => {
    const { deps, postJson } = makeDeps();
    const result = await slackChannel.send({ url: 'https://hooks.slack.com/services/T/B/x' }, message, deps);
    assert.deepEqual(result, OK);
    const [url, body, options] = postJson.mock.calls[0] as unknown as [URL, unknown, unknown];
    assert.equal(url.href, 'https://hooks.slack.com/services/T/B/x');
    assert.deepEqual(body, { text: `${LINE}\n${LINK}` });
    assert.deepEqual(options, { allowPrivate: false });
  });

  it('teams posts an adaptive card', async () => {
    const { deps, postJson } = makeDeps();
    const target = 'https://d.environment.api.powerplatform.com/x?sig=1';
    await teamsChannel.send({ url: target }, message, deps);
    const [url, body, options] = postJson.mock.calls[0] as unknown as [URL, unknown, unknown];
    assert.equal(url.href, target);
    assert.deepEqual(body, {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [{ type: 'TextBlock', text: LINE, weight: 'Bolder', wrap: true }],
            actions: [{ type: 'Action.OpenUrl', title: 'Open monitoring', url: LINK }]
          }
        }
      ]
    });
    assert.deepEqual(options, { allowPrivate: false });
  });

  it('webhook posts the rule JSON and allows private targets', async () => {
    const { deps, postJson } = makeDeps();
    await webhookChannel.send({ url: 'https://hooks.internal.example/in' }, message, deps);
    const [, body, options] = postJson.mock.calls[0] as unknown as [URL, unknown, unknown];
    assert.deepEqual(body, {
      rule: { id: 'r1', name: 'Member app → MagicLine', kind: 'failing' },
      state: 'firing',
      target: { type: 'arrow', from: 'service:Member app', to: 'service:MagicLine' },
      value: 4.1,
      threshold: 2,
      windowMinutes: 5,
      startedAt: '2026-11-13T10:00:00.000Z',
      url: LINK
    });
    assert.deepEqual(options, { allowPrivate: true });
  });

  it('email sends subject, body and every recipient', async () => {
    const { deps, sendAlert } = makeDeps();
    const result = await emailChannel.send({ to: 'a@x.io, b@x.io' }, message, deps);
    assert.deepEqual(result, { ok: true, status: null, retryAfterSeconds: null, error: null });
    assert.deepEqual(sendAlert.mock.calls[0], [['a@x.io', 'b@x.io'], LINE, `${LINE}\n\n${LINK}`]);
  });

  it('email turns a thrown error into smtp', async () => {
    const { deps } = makeDeps(vi.fn(async () => { throw new Error('boom'); }));
    const result = await emailChannel.send({ to: 'a@x.io' }, message, deps);
    assert.deepEqual(result, { ok: false, status: null, retryAfterSeconds: null, error: 'smtp' });
  });
});
