import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from './api';

/** Form submission with a busy flag and a user-facing error message. */
export function useSubmit(action: () => Promise<void>) {
  const { t } = useTranslation('app');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('platform.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, onSubmit };
}
