import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface SetupStep {
  kind: 'install' | 'env' | 'file';
  file?: string;
  code: string;
}

export interface SetupBlock {
  id: 'node-cjs' | 'node-esm' | 'nextjs';
  steps: SetupStep[];
}

export interface SeenService {
  name: string;
  lastSeenAt: string;
}

export interface IngestKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  services: SeenService[];
}

/** Returned once, on creation: the only time the raw key is available. */
export interface CreatedIngestKey extends IngestKeySummary {
  key: string;
  endpoint: string;
  setup: SetupBlock[];
}

export const ingestKeysKey = (projectId: string) => ['ingest-keys', projectId] as const;

/** Refetches every 15 s so "last data" and "seen as" update while someone pastes a block. */
export function useIngestKeys(projectId: string) {
  return useQuery({
    queryKey: ingestKeysKey(projectId),
    queryFn: () => api<IngestKeySummary[]>(`/api/projects/${encodeURIComponent(projectId)}/ingest-keys`),
    refetchInterval: 15_000
  });
}
