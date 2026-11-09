import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CopyLinkProps {
  title: string;
  hint: string;
  url: string;
  onClose: () => void;
}

/** A one-time link to hand over (invitation or password reset). */
export function CopyLink({ title, hint, url, onClose }: CopyLinkProps) {
  const { t } = useTranslation('app');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the link stays selectable in the field.
    }
  };

  return (
    <section className="panel panel--link" aria-label={title}>
      <h2 className="panel__title">{title}</h2>
      <p className="panel__hint">{hint}</p>
      <div className="copy-link">
        <input
          className="field__input copy-link__input"
          readOnly
          value={url}
          onFocus={(event) => event.target.select()}
          aria-label={title}
        />
        <button className="btn btn--primary" type="button" onClick={copy}>
          {copied ? t('platform.users.copied') : t('platform.users.copy')}
        </button>
        <button className="btn" type="button" onClick={onClose}>
          {t('platform.users.done')}
        </button>
      </div>
    </section>
  );
}
