import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './api';
import { type StoredModel, toStoredModel } from './landscapes';

const SAVE_DELAY_MS = 1500;

export type SaveState = 'saved' | 'pending' | 'saving' | 'conflict' | 'error';

export interface ConflictInfo {
  currentVersion: number;
  updatedByName: string | null;
  updatedAt: string;
}

/**
 * Saves a landscape a moment after the last change. Each save names the
 * version it is based on; if someone else saved in between, the server
 * answers 409 and saving pauses until the user reloads or overwrites.
 */
export function useAutosave(landscapeId: string, initial: { version: number; model: StoredModel }) {
  const url = `/api/landscapes/${landscapeId}`;
  const version = useRef(initial.version);
  const lastSaved = useRef(JSON.stringify(toStoredModel(initial.model)));
  const latest = useRef<string>(lastSaved.current);
  const timer = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const paused = useRef(false);
  const [state, setState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current);
    if (inFlight.current || paused.current) return;
    const body = latest.current;
    if (body === lastSaved.current) {
      setState('saved');
      return;
    }

    inFlight.current = true;
    setState('saving');
    try {
      const result = await api<{ version: number }>(url, {
        method: 'PUT',
        body: { model: JSON.parse(body) as StoredModel, version: version.current }
      });
      version.current = result.version;
      lastSaved.current = body;
      setState(latest.current === body ? 'saved' : 'pending');
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        paused.current = true;
        setConflict(caught.body as ConflictInfo);
        setState('conflict');
      } else {
        setState('error');
      }
    } finally {
      inFlight.current = false;
    }
    // Changes made while this save was running go out next.
    if (!paused.current && latest.current !== lastSaved.current) {
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    }
  }, [url]);

  const schedule = useCallback(
    (model: StoredModel) => {
      latest.current = JSON.stringify(toStoredModel(model));
      if (latest.current === lastSaved.current) return;
      if (!paused.current) setState('pending');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush]
  );

  /**
   * Takes the editor's own view of the model as the starting point without
   * saving it. The editor tidies a model while loading (adds a default view,
   * fills defaults); that alone must not count as somebody's change.
   */
  const adopt = useCallback((model: StoredModel) => {
    if (latest.current !== lastSaved.current) return; // never drop real edits
    lastSaved.current = JSON.stringify(toStoredModel(model));
    latest.current = lastSaved.current;
  }, []);

  /** Keeps your version: saves it on top of the newer one. */
  const overwrite = useCallback(() => {
    if (!conflict) return;
    version.current = conflict.currentVersion;
    paused.current = false;
    setConflict(null);
    void flush();
  }, [conflict, flush]);

  const retry = useCallback(() => void flush(), [flush]);

  // Unsaved work: warn before leaving, and try a last save on the way out.
  useEffect(() => {
    const unsaved = () => latest.current !== lastSaved.current;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (unsaved()) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.clearTimeout(timer.current);
      if (unsaved() && !paused.current && !inFlight.current) {
        void api(url, {
          method: 'PUT',
          keepalive: true,
          body: { model: JSON.parse(latest.current) as StoredModel, version: version.current }
        }).catch(() => undefined);
      }
    };
  }, [url]);

  return { state, conflict, schedule, adopt, overwrite, retry };
}
