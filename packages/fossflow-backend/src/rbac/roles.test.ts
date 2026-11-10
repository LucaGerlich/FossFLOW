import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  canGrantInstanceRole,
  hasInstanceScope,
  isInstanceRole,
  PROJECT_SCOPES,
  projectScopesFor
} from './roles.js';

describe('project roles', () => {
  const scopes = (instance: string, project: string | null) =>
    projectScopesFor(instance, project);

  it('gives instance owners and admins every scope in every project', () => {
    for (const role of ['global:owner', 'global:admin']) {
      assert.equal(scopes(role, null).size, PROJECT_SCOPES.length);
    }
  });

  it('lets project admins manage members and the project, editors only content', () => {
    const admin = scopes('global:member', 'project:admin');
    assert.ok(admin.has('projectMember:manage'));
    assert.ok(admin.has('project:delete'));

    const editor = scopes('global:member', 'project:editor');
    assert.ok(editor.has('landscape:update'));
    assert.ok(editor.has('credential:use'));
    assert.ok(!editor.has('projectMember:manage'));
    assert.ok(!editor.has('project:update'));
    assert.ok(!editor.has('landscape:move'));
  });

  it('keeps viewers read-only and away from credential use', () => {
    const viewer = scopes('global:member', 'project:viewer');
    assert.deepEqual([...viewer].sort(), ['credential:read', 'landscape:read', 'project:read']);
  });

  it('never lets a personal project be renamed, deleted or shared', () => {
    const owner = scopes('global:member', 'project:personalOwner');
    assert.ok(owner.has('landscape:create'));
    assert.ok(!owner.has('project:update'));
    assert.ok(!owner.has('project:delete'));
    assert.ok(!owner.has('projectMember:manage'));
  });

  it('gives non-members nothing', () => {
    assert.equal(scopes('global:member', null).size, 0);
    assert.equal(scopes('global:member', 'project:bogus').size, 0);
  });
});

describe('instance roles', () => {
  it('gives owners and admins user management, members nothing', () => {
    for (const role of ['global:owner', 'global:admin']) {
      assert.ok(hasInstanceScope(role, 'user:invite'));
      assert.ok(hasInstanceScope(role, 'user:list'));
      assert.ok(hasInstanceScope(role, 'user:resetPassword'));
    }
    assert.ok(!hasInstanceScope('global:member', 'user:invite'));
    assert.ok(!hasInstanceScope('global:member', 'user:list'));
  });

  it('treats unknown roles as having no scopes', () => {
    assert.ok(!isInstanceRole('global:superuser'));
    assert.ok(!hasInstanceScope('global:superuser', 'user:list'));
  });

  it('lets only the owner create admins, and nobody create owners', () => {
    assert.ok(canGrantInstanceRole('global:owner', 'global:admin'));
    assert.ok(!canGrantInstanceRole('global:admin', 'global:admin'));
    assert.ok(canGrantInstanceRole('global:admin', 'global:member'));
    assert.ok(!canGrantInstanceRole('global:member', 'global:member'));
    assert.ok(!canGrantInstanceRole('global:owner', 'global:owner'));
  });
});
