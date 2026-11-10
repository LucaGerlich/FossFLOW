import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { type Browser, startTestApp, type TestApp } from '../test/app.js';
import { joinAs, type Person, personalOf } from '../test/people.js';
import { UsersService } from './users.service.js';

/** Refuses connections at once, so saving a credential's test fails fast. */
const UNREACHABLE = 'http://127.0.0.1:9';

describe('user management and personal settings', () => {
  let t: TestApp;
  let owner: Browser;
  let ownerId: string;
  let ada: Person; // instance admin

  const setRole = (by: Browser, id: string, instanceRole: string) =>
    by.patch(`/api/users/${id}`, { instanceRole });

  /** A landscape plus an attached credential in the person's personal project. */
  async function personalWork(person: Person) {
    const home = await personalOf(person.browser);
    const landscapeId = (await person.browser.post(`/api/projects/${home}/landscapes`, { name: 'Lab' })).body.id;
    const credentialId = (
      await person.browser.post(`/api/projects/${home}/credentials`, {
        name: 'Lab hub',
        type: 'beszel',
        settings: { url: UNREACHABLE, email: 'lab@example.com', password: 'Lab-pass-1A' }
      })
    ).body.id;
    const attached = await person.browser.put(`/api/landscapes/${landscapeId}/sources`, {
      credentialIds: [credentialId]
    });
    assert.equal(attached.status, 200);
    return { home, landscapeId, credentialId };
  }

  beforeAll(async () => {
    t = await startTestApp();
    owner = t.browser();
    await owner.post('/api/setup/owner', {
      name: 'Olivia',
      email: 'owner@example.com',
      password: 'Owner-pass-1'
    });
    ownerId = (await owner.get('/api/auth/get-session')).body.user.id;
    ada = await joinAs(t, owner, 'Ada', 'global:admin');
  });
  afterAll(async () => t?.close());

  it('lets the owner change roles, effective on the very next request', async () => {
    const mia = await joinAs(t, owner, 'Mia');
    assert.equal((await mia.browser.get('/api/users')).status, 403);

    assert.equal((await setRole(owner, mia.id, 'global:admin')).status, 200);
    assert.equal((await mia.browser.get('/api/users')).status, 200);

    assert.equal((await setRole(owner, mia.id, 'global:member')).status, 200);
    assert.equal((await mia.browser.get('/api/users')).status, 403);
  });

  it('keeps role changes within what the actor may grant', async () => {
    const max = await joinAs(t, owner, 'Max');
    const ben = await joinAs(t, owner, 'Ben', 'global:admin');

    assert.equal((await setRole(owner, ownerId, 'global:admin')).status, 400, 'not your own role');
    assert.equal((await setRole(ada.browser, ada.id, 'global:member')).status, 400);
    assert.equal((await setRole(owner, max.id, 'global:owner')).status, 403, 'nobody grants owner');
    assert.equal((await setRole(ada.browser, max.id, 'global:admin')).status, 403, 'admins can’t mint admins');
    assert.equal((await setRole(ada.browser, ben.id, 'global:member')).status, 403, 'admins can’t demote admins');
    assert.equal((await setRole(ada.browser, ownerId, 'global:member')).status, 403);
    assert.equal((await setRole(max.browser, ben.id, 'global:member')).status, 403, 'members can’t');
    assert.equal((await setRole(owner, max.id, 'root')).status, 400);
    assert.equal((await setRole(owner, 'nobody', 'global:member')).status, 404);
  });

  it('deletes a person and moves their personal work to someone else', async () => {
    const mia = await joinAs(t, owner, 'Mira');
    const work = await personalWork(mia);

    assert.equal((await owner.delete(`/api/users/${mia.id}?transferTo=${ownerId}`)).status, 204);

    assert.equal((await mia.browser.get('/api/projects')).status, 401, 'signed out everywhere');
    const users = (await owner.get('/api/users')).body as { id: string }[];
    assert.ok(!users.some((u) => u.id === mia.id));
    assert.equal((await owner.get(`/api/projects/${work.home}`)).status, 404, 'her personal project is gone');

    const home = await personalOf(owner);
    assert.equal((await owner.get(`/api/landscapes/${work.landscapeId}`)).body.projectId, home);
    const credentials = (await owner.get(`/api/projects/${home}/credentials`)).body as { id: string }[];
    assert.ok(credentials.some((c) => c.id === work.credentialId));
    const sources = (await owner.get(`/api/landscapes/${work.landscapeId}/sources`)).body as { id: string }[];
    assert.deepEqual(sources.map((s) => s.id), [work.credentialId], 'live sources stay attached');
  });

  it('deletes their personal work with them when nobody takes it over', async () => {
    const vic = await joinAs(t, owner, 'Vic');
    const work = await personalWork(vic);

    assert.equal((await ada.browser.delete(`/api/users/${vic.id}`)).status, 204, 'admins delete members');

    assert.equal((await owner.get(`/api/landscapes/${work.landscapeId}`)).status, 404);
    assert.equal((await owner.get(`/api/credentials/${work.credentialId}`)).status, 404);
    assert.equal((await owner.get(`/api/projects/${work.home}`)).status, 404);
  });

  it('won’t leave a team project without an admin', async () => {
    const sam = await joinAs(t, owner, 'Sam');
    const team = (await owner.post('/api/projects', { name: 'Ops' })).body.id;
    await owner.put(`/api/projects/${team}/members/${sam.id}`, { role: 'project:admin' });
    await owner.delete(`/api/projects/${team}/members/${ownerId}`);

    const blocked = await owner.delete(`/api/users/${sam.id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /Ops/);

    await owner.put(`/api/projects/${team}/members/${ada.id}`, { role: 'project:admin' });
    assert.equal((await owner.delete(`/api/users/${sam.id}`)).status, 204);
  });

  it('keeps one admin when two co-admins are deleted at the same moment', async () => {
    const amy = await joinAs(t, owner, 'Amy');
    const bob = await joinAs(t, owner, 'Bob');
    const team = (await owner.post('/api/projects', { name: 'Edge' })).body.id;
    await owner.put(`/api/projects/${team}/members/${amy.id}`, { role: 'project:admin' });
    await owner.put(`/api/projects/${team}/members/${bob.id}`, { role: 'project:admin' });
    await owner.delete(`/api/projects/${team}/members/${ownerId}`);

    // Another deletion of Amy, still open: it holds her rows.
    const other = new pg.Client({ connectionString: t.postgres.getConnectionUri() });
    await other.connect();
    try {
      await other.query('BEGIN');
      await other.query('DELETE FROM "user" WHERE id = $1', [amy.id]);
      const bobDeleted = owner.delete(`/api/users/${bob.id}`).then((response) => response.status);
      // Deleting Bob must wait for it (the admin-row lock), not decide on a stale view.
      let waiting = false;
      for (let i = 0; i < 40 && !waiting; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const { rows } = await other.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock'"
        );
        waiting = (rows[0]?.n ?? 0) > 0;
      }
      await other.query('COMMIT');
      assert.ok(waiting, 'deleting Bob waited for the other deletion');
      assert.equal(await bobDeleted, 409, 'Bob is now the only admin of Edge');
    } finally {
      await other.end();
    }
  });

  it('refuses a delete authorised against a role that has changed since', async () => {
    const pat = await joinAs(t, owner, 'Pat');
    const users = t.app.get(UsersService);
    await assert.rejects(users.remove(pat.id, 'global:admin'), ConflictException);
    assert.equal((await pat.browser.get('/api/projects')).status, 200, 'still here');
  });

  it('never deletes the owner, yourself, or into nowhere', async () => {
    const kim = await joinAs(t, owner, 'Kim');
    const ben = await joinAs(t, owner, 'Bea', 'global:admin');

    assert.equal((await ada.browser.delete(`/api/users/${ownerId}`)).status, 403);
    assert.equal((await owner.delete(`/api/users/${ownerId}`)).status, 400);
    assert.equal((await ada.browser.delete(`/api/users/${ada.id}`)).status, 400);
    assert.equal((await ada.browser.delete(`/api/users/${ben.id}`)).status, 403, 'admins can’t delete admins');
    assert.equal((await kim.browser.delete(`/api/users/${ben.id}`)).status, 403, 'members can’t');
    assert.equal((await owner.delete(`/api/users/${kim.id}?transferTo=${kim.id}`)).status, 400);
    assert.equal((await owner.delete(`/api/users/${kim.id}?transferTo=nobody`)).status, 404);
    assert.equal((await owner.delete('/api/users/nobody')).status, 404);
    assert.equal((await kim.browser.get('/api/projects')).status, 200, 'still here after the refusals');
  });

  it('changes your password under the password rule and signs out your other devices', async () => {
    const lou = await joinAs(t, owner, 'Lou');
    const laptop = t.browser();
    await laptop.post('/api/auth/sign-in/email', { email: 'lou@example.com', password: 'Lou-pass-1A' });
    assert.equal((await laptop.get('/api/projects')).status, 200);

    const change = (currentPassword: string, newPassword: string) =>
      lou.browser.post('/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: true });
    assert.equal((await change('Lou-pass-1A', 'all-lowercase-no-digit')).status, 400, 'the password rule holds');
    assert.equal((await change('Lou-better-2B', 'Lou-better-2B')).status, 400, 'needs the current password');
    assert.equal((await change('Lou-pass-1A', 'Lou-better-2B')).status, 200);

    assert.equal((await lou.browser.get('/api/projects')).status, 200, 'this device stays signed in');
    assert.equal((await laptop.get('/api/projects')).status, 401, 'other devices are signed out');
    const fresh = t.browser();
    const signIn = await fresh.post('/api/auth/sign-in/email', { email: 'lou@example.com', password: 'Lou-better-2B' });
    assert.equal(signIn.status, 200);
  });

  it('renames you within the name rule, and never changes your role', async () => {
    const zoe = await joinAs(t, owner, 'Zoe');
    const rename = (body: object) => zoe.browser.post('/api/auth/update-user', body);

    assert.equal((await rename({ name: '   ' })).status, 400);
    assert.equal((await rename({ name: 'x'.repeat(101) })).status, 400);
    assert.equal((await rename({ name: '  Zoe Quinn  ' })).status, 200);
    await rename({ instanceRole: 'global:owner' });

    const me = (await zoe.browser.get('/api/auth/get-session')).body.user;
    assert.equal(me.name, 'Zoe Quinn');
    assert.equal(me.instanceRole, 'global:member');
  });
});
