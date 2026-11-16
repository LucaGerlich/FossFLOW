import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, vi } from 'vitest';
import type { AlertMessage } from '../connectors/channels/message.js';
import { webhookChannel } from '../connectors/channels/webhook.js';
import type { ChannelDeps } from '../connectors/channels/types.js';
import type { PostResult } from '../connectors/outbound.js';
import { setupBlocks } from './setup-blocks.js';

const doc = (): string => readFileSync(new URL('../../../../docs/TRAFFIC.md', import.meta.url), 'utf8');

const OK: PostResult = { ok: true, status: 200, retryAfterSeconds: null, error: null };

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
  url: 'https://fossflow.example.com/projects/p/monitoring'
};

describe('docs/TRAFFIC.md stays in step with the code', () => {
  it('shows every setup line with the doc placeholders', () => {
    const text = doc();
    const blocks = setupBlocks({
      endpoint: 'https://fossflow.example.com/api/otlp',
      key: 'ffi_REPLACE_ME',
      serviceName: 'member-app'
    });
    for (const block of blocks) {
      for (const step of block.steps) {
        for (const line of step.code.split('\n').filter((entry) => entry.trim() !== '')) {
          assert.ok(text.includes(line), `${block.id} line missing from the doc: ${line}`);
        }
      }
    }
  });

  it('documents every webhook field', async () => {
    const text = doc();
    const postJson = vi.fn(async (..._args: unknown[]) => OK);
    await webhookChannel.send({ url: 'https://hooks.example.com/in' }, message, { postJson } as unknown as ChannelDeps);
    const body = postJson.mock.calls[0]?.[1] as Record<string, unknown> & { rule: Record<string, unknown> };
    assert.ok(body, 'the webhook posted nothing');
    for (const key of [...Object.keys(body), ...Object.keys(body.rule)]) {
      assert.ok(text.includes('`' + key + '`'), `webhook field \`${key}\` missing from the doc`);
    }
    for (const state of ['firing', 'reminder', 'resolved', 'test']) {
      assert.ok(text.includes('`' + state + '`'), `webhook state \`${state}\` missing from the doc`);
    }
  });
});
