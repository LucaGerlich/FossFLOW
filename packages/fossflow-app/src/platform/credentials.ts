import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/** One input on a credential form, as the connector describes it. */
export interface ConnectorField {
  name: string;
  label: string;
  type: 'url' | 'email' | 'text' | 'password';
  /** Never sent back by the server; an empty input keeps the stored value. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  description: string;
  fields: ConnectorField[];
}

export interface CredentialSummary {
  id: string;
  name: string;
  type: string;
  updatedAt: string;
  usedBy: number;
}

export interface CredentialDetail {
  id: string;
  projectId: string;
  name: string;
  type: string;
  settings: Record<string, unknown>;
  secretsSet: string[];
  updatedAt: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  type: string;
}

export const credentialsKey = (projectId: string) => ['credentials', projectId] as const;
export const sourcesKey = (landscapeId: string) => ['sources', landscapeId] as const;

export function useConnectors() {
  return useQuery({
    queryKey: ['connectors'],
    queryFn: () => api<ConnectorInfo[]>('/api/connectors'),
    staleTime: Infinity
  });
}

export function useCredentials(projectId: string, enabled = true) {
  return useQuery({
    queryKey: credentialsKey(projectId),
    queryFn: () => api<CredentialSummary[]>(`/api/projects/${encodeURIComponent(projectId)}/credentials`),
    enabled
  });
}

export function useCredential(id: string | null) {
  return useQuery({
    queryKey: ['credential', id],
    queryFn: () => api<CredentialDetail>(`/api/credentials/${encodeURIComponent(id ?? '')}`),
    enabled: id !== null,
    // The form owns the values while open.
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
}

export function useSources(landscapeId: string) {
  return useQuery({
    queryKey: sourcesKey(landscapeId),
    queryFn: () => api<SourceSummary[]>(`/api/landscapes/${encodeURIComponent(landscapeId)}/sources`)
  });
}
