import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import {
  type ConnectorInfo,
  type CredentialDetail,
  credentialsKey,
  type TestResult
} from '../credentials';
import { useSubmit } from '../useSubmit';
import { FormError } from './AuthCard';

interface CredentialFormProps {
  projectId: string;
  connector: ConnectorInfo;
  /** Absent for a new credential. */
  existing?: CredentialDetail;
  onClose: () => void;
}

/**
 * A credential form built from the connector's field list. Saving also tests
 * the connection. Secret fields start empty: the server never sends them, and
 * leaving one empty keeps what is stored.
 */
export function CredentialForm({ projectId, connector, existing, onClose }: CredentialFormProps) {
  const { t } = useTranslation('app');
  const queryClient = useQueryClient();
  const [id, setId] = useState(existing?.id ?? null);
  const [name, setName] = useState(existing?.name ?? connector.name);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      connector.fields.map((field) => [
        field.name,
        field.secret ? '' : String(existing?.settings[field.name] ?? '')
      ])
    )
  );
  const [secretsSet, setSecretsSet] = useState(existing?.secretsSet ?? []);
  const [result, setResult] = useState<TestResult | null>(null);

  const save = useSubmit(async () => {
    setResult(null);
    const body = { name, settings: values };
    const response: { id?: string; test: TestResult } = id
      ? await api<{ test: TestResult }>(`/api/credentials/${id}`, { method: 'PATCH', body })
      : await api<{ id: string; test: TestResult }>(`/api/projects/${projectId}/credentials`, {
          method: 'POST',
          body: { ...body, type: connector.id }
        });
    // A new credential becomes an edit, so a typo can be fixed right here.
    if (response.id) setId(response.id);
    setSecretsSet(connector.fields.filter((field) => field.secret).map((field) => field.name));
    setValues((current) =>
      Object.fromEntries(Object.entries(current).map(([key, value]) => [key, isSecret(connector, key) ? '' : value]))
    );
    setResult(response.test);
    await queryClient.invalidateQueries({ queryKey: credentialsKey(projectId) });
  });

  return (
    <form className="panel credential-form" onSubmit={save.onSubmit}>
      <div className="panel__row">
        <h2 className="panel__title">
          {id ? t('platform.credentials.edit', { connector: connector.name }) : t('platform.credentials.new', { connector: connector.name })}
        </h2>
      </div>
      <p className="panel__hint">{connector.description}</p>

      <label className="field">
        <span className="field__label">{t('platform.credentials.name')}</span>
        <input
          className="field__input"
          value={name}
          required
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      {connector.fields.map((field) => {
        const stored = field.secret && secretsSet.includes(field.name);
        return (
          <label className="field" key={field.name}>
            <span className="field__label">{field.label}</span>
            <input
              className="field__input"
              name={field.name}
              type={field.type}
              autoComplete={field.secret ? 'new-password' : 'off'}
              placeholder={stored ? t('platform.credentials.secretKept') : field.placeholder}
              value={values[field.name] ?? ''}
              required={field.required && !stored}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
            />
            {field.help && <span className="field__hint">{field.help}</span>}
          </label>
        );
      })}

      {result && (
        <p className={result.ok ? 'note note--success' : 'note note--warning'} role="status">
          {result.ok ? result.message : t('platform.credentials.testFailed', { message: result.message })}
        </p>
      )}
      <FormError message={save.error} />

      <div className="panel__actions">
        <button className="btn" type="button" onClick={onClose}>
          {result?.ok ? t('platform.credentials.done') : t('platform.users.cancel')}
        </button>
        <button className="btn btn--primary" type="submit" disabled={save.busy}>
          {save.busy ? t('platform.credentials.testing') : t('platform.credentials.saveTest')}
        </button>
      </div>
    </form>
  );
}

const isSecret = (connector: ConnectorInfo, name: string) =>
  connector.fields.some((field) => field.name === name && field.secret);
