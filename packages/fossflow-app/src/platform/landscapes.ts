import { useQuery } from '@tanstack/react-query';
import { isImportedIcon } from '../editorDefaults';
import { api } from './api';

export interface LandscapeSummary {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  projectType: 'personal' | 'team';
  version: number;
  updatedAt: string;
  updatedByName: string | null;
}

/** The stored model: what the editor saves, without the built-in icon packs. */
export interface StoredModel {
  title?: string;
  version?: string;
  description?: string;
  icons: { collection?: string }[];
  colors: unknown[];
  items: unknown[];
  views: unknown[];
}

export interface LandscapeDetail extends LandscapeSummary {
  model: StoredModel;
  scopes: string[];
}

export const overviewKey = ['landscapes'] as const;
export const projectLandscapesKey = (projectId: string) => ['landscapes', projectId] as const;
export const landscapeKey = (id: string) => ['landscape', id] as const;

export function useOverview() {
  return useQuery({ queryKey: overviewKey, queryFn: () => api<LandscapeSummary[]>('/api/landscapes') });
}

export function useProjectLandscapes(projectId: string) {
  return useQuery({
    queryKey: projectLandscapesKey(projectId),
    queryFn: () => api<LandscapeSummary[]>(`/api/projects/${encodeURIComponent(projectId)}/landscapes`)
  });
}

export function useLandscape(id: string) {
  return useQuery({
    queryKey: landscapeKey(id),
    queryFn: () => api<LandscapeDetail>(`/api/landscapes/${encodeURIComponent(id)}`),
    retry: false,
    // The editor owns the model while open; never swap it underneath.
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
}

/** What gets stored: the model's fields, with only people's own icons. */
export function toStoredModel(model: StoredModel): StoredModel {
  return {
    ...(model.title !== undefined && { title: model.title }),
    ...(model.version !== undefined && { version: model.version }),
    ...(model.description !== undefined && { description: model.description }),
    icons: model.icons.filter(isImportedIcon),
    colors: model.colors,
    items: model.items,
    views: model.views
  };
}

/** Reads a FossFLOW JSON export for import: its title and model. */
export async function readModelFile(file: File): Promise<{ name: string; model: StoredModel }> {
  const data = JSON.parse(await file.text()) as Partial<StoredModel> & { name?: string };
  const name = (data.name || data.title || file.name.replace(/\.json$/i, '')).trim().slice(0, 200);
  return {
    name: name || 'Imported landscape',
    model: toStoredModel({
      ...data,
      icons: data.icons ?? [],
      colors: data.colors ?? [],
      items: data.items ?? [],
      views: data.views ?? []
    })
  };
}
