import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  alertLine,
  formatCount,
  formatDuration,
  formatMinutes,
  type AlertMessage
} from './message.js';

const base: AlertMessage = {
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
  startedAt: null,
  durationMinutes: null,
  url: 'https://x.io/projects/p/monitoring'
};

describe('alertLine', () => {
  it('failing', () => {
    assert.equal(
      alertLine(base),
      'Failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)'
    );
  });

  it('slow', () => {
    assert.equal(
      alertLine({
        ...base,
        kind: 'slow',
        ruleName: 'Web → DB',
        value: 1200,
        threshold: 800,
        windowMinutes: 10,
        calls: 300
      }),
      'Slow · Web → DB · p95 1.2 s over 300 calls in the last 10 min (threshold 800 ms)'
    );
  });

  it('silent', () => {
    assert.equal(
      alertLine({
        ...base,
        kind: 'silent',
        ruleName: 'Nightly sync',
        value: null,
        threshold: 120,
        windowMinutes: null,
        calls: null,
        sinceMinutes: 125
      }),
      'Silent · Nightly sync · no calls for 2 h 5 min (threshold 2 h)'
    );
  });

  it('reminders say Still', () => {
    assert.equal(
      alertLine({ ...base, state: 'reminder' }),
      'Still failing · Member app → MagicLine · 4.1% of 1,260 calls failed in the last 5 min (threshold 2%)'
    );
    assert.ok(alertLine({ ...base, state: 'reminder', kind: 'slow', value: 900, threshold: 800, calls: 3 }).startsWith('Still slow · '));
    assert.ok(alertLine({ ...base, state: 'reminder', kind: 'silent', sinceMinutes: 10, threshold: 5 }).startsWith('Still silent · '));
  });

  it('resolved', () => {
    assert.equal(
      alertLine({ ...base, state: 'resolved', durationMinutes: 23 }),
      'Resolved · Member app → MagicLine · failing for 23 min'
    );
  });

  it('test', () => {
    assert.equal(
      alertLine({ ...base, state: 'test', kind: null, ruleId: null, ruleName: 'Test' }),
      'Test · Team A · FossFLOW alerts will arrive here'
    );
  });
});

describe('formatters', () => {
  it('formatCount uses en-US separators', () => {
    assert.equal(formatCount(1260), '1,260');
    assert.equal(formatCount(7), '7');
  });

  it('formatDuration', () => {
    assert.equal(formatDuration(95), '95 ms');
    assert.equal(formatDuration(1200), '1.2 s');
    assert.equal(formatDuration(2000), '2 s');
    assert.equal(formatDuration(35 * 60_000), '35 min');
    assert.equal(formatDuration(125 * 60_000), '2 h 5 min');
  });

  it('formatMinutes', () => {
    assert.equal(formatMinutes(35), '35 min');
    assert.equal(formatMinutes(120), '2 h');
    assert.equal(formatMinutes(125), '2 h 5 min');
  });
});
