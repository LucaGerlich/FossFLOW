import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { canGrantInstanceRole, hasInstanceScope, isInstanceRole } from './roles.js';

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
