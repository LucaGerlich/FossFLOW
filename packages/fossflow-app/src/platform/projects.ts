import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type TeamProjectRole = 'project:admin' | 'project:editor' | 'project:viewer';
export const TEAM_PROJECT_ROLES: TeamProjectRole[] = [
  'project:admin',
  'project:editor',
  'project:viewer'
];

export interface ProjectSummary {
  id: string;
  name: string;
  type: 'personal' | 'team';
  role: string | null;
  scopes: string[];
}

export interface ProjectMember {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface ProjectDetail extends ProjectSummary {
  members: ProjectMember[];
}

export const projectsKey = ['projects'] as const;
export const projectKey = (id: string) => ['project', id] as const;

export function useProjects() {
  return useQuery({ queryKey: projectsKey, queryFn: () => api<ProjectSummary[]>('/api/projects') });
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKey(id),
    queryFn: () => api<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`),
    retry: false
  });
}

export const can = (project: { scopes: string[] } | undefined, scope: string) =>
  project?.scopes.includes(scope) ?? false;
