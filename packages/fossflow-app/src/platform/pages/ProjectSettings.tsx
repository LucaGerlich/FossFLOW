import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { FormError } from '../components/AuthCard';
import {
  can,
  type ProjectDetail,
  projectKey,
  projectsKey,
  TEAM_PROJECT_ROLES,
  type TeamProjectRole
} from '../projects';
import { roleLabelKey } from '../session';
import { useSubmit } from '../useSubmit';

/** Name, members and their roles, and deleting the project. */
export function ProjectSettings({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/api/projects/${project.id}`;
  const canRename = can(project, 'project:update');
  const canManage = can(project, 'projectMember:manage');
  const canDelete = can(project, 'project:delete');

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: projectKey(project.id) }),
      queryClient.invalidateQueries({ queryKey: projectsKey }),
      queryClient.invalidateQueries({ queryKey: ['candidates', project.id] })
    ]);

  const [name, setName] = useState(project.name);
  const rename = useSubmit(async () => {
    await api(base, { method: 'PATCH', body: { name } });
    await refresh();
  });

  const [memberError, setMemberError] = useState<string | null>(null);
  const onMemberError = (error: unknown) =>
    setMemberError(error instanceof ApiError ? error.message : t('platform.errors.generic'));

  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamProjectRole }) =>
      api(`${base}/members/${userId}`, { method: 'PUT', body: { role } }),
    onMutate: () => setMemberError(null),
    onSuccess: refresh,
    onError: onMemberError
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`${base}/members/${userId}`, { method: 'DELETE' }),
    onMutate: () => setMemberError(null),
    onSuccess: refresh,
    onError: onMemberError
  });

  const candidates = useQuery({
    queryKey: ['candidates', project.id],
    queryFn: () => api<{ id: string; name: string; email: string }[]>(`${base}/candidates`),
    enabled: canManage
  });
  const [newMember, setNewMember] = useState('');
  const [newRole, setNewRole] = useState<TeamProjectRole>('project:editor');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteProject = useSubmit(async () => {
    await api(base, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: projectsKey });
    navigate('/', { replace: true });
  });

  return (
    <div className="settings">
      {canRename && (
        <form className="panel" onSubmit={rename.onSubmit}>
          <h2 className="panel__title">{t('platform.projects.name')}</h2>
          <div className="inline-form">
            <input
              className="field__input"
              aria-label={t('platform.projects.name')}
              value={name}
              required
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <button
              className="btn btn--primary"
              type="submit"
              disabled={rename.busy || name.trim() === project.name}
            >
              {t('platform.projects.save')}
            </button>
          </div>
          <FormError message={rename.error} />
        </form>
      )}

      <section className="panel">
        <h2 className="panel__title">{t('platform.projects.members')}</h2>
        <p className="panel__hint">{t('platform.projects.rolesHint')}</p>
        <div className="list">
          {project.members.map((member) => (
            <div className="list__row" key={member.userId}>
              <div className="list__main">
                <span className="list__title">{member.name}</span>
                <span className="list__meta">{member.email}</span>
              </div>
              {canManage ? (
                <select
                  className="field__input field__input--compact"
                  aria-label={t('platform.fields.role')}
                  value={member.role}
                  disabled={setRole.isPending}
                  onChange={(event) =>
                    setRole.mutate({
                      userId: member.userId,
                      role: event.target.value as TeamProjectRole
                    })
                  }
                >
                  {TEAM_PROJECT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(roleLabelKey(role))}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="badge">{t(roleLabelKey(member.role))}</span>
              )}
              {canManage && (
                <div className="list__actions">
                  <button
                    className="btn btn--sm btn--danger"
                    type="button"
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(member.userId)}
                  >
                    {t('platform.projects.remove')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <FormError message={memberError} />

        {canManage && (
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newMember) return;
              setRole.mutate(
                { userId: newMember, role: newRole },
                { onSuccess: () => setNewMember('') }
              );
            }}
          >
            <select
              className="field__input"
              aria-label={t('platform.projects.addMember')}
              value={newMember}
              onChange={(event) => setNewMember(event.target.value)}
            >
              <option value="">{t('platform.projects.pickPerson')}</option>
              {candidates.data?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} ({person.email})
                </option>
              ))}
            </select>
            <select
              className="field__input field__input--compact"
              aria-label={t('platform.fields.role')}
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as TeamProjectRole)}
            >
              {TEAM_PROJECT_ROLES.map((role) => (
                <option key={role} value={role}>
                  {t(roleLabelKey(role))}
                </option>
              ))}
            </select>
            <button className="btn" type="submit" disabled={!newMember || setRole.isPending}>
              {t('platform.projects.add')}
            </button>
          </form>
        )}
      </section>

      {canDelete && (
        <section className="panel panel--danger">
          <h2 className="panel__title">{t('platform.projects.delete')}</h2>
          <p className="panel__hint">{t('platform.projects.deleteHint')}</p>
          {confirmDelete ? (
            <form className="inline-form" onSubmit={deleteProject.onSubmit}>
              <button className="btn" type="button" onClick={() => setConfirmDelete(false)}>
                {t('platform.users.cancel')}
              </button>
              <button className="btn btn--danger-solid" type="submit" disabled={deleteProject.busy}>
                {t('platform.projects.deleteConfirm', { name: project.name })}
              </button>
            </form>
          ) : (
            <div>
              <button className="btn btn--danger" type="button" onClick={() => setConfirmDelete(true)}>
                {t('platform.projects.delete')}
              </button>
            </div>
          )}
          <FormError message={deleteProject.error} />
        </section>
      )}
    </div>
  );
}
