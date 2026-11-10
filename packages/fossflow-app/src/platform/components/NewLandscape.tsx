import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api';
import { readModelFile, type StoredModel } from '../landscapes';
import { FormError } from './AuthCard';

/** "New landscape" and "Import JSON" for one project; both open the editor. */
export function NewLandscape({ projectId }: { projectId: string }) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (body: { name: string; model?: StoredModel }) => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>(`/api/projects/${projectId}/landscapes`, {
        method: 'POST',
        body
      });
      await queryClient.invalidateQueries({ queryKey: ['landscapes'] });
      navigate(`/landscapes/${created.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await create(await readModelFile(file));
    } catch {
      setError(t('platform.landscapes.importInvalid'));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="page__actions">
      <button
        className="btn"
        type="button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
      >
        {t('platform.landscapes.import')}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => onFile(event.target.files?.[0])}
      />
      <button
        className="btn btn--primary"
        type="button"
        disabled={busy}
        onClick={() => create({ name: t('platform.landscapes.untitled') })}
      >
        {t('platform.landscapes.new')}
      </button>
      <FormError message={error} />
    </div>
  );
}
