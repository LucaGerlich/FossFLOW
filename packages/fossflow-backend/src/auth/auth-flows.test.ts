import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { type Browser, startTestApp, type TestApp, TEST_ORIGIN } from '../test/app.js';

const OWNER = { name: 'Olivia Owner', email: 'Owner@Example.com', password: 'Owner-pass-1' };
const tokenOf = (url: string) => url.split('/invite/')[1] ?? '';
const resetTokenOf = (url: string) => new URL(url).searchParams.get('token') ?? '';

describe('auth flows against real Postgres', () => {
  let t: TestApp;
  let owner: Browser;

  beforeAll(async () => {
    t = await startTestApp();
    owner = t.browser();
  });
  afterAll(async () => t?.close());

  it('reports a fresh instance as needing setup', async () => {
    const res = await t.browser().get('/api/platform/status');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { platform: true, setupRequired: true, mailEnabled: false });
  });

  it('keeps public sign-up closed', async () => {
    const res = await t
      .browser()
      .post('/api/auth/sign-up/email', { name: 'Eve', email: 'eve@example.com', password: 'Eve-pass-1' });
    assert.equal(res.status, 400);
  });

  it('protects everything except health, status and setup', async () => {
    const anon = t.browser();
    assert.equal((await anon.get('/api/health')).status, 200);
    assert.equal((await anon.get('/api/users')).status, 401);
    assert.equal((await anon.get('/api/invitations')).status, 401);
    assert.equal((await anon.get('/api/live/status')).status, 401);
  });

  it('refuses writes from other origins (CSRF)', async () => {
    const server = t.app.getHttpServer();
    const noOrigin = await request(server).post('/api/setup/owner').send(OWNER);
    assert.equal(noOrigin.status, 403);
    const evil = await request(server)
      .post('/api/setup/owner')
      .set('Origin', 'https://evil.example')
      .send(OWNER);
    assert.equal(evil.status, 403);
  });

  it('enforces the password rule without echoing the password', async () => {
    const res = await t.browser().post('/api/setup/owner', { ...OWNER, password: 'weakpassword' });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /number and a capital letter/);
    assert.ok(!res.text.includes('weakpassword'));
  });

  it('creates the owner once and signs them in', async () => {
    const res = await owner.post('/api/setup/owner', OWNER);
    assert.equal(res.status, 201);
    assert.ok(String(res.headers['set-cookie']).includes('fossflow.session_token'));

    const session = await owner.get('/api/auth/get-session');
    assert.equal(session.body.user.email, 'owner@example.com');
    assert.equal(session.body.user.instanceRole, 'global:owner');

    const status = await t.browser().get('/api/platform/status');
    assert.equal(status.body.setupRequired, false);

    const again = await t.browser().post('/api/setup/owner', { ...OWNER, email: 'second@example.com' });
    assert.equal(again.status, 409);
  });

  it('signs in with email and password, and rejects wrong ones', async () => {
    const ok = await t
      .browser()
      .post('/api/auth/sign-in/email', { email: OWNER.email, password: OWNER.password });
    assert.equal(ok.status, 200);
    const wrong = await t
      .browser()
      .post('/api/auth/sign-in/email', { email: OWNER.email, password: 'Wrong-pass-1' });
    assert.equal(wrong.status, 401);
  });

  it('slows down password guessing from one client', async () => {
    const attacker = t.browser();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await attacker.post('/api/auth/sign-in/email', {
        email: OWNER.email,
        password: `Guess-${i}-pass`
      });
      statuses.push(res.status);
    }
    assert.ok(statuses.includes(429), `expected a 429 in ${statuses.join(',')}`);
  });

  it('lists users without any password material', async () => {
    const res = await owner.get('/api/users');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.ok(!/password|hash|scrypt/i.test(res.text));
  });

  describe('invitations', () => {
    let member: Browser;
    let memberId: string;

    it('invites a member, who joins through the link once', async () => {
      const invite = await owner.post('/api/invitations', {
        email: 'Mia@Example.com',
        instanceRole: 'global:member'
      });
      assert.equal(invite.status, 201);
      assert.equal(invite.body.emailed, false);
      assert.ok(invite.body.url.startsWith(`${TEST_ORIGIN}/invite/`));
      const token = tokenOf(invite.body.url);

      const pending = await owner.get('/api/invitations');
      assert.equal(pending.body.length, 1);
      assert.ok(!pending.text.includes(token), 'tokens are never listed');

      const lookup = await t.browser().get(`/api/invitations/accept/${token}`);
      assert.deepEqual(lookup.body, { email: 'mia@example.com', instanceRole: 'global:member' });

      member = t.browser();
      const accepted = await member.post(`/api/invitations/accept/${token}`, {
        name: 'Mia Member',
        password: 'Member-pass-1'
      });
      assert.equal(accepted.status, 201);
      const session = await member.get('/api/auth/get-session');
      assert.equal(session.body.user.instanceRole, 'global:member');
      memberId = session.body.user.id;

      const reused = await t
        .browser()
        .post(`/api/invitations/accept/${token}`, { name: 'Mallory', password: 'Mallory-pass-1' });
      assert.equal(reused.status, 404);
      assert.equal((await owner.get('/api/invitations')).body.length, 0);
    });

    it('keeps members out of user management', async () => {
      assert.equal((await member.get('/api/users')).status, 403);
      assert.equal((await member.get('/api/invitations')).status, 403);
      const invite = await member.post('/api/invitations', {
        email: 'friend@example.com',
        instanceRole: 'global:member'
      });
      assert.equal(invite.status, 403);
    });

    it('refuses to invite an existing account', async () => {
      const res = await owner.post('/api/invitations', {
        email: 'mia@example.com',
        instanceRole: 'global:member'
      });
      assert.equal(res.status, 409);
    });

    it('lets only the owner create admins', async () => {
      const invite = await owner.post('/api/invitations', {
        email: 'ada@example.com',
        instanceRole: 'global:admin'
      });
      assert.equal(invite.status, 201);
      const admin = t.browser();
      await admin.post(`/api/invitations/accept/${tokenOf(invite.body.url)}`, {
        name: 'Ada Admin',
        password: 'Admin-pass-1'
      });

      const escalate = await admin.post('/api/invitations', {
        email: 'evil@example.com',
        instanceRole: 'global:admin'
      });
      assert.equal(escalate.status, 403);
      const memberInvite = await admin.post('/api/invitations', {
        email: 'max@example.com',
        instanceRole: 'global:member'
      });
      assert.equal(memberInvite.status, 201);

      // Admins can't take over the owner's account through a reset link.
      const users = (await owner.get('/api/users')).body as { id: string; instanceRole: string }[];
      const ownerId = users.find((u) => u.instanceRole === 'global:owner')?.id;
      const takeover = await admin.post(`/api/users/${ownerId}/password-reset-link`);
      assert.equal(takeover.status, 403);
    });

    it('revokes a pending invitation', async () => {
      const invite = await owner.post('/api/invitations', {
        email: 'temp@example.com',
        instanceRole: 'global:member'
      });
      assert.equal((await owner.delete(`/api/invitations/${invite.body.id}`)).status, 204);
      const lookup = await t.browser().get(`/api/invitations/accept/${tokenOf(invite.body.url)}`);
      assert.equal(lookup.status, 404);
    });

    it('expires invitations after their deadline', async () => {
      const invite = await owner.post('/api/invitations', {
        email: 'late@example.com',
        instanceRole: 'global:member'
      });
      const client = new pg.Client({ connectionString: t.postgres.getConnectionUri() });
      await client.connect();
      await client.query(
        "update invitation set expires_at = now() - interval '1 minute' where id = $1",
        [invite.body.id]
      );
      await client.end();
      const accept = await t.browser().post(`/api/invitations/accept/${tokenOf(invite.body.url)}`, {
        name: 'Late',
        password: 'Late-pass-1'
      });
      assert.equal(accept.status, 404);
    });

    it('resets a member password through an admin-made link', async () => {
      const link = await owner.post(`/api/users/${memberId}/password-reset-link`);
      assert.equal(link.status, 201);
      const token = resetTokenOf(link.body.url);
      assert.ok(link.body.url.startsWith(`${TEST_ORIGIN}/reset-password?token=`));

      const weak = await t.browser().post('/api/auth/reset-password', { token, newPassword: 'short' });
      assert.equal(weak.status, 400);

      const reset = await t
        .browser()
        .post('/api/auth/reset-password', { token, newPassword: 'New-member-pass-2' });
      assert.equal(reset.status, 200);

      const old = await t
        .browser()
        .post('/api/auth/sign-in/email', { email: 'mia@example.com', password: 'Member-pass-1' });
      assert.equal(old.status, 401);
      const fresh = await t
        .browser()
        .post('/api/auth/sign-in/email', { email: 'mia@example.com', password: 'New-member-pass-2' });
      assert.equal(fresh.status, 200);

      const reused = await t
        .browser()
        .post('/api/auth/reset-password', { token, newPassword: 'Another-pass-3' });
      assert.equal(reused.status, 400);
    });
  });
});

describe('first-run setup race', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => t?.close());

  it('lets exactly one of two simultaneous setups become owner', async () => {
    const results = await Promise.all([
      t.browser().post('/api/setup/owner', { ...OWNER, email: 'a@example.com' }),
      t.browser().post('/api/setup/owner', { ...OWNER, email: 'b@example.com' })
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });
});
